import type { Task } from "@/db";
import { ArkError } from "@/lib/ark/client";
import { CozeError } from "@/lib/coze/client";
import { classifyTaskFailure } from "./task-error";
import {
  MAX_AUTOMATIC_TASK_ATTEMPTS,
  supportsTaskAutomaticRetry,
  type AutomaticTaskRetryInfo,
} from "./retry";

export const AUTOMATIC_TASK_RETRY_DELAYS_MS = [2_000, 10_000] as const;

function isSafeTransientFailure(task: Task, error: unknown): boolean {
  if (error instanceof ArkError) return error.retrySafe;
  if (error instanceof CozeError) return error.retrySafe;
  return (
    task.modelKey === "modelscope-qwen3-tts" &&
    error instanceof Error &&
    /meta tensor|meta device/i.test(error.message)
  );
}

export function automaticTaskRetryDecision(
  task: Task,
  error: unknown,
  now = Date.now()
): AutomaticTaskRetryInfo | null {
  if (!supportsTaskAutomaticRetry(task)) return null;
  if (task.attemptCount < 1 || task.attemptCount >= MAX_AUTOMATIC_TASK_ATTEMPTS) {
    return null;
  }
  if (!isSafeTransientFailure(task, error)) return null;

  const delay = AUTOMATIC_TASK_RETRY_DELAYS_MS[task.attemptCount - 1];
  if (delay === undefined) return null;
  const failure = classifyTaskFailure(error, {}, () => "automatic-retry");
  return {
    dueAt: now + delay,
    nextAttempt: task.attemptCount + 1,
    maxAttempts: MAX_AUTOMATIC_TASK_ATTEMPTS,
    reasonCode: failure.code,
    message: failure.userMessage,
  };
}
