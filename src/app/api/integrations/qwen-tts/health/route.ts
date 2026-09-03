import { and, eq, inArray } from "drizzle-orm";
import { db, tasks } from "@/db";
import {
  checkQwenTtsInstanceHealth,
  isQwenTtsInstanceKey,
  qwenTtsCapacityHint,
  qwenTtsHealthTimeoutMs,
} from "@/lib/modelscope/qwen-tts-runtime";
import {
  effectiveQwenTtsDefaultInstance,
  effectiveQwenTtsInstanceConfigs,
  recordManagedHealthCheck,
} from "@/lib/models/runtime";
import type {
  QwenTtsHealthDto,
  QwenTtsInstanceKey,
} from "@/lib/modelscope/types";
import { errorResponse, requireUser } from "@/lib/services";

function taskInstance(
  inputJson: string,
  fallback: QwenTtsInstanceKey
): QwenTtsInstanceKey {
  try {
    const input = JSON.parse(inputJson) as { instance?: unknown };
    return isQwenTtsInstanceKey(input.instance) ? input.instance : fallback;
  } catch {
    return fallback;
  }
}

export async function GET() {
  try {
    await requireUser();
    const defaultInstance = effectiveQwenTtsDefaultInstance();
    const activeTasks = db
      .select({ status: tasks.status, inputJson: tasks.inputJson })
      .from(tasks)
      .where(
        and(
          eq(tasks.modelKey, "modelscope-qwen3-tts"),
          inArray(tasks.status, ["queued", "running"])
        )
      )
      .all();
    const timeoutMs = qwenTtsHealthTimeoutMs();
    const instances = await Promise.all(
      effectiveQwenTtsInstanceConfigs().map(async (config) => {
        const health = config.enabled
          ? await checkQwenTtsInstanceHealth(config, { timeoutMs })
          : {
              status: "disabled" as const,
              message: "管理员已下线该声音克隆实例。",
              latencyMs: null,
            };
        if (health.status !== "disabled") {
          try {
            recordManagedHealthCheck({
              key: config.configKey,
              status: health.status,
              message: health.message,
            });
          } catch {
            console.error("[model-health] Qwen 健康状态写入失败", {
              key: config.configKey,
            });
          }
        }
        const instanceTasks = activeTasks.filter(
          // 发布前的历史任务没有 instance 字段，只能来自原公共创空间链路。
          (task) => taskInstance(task.inputJson, "public") === config.key
        );
        const queued = instanceTasks.filter(
          (task) => task.status === "queued"
        ).length;
        const running = instanceTasks.length - queued;
        const utilization = Math.min(
          1,
          (queued + running) / Math.max(1, config.capacityLimit)
        );
        return {
          key: config.key,
          label: config.label,
          experimental: config.experimental,
          configured: config.configured,
          ...health,
          capacity: {
            queued,
            running,
            limit: config.capacityLimit,
            utilization,
            hint: qwenTtsCapacityHint({
              instance: config.key,
              queued,
              running,
              limit: config.capacityLimit,
            }),
          },
        };
      })
    );
    const body: QwenTtsHealthDto = {
      defaultInstance,
      checkedAt: new Date().toISOString(),
      instances,
    };
    return Response.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
