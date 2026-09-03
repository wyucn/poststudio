import type { Task } from "@/db";

export type TaskProvider = "ark" | "coze" | "modelscope" | "internal";

export const TASK_PROVIDER_LABEL: Record<TaskProvider, string> = {
  ark: "火山方舟",
  coze: "Coze",
  modelscope: "ModelScope",
  internal: "站内处理",
};

export type TaskMetricRow = Pick<
  Task,
  | "id"
  | "modelKey"
  | "status"
  | "errorCode"
  | "attemptCount"
  | "createdAt"
  | "updatedAt"
  | "startedAt"
  | "completedAt"
>;

export interface ProviderMetric {
  provider: TaskProvider;
  label: string;
  total: number;
  succeeded: number;
  failed: number;
  retryCount: number;
  timing: TaskTimingMetrics;
}

export interface ErrorMetric {
  code: string;
  count: number;
}

export interface TaskQualitySummary {
  retryCount: number;
  timing: TaskTimingMetrics;
}

export interface TaskTimingMetrics {
  terminalCount: number;
  sampleCount: number;
  queueP50DurationMs: number | null;
  queueP95DurationMs: number | null;
  executionAverageDurationMs: number | null;
  executionP50DurationMs: number | null;
  executionP95DurationMs: number | null;
}

export interface TaskTimingSample {
  queueDurationMs: number;
  executionDurationMs: number;
}

export function taskProvider(modelKey: string): TaskProvider {
  if (modelKey.startsWith("seedream-") || modelKey.startsWith("seedance-")) {
    return "ark";
  }
  if (modelKey.startsWith("coze-")) return "coze";
  if (modelKey.startsWith("modelscope-")) return "modelscope";
  return "internal";
}

export function taskAttempts(task: TaskMetricRow): number {
  if (task.attemptCount > 0) return task.attemptCount;
  return task.status === "queued" ? 0 : 1;
}

export function taskRetryCount(task: TaskMetricRow): number {
  return Math.max(0, taskAttempts(task) - 1);
}

function isTerminalTask(task: TaskMetricRow): boolean {
  return (
    task.status === "succeeded" ||
    task.status === "failed" ||
    task.status === "cancelled"
  );
}

export function taskTimingSample(
  task: TaskMetricRow
): TaskTimingSample | null {
  if (
    !isTerminalTask(task) ||
    task.startedAt === null ||
    task.completedAt === null
  ) {
    return null;
  }
  return {
    queueDurationMs: Math.max(
      0,
      task.startedAt.getTime() - task.createdAt.getTime()
    ),
    executionDurationMs: Math.max(
      0,
      task.completedAt.getTime() - task.startedAt.getTime()
    ),
  };
}

export function taskDurationMs(task: TaskMetricRow): number | null {
  return taskTimingSample(task)?.executionDurationMs ?? null;
}

export function taskQueueDurationMs(task: TaskMetricRow): number | null {
  return taskTimingSample(task)?.queueDurationMs ?? null;
}

export function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function roundedAverage(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function summarizeTiming(
  terminalCount: number,
  samples: TaskTimingSample[]
): TaskTimingMetrics {
  const queueDurations = samples.map((sample) => sample.queueDurationMs);
  const executionDurations = samples.map(
    (sample) => sample.executionDurationMs
  );
  return {
    terminalCount,
    sampleCount: samples.length,
    queueP50DurationMs: percentile(queueDurations, 0.5),
    queueP95DurationMs: percentile(queueDurations, 0.95),
    executionAverageDurationMs: roundedAverage(executionDurations),
    executionP50DurationMs: percentile(executionDurations, 0.5),
    executionP95DurationMs: percentile(executionDurations, 0.95),
  };
}

export function summarizeTaskQuality(tasks: TaskMetricRow[]): {
  summary: TaskQualitySummary;
  byProvider: ProviderMetric[];
  byError: ErrorMetric[];
} {
  const timingSamples = tasks
    .map(taskTimingSample)
    .filter((value): value is TaskTimingSample => value !== null);
  const providerMap = new Map<
    TaskProvider,
    Omit<ProviderMetric, "timing"> & {
      terminalCount: number;
      timingSamples: TaskTimingSample[];
    }
  >();
  const errorMap = new Map<string, number>();
  let retryCount = 0;

  for (const task of tasks) {
    const provider = taskProvider(task.modelKey);
    const row = providerMap.get(provider) ?? {
      provider,
      label: TASK_PROVIDER_LABEL[provider],
      total: 0,
      succeeded: 0,
      failed: 0,
      retryCount: 0,
      terminalCount: 0,
      timingSamples: [],
    };
    row.total++;
    if (task.status === "succeeded") row.succeeded++;
    if (task.status === "failed") {
      row.failed++;
      const code = task.errorCode?.trim() || "UNKNOWN_TASK_FAILURE";
      errorMap.set(code, (errorMap.get(code) ?? 0) + 1);
    }
    const retries = taskRetryCount(task);
    retryCount += retries;
    row.retryCount += retries;
    if (isTerminalTask(task)) row.terminalCount++;
    const timing = taskTimingSample(task);
    if (timing) row.timingSamples.push(timing);
    providerMap.set(provider, row);
  }

  return {
    summary: {
      retryCount,
      timing: summarizeTiming(
        tasks.filter(isTerminalTask).length,
        timingSamples
      ),
    },
    byProvider: [...providerMap.values()]
      .map(({ terminalCount, timingSamples: providerTimings, ...row }) => ({
        ...row,
        timing: summarizeTiming(terminalCount, providerTimings),
      }))
      .sort((a, b) => b.total - a.total),
    byError: [...errorMap.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 10),
  };
}

export interface FailureAlertFinding {
  key: string;
  provider: TaskProvider;
  providerLabel: string;
  modelKey: string;
  total: number;
  failed: number;
  failureRate: number;
  errorCodes: ErrorMetric[];
}

export interface BacklogAlertFinding {
  key: "task-backlog";
  count: number;
  oldestAgeMs: number;
}

export function evaluateTaskAlerts(input: {
  recentTerminalTasks: TaskMetricRow[];
  queuedTasks: Pick<TaskMetricRow, "createdAt">[];
  nowMs?: number;
  failureMinCount?: number;
  failureRateThreshold?: number;
  backlogCountThreshold?: number;
  backlogAgeMs?: number;
}): {
  failures: FailureAlertFinding[];
  backlog: BacklogAlertFinding | null;
} {
  const failureMinCount = input.failureMinCount ?? 3;
  const failureRateThreshold = input.failureRateThreshold ?? 0.6;
  const groups = new Map<string, TaskMetricRow[]>();
  for (const task of input.recentTerminalTasks) {
    const provider = taskProvider(task.modelKey);
    const key = `${provider}:${task.modelKey}`;
    const rows = groups.get(key) ?? [];
    rows.push(task);
    groups.set(key, rows);
  }

  const failures: FailureAlertFinding[] = [];
  for (const [groupKey, rows] of groups) {
    const failedRows = rows.filter((task) => task.status === "failed");
    const rate = rows.length ? failedRows.length / rows.length : 0;
    if (failedRows.length < failureMinCount || rate < failureRateThreshold) continue;
    const provider = taskProvider(rows[0].modelKey);
    const errors = new Map<string, number>();
    for (const task of failedRows) {
      const code = task.errorCode?.trim() || "UNKNOWN_TASK_FAILURE";
      errors.set(code, (errors.get(code) ?? 0) + 1);
    }
    failures.push({
      key: `task-failure:${groupKey}`,
      provider,
      providerLabel: TASK_PROVIDER_LABEL[provider],
      modelKey: rows[0].modelKey,
      total: rows.length,
      failed: failedRows.length,
      failureRate: rate,
      errorCodes: [...errors.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count),
    });
  }

  const nowMs = input.nowMs ?? Date.now();
  const oldestAgeMs = input.queuedTasks.length
    ? Math.max(...input.queuedTasks.map((task) => nowMs - task.createdAt.getTime()))
    : 0;
  const backlog =
    input.queuedTasks.length >= (input.backlogCountThreshold ?? 8) ||
    oldestAgeMs >= (input.backlogAgeMs ?? 10 * 60 * 1000)
      ? { key: "task-backlog" as const, count: input.queuedTasks.length, oldestAgeMs }
      : null;

  return { failures, backlog };
}
