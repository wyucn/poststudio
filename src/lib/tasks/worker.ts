import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, tasks, type Task } from "@/db";
import { executeCompileTask } from "@/lib/edit/compile-task";
import { executeEditTask } from "@/lib/edit/task";
import { executeBasicTask } from "./basic-handlers";
import { submitQueuedVideoTask } from "./video-submit";
import { recordTaskFailure } from "./task-failure";
import { AUDIO_TRANSCRIPTION_MODEL_KEY } from "@/lib/transcription";
import { errorDiagnostic } from "@/lib/error-safety";
import { automaticTaskRetryDecision } from "./retry-policy";
import { recordManagedTaskSuccess } from "@/lib/models/runtime";
import {
  taskAutomaticRetryReady,
  withAutomaticTaskRetry,
  withoutAutomaticTaskRetry,
} from "./retry";

const POLL_MS = 1000;
const DEFAULT_CONCURRENCY = 2;
const active = new Set<string>();
let pumping = false;

function workerConcurrency(): number {
  const value = Number(process.env.TASK_WORKER_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 8) : DEFAULT_CONCURRENCY;
}

async function executeTask(task: Task) {
  if (task.kind === "video") {
    await submitQueuedVideoTask(task);
    return;
  }
  if (await executeBasicTask(task)) return;
  const context = task.contextJson
    ? (JSON.parse(task.contextJson) as { slot?: string })
    : {};
  if (task.kind === "edit" && context.slot === "compile") {
    await executeCompileTask(task);
    return;
  }
  if (task.kind === "edit") {
    await executeEditTask(task);
    return;
  }
  throw new Error(`没有可执行的任务处理器: ${task.kind}/${task.modelKey}`);
}

async function runClaimed(task: Task) {
  active.add(task.id);
  try {
    await executeTask(task);
    try {
      recordManagedTaskSuccess(task);
    } catch {
      console.error("[model-health] 成功状态写入失败", {
        taskId: task.id,
        modelKey: task.modelKey,
      });
    }
  } catch (error) {
    const retry = automaticTaskRetryDecision(task, error);
    if (retry) {
      const requeued = db
        .update(tasks)
        .set({
          status: "queued",
          contextJson: withAutomaticTaskRetry(task.contextJson, retry),
          error: null,
          errorCode: null,
          errorRequestId: null,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, "running")))
        .run();
      if (requeued.changes) {
        console.warn("[task-retry] 已安排安全自动重试", {
          taskId: task.id,
          kind: task.kind,
          modelKey: task.modelKey,
          reasonCode: retry.reasonCode,
          nextAttempt: retry.nextAttempt,
          maxAttempts: retry.maxAttempts,
          delayMs: retry.dueAt - Date.now(),
          error: errorDiagnostic(error),
        });
        return;
      }
      const current = db
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .get();
      if (!current || current.status !== "running") return;
    }
    // 任何最终失败都记录安全文案、稳定错误码与追踪编号；长任务按策略提醒。
    recordTaskFailure(task, error, {
      // 转写通常在校对面板内等待，失败由页面即时呈现，避免企微把它误报成文案生成。
      notify: task.modelKey !== AUDIO_TRANSCRIPTION_MODEL_KEY,
    });
  } finally {
    active.delete(task.id);
    void pumpOnce();
  }
}

async function pumpOnce() {
  if (pumping) return;
  pumping = true;
  try {
    const available = workerConcurrency() - active.size;
    if (available <= 0) return;
    const candidates = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, "queued"), isNull(tasks.arkTaskId)))
      .orderBy(asc(tasks.createdAt))
      .limit(Math.max(100, available * 25))
      .all();
    const pending = candidates
      .filter((task) => taskAutomaticRetryReady(task.contextJson))
      .slice(0, available);
    for (const task of pending) {
      const startedAt = task.startedAt ?? new Date();
      const contextJson = withoutAutomaticTaskRetry(task.contextJson);
      const claimed = db
        .update(tasks)
        .set({
          status: "running",
          attemptCount: sql`${tasks.attemptCount} + 1`,
          startedAt,
          completedAt: null,
          contextJson,
          error: null,
          errorCode: null,
          errorRequestId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, "queued")))
        .run();
      if (claimed.changes) {
        void runClaimed({
          ...task,
          status: "running",
          attemptCount: task.attemptCount + 1,
          startedAt,
          completedAt: null,
          contextJson,
          error: null,
          errorCode: null,
          errorRequestId: null,
        });
      }
    }
  } finally {
    pumping = false;
  }
}

export function startTaskWorker() {
  const globalState = globalThis as unknown as {
    __haitunTaskWorker?: NodeJS.Timeout;
  };
  if (globalState.__haitunTaskWorker) return;
  void pumpOnce();
  globalState.__haitunTaskWorker = setInterval(() => {
    void pumpOnce();
  }, POLL_MS);
  console.log(
    `[haitun-post-studio] 持久任务 worker 已启动（并发 ${workerConcurrency()}）`
  );
}
