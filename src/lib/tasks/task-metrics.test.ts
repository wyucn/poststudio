import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTaskAlerts,
  summarizeTaskQuality,
  taskDurationMs,
  taskQueueDurationMs,
  taskProvider,
  taskRetryCount,
  type TaskMetricRow,
} from "./task-metrics";

function row(input: Partial<TaskMetricRow> & Pick<TaskMetricRow, "id" | "modelKey" | "status">): TaskMetricRow {
  return {
    id: input.id,
    modelKey: input.modelKey,
    status: input.status,
    errorCode: input.errorCode ?? null,
    attemptCount: input.attemptCount ?? 1,
    createdAt: input.createdAt ?? new Date(0),
    updatedAt: input.updatedAt ?? new Date(1_000),
    startedAt: input.startedAt === undefined ? new Date(0) : input.startedAt,
    completedAt: input.completedAt === undefined ? new Date(1_000) : input.completedAt,
  };
}

test("task metrics group providers, retries, durations, and safe error codes", () => {
  const tasks = [
    row({ id: "ark-ok", modelKey: "seedream-5.0", status: "succeeded" }),
    row({
      id: "ark-failed",
      modelKey: "seedream-5.0",
      status: "failed",
      attemptCount: 2,
      errorCode: "RATE_LIMITED",
      completedAt: new Date(4_000),
      updatedAt: new Date(4_000),
    }),
    row({
      id: "coze-failed",
      modelKey: "coze-music",
      status: "failed",
      errorCode: "COZE_BUSY",
      completedAt: new Date(2_000),
      updatedAt: new Date(2_000),
    }),
  ];

  const metrics = summarizeTaskQuality(tasks);
  assert.deepEqual(metrics.summary, {
    retryCount: 1,
    timing: {
      terminalCount: 3,
      sampleCount: 3,
      queueP50DurationMs: 0,
      queueP95DurationMs: 0,
      executionAverageDurationMs: 2_333,
      executionP50DurationMs: 2_000,
      executionP95DurationMs: 4_000,
    },
  });
  assert.deepEqual(metrics.byProvider[0], {
    provider: "ark",
    label: "火山方舟",
    total: 2,
    succeeded: 1,
    failed: 1,
    retryCount: 1,
    timing: {
      terminalCount: 2,
      sampleCount: 2,
      queueP50DurationMs: 0,
      queueP95DurationMs: 0,
      executionAverageDurationMs: 2_500,
      executionP50DurationMs: 1_000,
      executionP95DurationMs: 4_000,
    },
  });
  assert.deepEqual(metrics.byError, [
    { code: "COZE_BUSY", count: 1 },
    { code: "RATE_LIMITED", count: 1 },
  ]);
  assert.equal(taskProvider("modelscope-qwen3-tts"), "modelscope");
  assert.equal(taskRetryCount(tasks[1]), 1);
  assert.equal(taskDurationMs(tasks[1]), 4_000);
  assert.equal(taskQueueDurationMs(tasks[1]), 0);
});

test("legacy terminal tasks stay outside exact timing metrics", () => {
  const task = row({
    id: "legacy",
    modelKey: "coze-edit",
    status: "succeeded",
    attemptCount: 0,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(1_000),
    updatedAt: new Date(6_000),
  });
  assert.equal(taskRetryCount(task), 0);
  assert.equal(taskDurationMs(task), null);
  assert.equal(taskQueueDurationMs(task), null);
  assert.deepEqual(summarizeTaskQuality([task]).summary.timing, {
    terminalCount: 1,
    sampleCount: 0,
    queueP50DurationMs: null,
    queueP95DurationMs: null,
    executionAverageDurationMs: null,
    executionP50DurationMs: null,
    executionP95DurationMs: null,
  });
});

test("task alert evaluation detects failure storms and worker backlog", () => {
  const recentTerminalTasks = [
    row({ id: "1", modelKey: "seedance-2.0", status: "failed", errorCode: "ARK_BUSY" }),
    row({ id: "2", modelKey: "seedance-2.0", status: "failed", errorCode: "ARK_BUSY" }),
    row({ id: "3", modelKey: "seedance-2.0", status: "failed", errorCode: "TIMEOUT" }),
    row({ id: "4", modelKey: "seedance-2.0", status: "succeeded" }),
  ];
  const findings = evaluateTaskAlerts({
    recentTerminalTasks,
    queuedTasks: [{ createdAt: new Date(0) }, { createdAt: new Date(10 * 60 * 1000) }],
    nowMs: 11 * 60 * 1000,
  });

  assert.equal(findings.failures.length, 1);
  assert.equal(findings.failures[0].provider, "ark");
  assert.equal(findings.failures[0].failed, 3);
  assert.equal(findings.failures[0].failureRate, 0.75);
  assert.deepEqual(findings.failures[0].errorCodes, [
    { code: "ARK_BUSY", count: 2 },
    { code: "TIMEOUT", count: 1 },
  ]);
  assert.deepEqual(findings.backlog, {
    key: "task-backlog",
    count: 2,
    oldestAgeMs: 11 * 60 * 1000,
  });
});

test("task alert evaluation ignores small or healthy samples", () => {
  const findings = evaluateTaskAlerts({
    recentTerminalTasks: [
      row({ id: "1", modelKey: "coze-tts", status: "failed" }),
      row({ id: "2", modelKey: "coze-tts", status: "failed" }),
      row({ id: "3", modelKey: "coze-tts", status: "succeeded" }),
      row({ id: "4", modelKey: "coze-tts", status: "succeeded" }),
    ],
    queuedTasks: [],
  });
  assert.deepEqual(findings, { failures: [], backlog: null });
});
