import type { Task } from "@/db";
import { errorDiagnostic } from "@/lib/error-safety";
import { updateTask } from "@/lib/services";
import { notifyTaskDone } from "./notify";
import {
  classifyTaskFailure,
  type ClassifiedTaskFailure,
  type TaskFailureOptions,
} from "./task-error";
import { recordManagedTaskFailure } from "@/lib/models/runtime";

type TaskDiagnosticContext = Pick<
  Task,
  "id" | "projectId" | "kind" | "modelKey"
>;

export function logTaskDiagnostic(
  task: TaskDiagnosticContext,
  error: unknown,
  code: string
): string {
  const failure = classifyTaskFailure(error, { code, shouldLog: true });
  console.error(`[task-error][${failure.requestId}]`, {
    taskId: task.id,
    projectId: task.projectId,
    kind: task.kind,
    modelKey: task.modelKey,
    code,
    error: errorDiagnostic(error),
  });
  return failure.requestId;
}

/** Persist a safe task failure and correlate it with a redacted server log. */
export function recordTaskFailure(
  task: Task,
  error: unknown,
  options: TaskFailureOptions & { notify?: boolean } = {}
): ClassifiedTaskFailure {
  const failure = classifyTaskFailure(error, options);
  updateTask(task.id, {
    status: "failed",
    error: failure.userMessage,
    errorCode: failure.code,
    errorRequestId: failure.requestId,
  });
  try {
    recordManagedTaskFailure(task, failure.code);
  } catch {
    console.error("[model-health] 失败状态写入失败", {
      taskId: task.id,
      modelKey: task.modelKey,
      code: failure.code,
    });
  }
  const diagnostic = {
    taskId: task.id,
    projectId: task.projectId,
    kind: task.kind,
    modelKey: task.modelKey,
    code: failure.code,
    error: errorDiagnostic(error),
  };
  if (failure.shouldLog) {
    console.error(`[task-error][${failure.requestId}]`, diagnostic);
  } else {
    // 可预期的素材/参数错误也保留一条安全事件，使前端错误编号始终可检索。
    console.warn(`[task-error][${failure.requestId}]`, diagnostic);
  }
  if (options.notify !== false) {
    notifyTaskDone(
      task,
      false,
      `${failure.userMessage}\n错误编号：${failure.requestId}`
    );
  }
  return failure;
}
