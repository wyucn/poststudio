import assert from "node:assert/strict";
import test from "node:test";
import {
  canCancelTask,
  canRetryTask,
  canTransitionTask,
  type TaskStatus,
} from "./task-state";

const statuses: TaskStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

test("task status transitions match the supported worker lifecycle", () => {
  const allowed = new Set([
    "queued->running",
    "queued->succeeded",
    "queued->failed",
    "queued->cancelled",
    "running->queued",
    "running->succeeded",
    "running->failed",
    "running->cancelled",
    "failed->queued",
  ]);

  for (const current of statuses) {
    for (const next of statuses) {
      assert.equal(
        canTransitionTask(current, next),
        allowed.has(`${current}->${next}`),
        `${current} -> ${next}`
      );
    }
  }
});

test("successful and cancelled tasks are terminal", () => {
  for (const current of ["succeeded", "cancelled"] as const) {
    for (const next of statuses) {
      assert.equal(canTransitionTask(current, next), false);
    }
  }
});

test("failed tasks can only be explicitly retried", () => {
  assert.equal(canTransitionTask("failed", "queued"), true);
  assert.equal(canTransitionTask("failed", "running"), false);
  assert.equal(canTransitionTask("failed", "succeeded"), false);
  assert.equal(canTransitionTask("failed", "cancelled"), false);
});

test("user actions are narrower than internal lifecycle transitions", () => {
  assert.equal(canCancelTask("queued"), true);
  assert.equal(canCancelTask("running"), false);
  assert.equal(canRetryTask("failed"), true);
  assert.equal(canRetryTask("cancelled"), false);
});
