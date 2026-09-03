import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, tasks } from "@/db";
import { modelDisplayName } from "@/lib/ark/models";
import { errorDiagnostic } from "@/lib/error-safety";
import { notifyWecom } from "@/lib/wecom";
import { evaluateTaskAlerts } from "./task-metrics";

const ALERT_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

interface TaskAlertState {
  timer?: NodeJS.Timeout;
  initialTimer?: NodeJS.Timeout;
  active: Map<string, string>;
  checking: boolean;
}

function state(): TaskAlertState {
  const root = globalThis as unknown as { __haitunTaskAlerts?: TaskAlertState };
  root.__haitunTaskAlerts ??= { active: new Map(), checking: false };
  return root.__haitunTaskAlerts;
}

async function checkTaskAlerts(): Promise<void> {
  const current = state();
  if (current.checking) return;
  current.checking = true;
  try {
    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const recentTerminalTasks = db
      .select()
      .from(tasks)
      .where(
        and(
          inArray(tasks.status, ["succeeded", "failed"]),
          gte(tasks.updatedAt, since)
        )
      )
      .all();
    const queuedTasks = db
      .select({ createdAt: tasks.createdAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "queued"),
          isNull(tasks.arkTaskId),
          isNull(tasks.deletedAt)
        )
      )
      .all();
    const findings = evaluateTaskAlerts({ recentTerminalTasks, queuedTasks });
    const next = new Map<string, string>();

    for (const failure of findings.failures) {
      const label = `${failure.providerLabel} / ${modelDisplayName(failure.modelKey)}`;
      next.set(failure.key, label);
      if (current.active.has(failure.key)) continue;
      const errors = failure.errorCodes
        .slice(0, 3)
        .map((item) => `${item.code}×${item.count}`)
        .join("、");
      await notifyWecom(
        `生成失败率告警\n范围：最近 15 分钟\n供应商 / 模型：${label}\n失败：${failure.failed}/${failure.total}（${Math.round(failure.failureRate * 100)}%）\n错误类型：${errors || "UNKNOWN_TASK_FAILURE"}`
      );
    }

    if (findings.backlog) {
      const label = `本地任务队列 ${findings.backlog.count} 个`;
      next.set(findings.backlog.key, label);
      if (!current.active.has(findings.backlog.key)) {
        await notifyWecom(
          `生成任务积压告警\n待执行：${findings.backlog.count} 个\n最久等待：${Math.ceil(findings.backlog.oldestAgeMs / 60000)} 分钟\n请检查 worker、模型连接和服务器资源`
        );
      }
    }

    for (const [key, label] of current.active) {
      if (!next.has(key)) {
        await notifyWecom(`生成链路恢复\n已解除：${label}`);
      }
    }
    current.active = next;
  } catch (error) {
    console.error("[task-alerts] 检查失败:", errorDiagnostic(error));
  } finally {
    current.checking = false;
  }
}

export function startTaskAlertScheduler(): void {
  const current = state();
  if (current.timer) return;
  current.initialTimer = setTimeout(() => void checkTaskAlerts(), INITIAL_DELAY_MS);
  current.timer = setInterval(() => void checkTaskAlerts(), ALERT_INTERVAL_MS);
  console.log("[haitun-post-studio] 生成任务告警调度器已启动");
}
