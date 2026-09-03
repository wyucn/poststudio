import type { Task } from "@/db";

export type TaskStatus = Task["status"];

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["running", "succeeded", "failed", "cancelled"],
  running: ["queued", "succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["queued"],
  cancelled: [],
};

export function canTransitionTask(
  current: TaskStatus,
  next: TaskStatus
): boolean {
  return ALLOWED_TRANSITIONS[current].includes(next);
}

export function canCancelTask(current: TaskStatus): boolean {
  return current === "queued";
}

export function canRetryTask(current: TaskStatus): boolean {
  return current === "failed";
}
