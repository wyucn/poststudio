import { sql, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { modelDisplayName } from "@/lib/ark/models";
import { estimateTaskCost } from "@/lib/pricing";
import {
  TASK_PROVIDER_LABEL,
  type TaskProvider,
} from "@/lib/tasks/task-metrics";
import * as schema from "@/db/schema";
import {
  assets,
  operationHealth,
  productEvents,
  projectMembers,
  projects,
  tasks,
  users,
} from "@/db/schema";
import {
  statsPageInfo,
  type CostAccuracy,
  type DashboardStatsResponse,
  type StatsPageInfo,
  type StatsRankRow,
  type StatsScope,
  type StatsTimingMetrics,
} from "./contracts";

export type StatsDatabase = BetterSQLite3Database<typeof schema>;

export interface DashboardStatsLoadInput {
  scope: StatsScope;
  userId: string;
  days: number;
  nowMs?: number;
}

interface StatsScopeContext {
  scope: StatsScope;
  userId: string;
  days: number;
  generatedAtMs: number;
  sinceMs: number;
}

interface RankBreakdown {
  byKind: Record<string, number>;
  estimatedCost: number;
}

type DashboardStatsBase = Omit<
  DashboardStatsResponse,
  "byProject" | "byUser" | "pagination"
>;

export interface DashboardStatsSnapshot {
  data: DashboardStatsBase;
  context: StatsScopeContext;
  projectBreakdown: Map<string, RankBreakdown>;
  userBreakdown: Map<string, RankBreakdown>;
}

export interface DashboardStatsRankings {
  byProject: StatsRankRow[];
  byUser: StatsRankRow[];
  pagination: {
    projects: StatsPageInfo;
    users: StatsPageInfo;
  };
}

interface SummaryRow {
  total: number;
  succeeded: number;
  failed: number;
  retryCount: number;
  terminalCount: number;
  timingSampleCount: number;
  executionAverageDurationMs: number | null;
}

interface PercentileRow {
  queueP50DurationMs: number | null;
  queueP95DurationMs: number | null;
  executionP50DurationMs: number | null;
  executionP95DurationMs: number | null;
}

interface ProviderRow extends SummaryRow, PercentileRow {
  provider: string;
}

interface ModelRow extends SummaryRow, PercentileRow {
  modelKey: string;
}

interface ModelErrorRow {
  modelKey: string;
  code: string;
  count: number;
}

interface ModelDimensionRow {
  modelKey: string;
  id: string;
  name: string;
  total: number;
  succeeded: number;
  failed: number;
}

interface EngagementRow {
  resultCount: number;
  downloadedCount: number;
  reusedCount: number;
  regeneratedCount: number;
}

interface CostTaskRow {
  projectId: string;
  userId: string;
  kind: string;
  modelKey: string;
  inputJson: string;
  usageJson: string | null;
  assetMetaJson: string | null;
}

type ModelDimension = "project" | "user";
type ModelDimensionRows = Map<string, ModelDimensionRow[]>;
type ModelDimensionCosts = Map<string, Map<string, number>>;

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MODEL_DISTRIBUTION_LIMIT = 5;

function scopedTasksCte(context: StatsScopeContext): SQL {
  const membershipJoin =
    context.scope === "mine"
      ? sql`INNER JOIN ${projectMembers}
          ON ${projectMembers.projectId} = ${tasks.projectId}
         AND ${projectMembers.userId} = ${context.userId}`
      : sql``;
  const sinceCondition =
    context.sinceMs > 0
      ? sql`AND ${tasks.createdAt} >= ${context.sinceMs}`
      : sql``;
  return sql`
    scoped_tasks AS (
      SELECT
        ${tasks.id} AS id,
        ${tasks.projectId} AS project_id,
        ${tasks.userId} AS user_id,
        ${tasks.kind} AS kind,
        ${tasks.status} AS status,
        ${tasks.modelKey} AS model_key,
        ${tasks.inputJson} AS input_json,
        ${tasks.usageJson} AS usage_json,
        ${tasks.outputAssetId} AS output_asset_id,
        ${tasks.errorCode} AS error_code,
        ${tasks.attemptCount} AS attempt_count,
        ${tasks.startedAt} AS started_at,
        ${tasks.completedAt} AS completed_at,
        ${tasks.createdAt} AS created_at,
        ${tasks.updatedAt} AS updated_at
      FROM ${tasks}
      INNER JOIN ${projects} ON ${projects.id} = ${tasks.projectId}
      ${membershipJoin}
      WHERE ${projects.deletedAt} IS NULL
      ${sinceCondition}
    )`;
}

function scopedAssetsCte(context: StatsScopeContext): SQL {
  const membershipJoin =
    context.scope === "mine"
      ? sql`INNER JOIN ${projectMembers}
          ON ${projectMembers.projectId} = ${assets.projectId}
         AND ${projectMembers.userId} = ${context.userId}`
      : sql``;
  const sinceCondition =
    context.sinceMs > 0
      ? sql`AND ${assets.createdAt} >= ${context.sinceMs}`
      : sql``;
  return sql`
    scoped_assets AS (
      SELECT ${assets.id} AS id
      FROM ${assets}
      INNER JOIN ${projects} ON ${projects.id} = ${assets.projectId}
      ${membershipJoin}
      WHERE ${projects.deletedAt} IS NULL
      ${sinceCondition}
    )`;
}

const executionDurationSql = sql`
  CASE
    WHEN status IN ('succeeded', 'failed', 'cancelled')
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
    THEN MAX(0, completed_at - started_at)
    ELSE NULL
  END`;

const queueDurationSql = sql`
  CASE
    WHEN status IN ('succeeded', 'failed', 'cancelled')
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
    THEN MAX(0, started_at - created_at)
    ELSE NULL
  END`;

const providerSql = sql`
  CASE
    WHEN model_key LIKE 'seedream-%' OR model_key LIKE 'seedance-%' THEN 'ark'
    WHEN model_key LIKE 'coze-%' THEN 'coze'
    WHEN model_key LIKE 'modelscope-%' THEN 'modelscope'
    ELSE 'internal'
  END`;

function numberValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timingMetrics(
  row: Pick<
    SummaryRow & PercentileRow,
    | "terminalCount"
    | "timingSampleCount"
    | "executionAverageDurationMs"
    | "queueP50DurationMs"
    | "queueP95DurationMs"
    | "executionP50DurationMs"
    | "executionP95DurationMs"
  >
): StatsTimingMetrics {
  return {
    terminalCount: numberValue(row.terminalCount),
    sampleCount: numberValue(row.timingSampleCount),
    queueP50DurationMs: nullableNumber(row.queueP50DurationMs),
    queueP95DurationMs: nullableNumber(row.queueP95DurationMs),
    executionAverageDurationMs: nullableNumber(row.executionAverageDurationMs),
    executionP50DurationMs: nullableNumber(row.executionP50DurationMs),
    executionP95DurationMs: nullableNumber(row.executionP95DurationMs),
  };
}

function roundedMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function shanghaiDayStart(nowMs: number): number {
  const shifted = new Date(nowMs + SHANGHAI_OFFSET_MS);
  return (
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate()
    ) - SHANGHAI_OFFSET_MS
  );
}

function shanghaiDateKey(timestampMs: number): string {
  return new Date(timestampMs + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

function displayDate(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}/${day}`;
}

function operationTime(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

const ACCURACY_ORDER: Record<CostAccuracy, number> = {
  none: 0,
  actual: 1,
  exact: 2,
  approx: 3,
  rough: 4,
};

function mergedAccuracy(
  current: CostAccuracy,
  next: CostAccuracy
): CostAccuracy {
  if (next === "none") return current;
  if (current === "none") return next;
  return ACCURACY_ORDER[next] > ACCURACY_ORDER[current] ? next : current;
}

function updateBreakdown(
  map: Map<string, RankBreakdown>,
  id: string,
  kind: string,
  cost: number | null
): void {
  const row = map.get(id) ?? { byKind: {}, estimatedCost: 0 };
  row.byKind[kind] = (row.byKind[kind] ?? 0) + 1;
  if (cost !== null) row.estimatedCost += cost;
  map.set(id, row);
}

function updateModelDimensionCost(
  map: ModelDimensionCosts,
  modelKey: string,
  id: string,
  cost: number | null
): void {
  if (cost === null) return;
  const model = map.get(modelKey) ?? new Map<string, number>();
  model.set(id, (model.get(id) ?? 0) + cost);
  map.set(modelKey, model);
}

function groupModelDimensionRows(rows: ModelDimensionRow[]): ModelDimensionRows {
  const grouped = new Map<string, ModelDimensionRow[]>();
  for (const row of rows) {
    const modelRows = grouped.get(row.modelKey) ?? [];
    modelRows.push(row);
    grouped.set(row.modelKey, modelRows);
  }
  return grouped;
}

function compareNames(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function buildModelDistribution(
  rowsByModel: ModelDimensionRows,
  costsByModel: ModelDimensionCosts,
  modelKey: string
): DashboardStatsResponse["byModel"][number]["distribution"]["projects"] {
  const costs = costsByModel.get(modelKey);
  const items = (rowsByModel.get(modelKey) ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      total: numberValue(row.total),
      succeeded: numberValue(row.succeeded),
      failed: numberValue(row.failed),
      estimatedCost: costs?.has(row.id)
        ? roundedMoney(costs.get(row.id) ?? 0)
        : null,
    }))
    .sort((a, b) => {
      const costDifference =
        (b.estimatedCost ?? -1) - (a.estimatedCost ?? -1);
      if (costDifference !== 0) return costDifference;
      if (b.total !== a.total) return b.total - a.total;
      const nameDifference = compareNames(a.name, b.name);
      return nameDifference || compareNames(a.id, b.id);
    });
  return {
    total: items.length,
    items: items.slice(0, MODEL_DISTRIBUTION_LIMIT),
  };
}

function loadTaskSummary(
  database: StatsDatabase,
  context: StatsScopeContext
): SummaryRow {
  const row = database.get<SummaryRow>(sql`
    WITH ${scopedTasksCte(context)},
    task_metrics AS (
      SELECT *, ${executionDurationSql} AS execution_duration_ms
      FROM scoped_tasks
    )
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END), 0) AS retryCount,
      COALESCE(SUM(CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN 1 ELSE 0 END), 0) AS terminalCount,
      COALESCE(SUM(CASE WHEN execution_duration_ms IS NOT NULL THEN 1 ELSE 0 END), 0) AS timingSampleCount,
      ROUND(AVG(execution_duration_ms)) AS executionAverageDurationMs
    FROM task_metrics`);
  return {
    total: numberValue(row?.total),
    succeeded: numberValue(row?.succeeded),
    failed: numberValue(row?.failed),
    retryCount: numberValue(row?.retryCount),
    terminalCount: numberValue(row?.terminalCount),
    timingSampleCount: numberValue(row?.timingSampleCount),
    executionAverageDurationMs: nullableNumber(row?.executionAverageDurationMs),
  };
}

function loadGlobalPercentiles(
  database: StatsDatabase,
  context: StatsScopeContext
): PercentileRow {
  const row = database.get<PercentileRow>(sql`
    WITH ${scopedTasksCte(context)},
    timings AS (
      SELECT
        ${queueDurationSql} AS queue_duration_ms,
        ${executionDurationSql} AS execution_duration_ms
      FROM scoped_tasks
      WHERE status IN ('succeeded', 'failed', 'cancelled')
    ),
    queue_ranked AS (
      SELECT
        queue_duration_ms AS duration_ms,
        ROW_NUMBER() OVER (ORDER BY queue_duration_ms) AS row_number,
        COUNT(*) OVER () AS row_count
      FROM timings
      WHERE queue_duration_ms IS NOT NULL
    ),
    execution_ranked AS (
      SELECT
        execution_duration_ms AS duration_ms,
        ROW_NUMBER() OVER (ORDER BY execution_duration_ms) AS row_number,
        COUNT(*) OVER () AS row_count
      FROM timings
      WHERE execution_duration_ms IS NOT NULL
    ),
    queue_percentiles AS (
      SELECT
        MAX(CASE WHEN row_number = CAST((row_count * 50 + 99) / 100 AS INTEGER) THEN duration_ms END) AS queueP50DurationMs,
        MAX(CASE WHEN row_number = CAST((row_count * 95 + 99) / 100 AS INTEGER) THEN duration_ms END) AS queueP95DurationMs
      FROM queue_ranked
    ),
    execution_percentiles AS (
      SELECT
        MAX(CASE WHEN row_number = CAST((row_count * 50 + 99) / 100 AS INTEGER) THEN duration_ms END) AS executionP50DurationMs,
        MAX(CASE WHEN row_number = CAST((row_count * 95 + 99) / 100 AS INTEGER) THEN duration_ms END) AS executionP95DurationMs
      FROM execution_ranked
    )
    SELECT * FROM queue_percentiles CROSS JOIN execution_percentiles`);
  return {
    queueP50DurationMs: nullableNumber(row?.queueP50DurationMs),
    queueP95DurationMs: nullableNumber(row?.queueP95DurationMs),
    executionP50DurationMs: nullableNumber(row?.executionP50DurationMs),
    executionP95DurationMs: nullableNumber(row?.executionP95DurationMs),
  };
}

function loadProviderMetrics(
  database: StatsDatabase,
  context: StatsScopeContext
): DashboardStatsResponse["quality"]["byProvider"] {
  const rows = database.all<ProviderRow>(sql`
    WITH ${scopedTasksCte(context)},
    provider_base AS (
      SELECT
        ${providerSql} AS provider,
        status,
        attempt_count,
        ${queueDurationSql} AS queue_duration_ms,
        ${executionDurationSql} AS execution_duration_ms
      FROM scoped_tasks
    ),
    provider_metrics AS (
      SELECT
        provider,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END), 0) AS retryCount,
        COALESCE(SUM(CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN 1 ELSE 0 END), 0) AS terminalCount,
        COALESCE(SUM(CASE WHEN execution_duration_ms IS NOT NULL THEN 1 ELSE 0 END), 0) AS timingSampleCount,
        ROUND(AVG(execution_duration_ms)) AS executionAverageDurationMs
      FROM provider_base
      GROUP BY provider
    ),
    queue_ranked AS (
      SELECT
        provider,
        queue_duration_ms AS duration_ms,
        ROW_NUMBER() OVER (PARTITION BY provider ORDER BY queue_duration_ms) AS row_number,
        COUNT(*) OVER (PARTITION BY provider) AS row_count
      FROM provider_base
      WHERE queue_duration_ms IS NOT NULL
    ),
    execution_ranked AS (
      SELECT
        provider,
        execution_duration_ms AS duration_ms,
        ROW_NUMBER() OVER (PARTITION BY provider ORDER BY execution_duration_ms) AS row_number,
        COUNT(*) OVER (PARTITION BY provider) AS row_count
      FROM provider_base
      WHERE execution_duration_ms IS NOT NULL
    ),
    queue_percentiles AS (
      SELECT
        provider,
        MAX(CASE WHEN row_number = CAST((row_count * 50 + 99) / 100 AS INTEGER) THEN duration_ms END) AS queueP50DurationMs,
        MAX(CASE WHEN row_number = CAST((row_count * 95 + 99) / 100 AS INTEGER) THEN duration_ms END) AS queueP95DurationMs
      FROM queue_ranked
      GROUP BY provider
    ),
    execution_percentiles AS (
      SELECT
        provider,
        MAX(CASE WHEN row_number = CAST((row_count * 50 + 99) / 100 AS INTEGER) THEN duration_ms END) AS executionP50DurationMs,
        MAX(CASE WHEN row_number = CAST((row_count * 95 + 99) / 100 AS INTEGER) THEN duration_ms END) AS executionP95DurationMs
      FROM execution_ranked
      GROUP BY provider
    )
    SELECT
      provider_metrics.*,
      queue_percentiles.queueP50DurationMs,
      queue_percentiles.queueP95DurationMs,
      execution_percentiles.executionP50DurationMs,
      execution_percentiles.executionP95DurationMs
    FROM provider_metrics
    LEFT JOIN queue_percentiles USING (provider)
    LEFT JOIN execution_percentiles USING (provider)
    ORDER BY provider_metrics.total DESC, provider_metrics.provider ASC`);
  return rows.map((row) => {
    const provider = row.provider as TaskProvider;
    return {
      provider,
      label: TASK_PROVIDER_LABEL[provider] ?? row.provider,
      total: numberValue(row.total),
      succeeded: numberValue(row.succeeded),
      failed: numberValue(row.failed),
      retryCount: numberValue(row.retryCount),
      timing: timingMetrics(row),
    };
  });
}

function loadErrorMetrics(
  database: StatsDatabase,
  context: StatsScopeContext
): DashboardStatsResponse["quality"]["byError"] {
  return database
    .all<{ code: string; count: number }>(sql`
      WITH ${scopedTasksCte(context)}
      SELECT
        COALESCE(NULLIF(TRIM(error_code), ''), 'UNKNOWN_TASK_FAILURE') AS code,
        COUNT(*) AS count
      FROM scoped_tasks
      WHERE status = 'failed'
      GROUP BY COALESCE(NULLIF(TRIM(error_code), ''), 'UNKNOWN_TASK_FAILURE')
      ORDER BY count DESC, code ASC
      LIMIT 10`)
    .map((row) => ({ code: row.code, count: numberValue(row.count) }));
}

function loadKindMetrics(
  database: StatsDatabase,
  context: StatsScopeContext
): DashboardStatsResponse["byKind"] {
  return database
    .all<{ kind: string; count: number }>(sql`
      WITH ${scopedTasksCte(context)}
      SELECT kind, COUNT(*) AS count
      FROM scoped_tasks
      GROUP BY kind
      ORDER BY count DESC, kind ASC`)
    .map((row) => ({ kind: row.kind, count: numberValue(row.count) }));
}

function loadTrend(
  database: StatsDatabase,
  context: StatsScopeContext
): DashboardStatsResponse["trend"] {
  const spanDays = context.days > 0 ? context.days : 30;
  const todayStart = shanghaiDayStart(context.generatedAtMs);
  const trendStart = todayStart - (spanDays - 1) * DAY_MS;
  const rows = database.all<{ dateKey: string; count: number }>(sql`
    WITH ${scopedTasksCte(context)}
    SELECT
      strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '+8 hours') AS dateKey,
      COUNT(*) AS count
    FROM scoped_tasks
    WHERE created_at >= ${trendStart}
    GROUP BY dateKey
    ORDER BY dateKey ASC`);
  const counts = new Map(rows.map((row) => [row.dateKey, numberValue(row.count)]));
  return Array.from({ length: spanDays }, (_, index) => {
    const timestamp = trendStart + index * DAY_MS;
    const dateKey = shanghaiDateKey(timestamp);
    return { date: displayDate(dateKey), count: counts.get(dateKey) ?? 0 };
  });
}

function loadModelMetrics(
  database: StatsDatabase,
  context: StatsScopeContext
): ModelRow[] {
  return database.all<ModelRow>(sql`
    WITH ${scopedTasksCte(context)},
    model_base AS (
      SELECT
        model_key,
        status,
        attempt_count,
        ${queueDurationSql} AS queue_duration_ms,
        ${executionDurationSql} AS execution_duration_ms
      FROM scoped_tasks
    ),
    model_metrics AS (
      SELECT
        model_key AS modelKey,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END), 0) AS retryCount,
        COALESCE(SUM(CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN 1 ELSE 0 END), 0) AS terminalCount,
        COALESCE(SUM(CASE WHEN execution_duration_ms IS NOT NULL THEN 1 ELSE 0 END), 0) AS timingSampleCount,
        ROUND(AVG(execution_duration_ms)) AS executionAverageDurationMs
      FROM model_base
      GROUP BY model_key
    ),
    queue_ranked AS (
      SELECT
        model_key,
        queue_duration_ms AS duration_ms,
        ROW_NUMBER() OVER (PARTITION BY model_key ORDER BY queue_duration_ms) AS row_number,
        COUNT(*) OVER (PARTITION BY model_key) AS row_count
      FROM model_base
      WHERE queue_duration_ms IS NOT NULL
    ),
    execution_ranked AS (
      SELECT
        model_key,
        execution_duration_ms AS duration_ms,
        ROW_NUMBER() OVER (PARTITION BY model_key ORDER BY execution_duration_ms) AS row_number,
        COUNT(*) OVER (PARTITION BY model_key) AS row_count
      FROM model_base
      WHERE execution_duration_ms IS NOT NULL
    ),
    queue_percentiles AS (
      SELECT
        model_key,
        MAX(CASE WHEN row_number = CAST((row_count * 50 + 99) / 100 AS INTEGER) THEN duration_ms END) AS queueP50DurationMs,
        MAX(CASE WHEN row_number = CAST((row_count * 95 + 99) / 100 AS INTEGER) THEN duration_ms END) AS queueP95DurationMs
      FROM queue_ranked
      GROUP BY model_key
    ),
    execution_percentiles AS (
      SELECT
        model_key,
        MAX(CASE WHEN row_number = CAST((row_count * 50 + 99) / 100 AS INTEGER) THEN duration_ms END) AS executionP50DurationMs,
        MAX(CASE WHEN row_number = CAST((row_count * 95 + 99) / 100 AS INTEGER) THEN duration_ms END) AS executionP95DurationMs
      FROM execution_ranked
      GROUP BY model_key
    )
    SELECT
      model_metrics.*,
      queue_percentiles.queueP50DurationMs,
      queue_percentiles.queueP95DurationMs,
      execution_percentiles.executionP50DurationMs,
      execution_percentiles.executionP95DurationMs
    FROM model_metrics
    LEFT JOIN queue_percentiles ON queue_percentiles.model_key = model_metrics.modelKey
    LEFT JOIN execution_percentiles ON execution_percentiles.model_key = model_metrics.modelKey
    ORDER BY model_metrics.total DESC, model_metrics.modelKey ASC`);
}

function loadModelErrorMetrics(
  database: StatsDatabase,
  context: StatsScopeContext
): Map<string, DashboardStatsResponse["quality"]["byError"]> {
  const rows = database.all<ModelErrorRow>(sql`
    WITH ${scopedTasksCte(context)},
    model_errors AS (
      SELECT
        model_key AS modelKey,
        COALESCE(NULLIF(TRIM(error_code), ''), 'UNKNOWN_TASK_FAILURE') AS code,
        COUNT(*) AS count
      FROM scoped_tasks
      WHERE status = 'failed'
      GROUP BY
        model_key,
        COALESCE(NULLIF(TRIM(error_code), ''), 'UNKNOWN_TASK_FAILURE')
    ),
    ranked AS (
      SELECT
        modelKey,
        code,
        count,
        ROW_NUMBER() OVER (
          PARTITION BY modelKey
          ORDER BY count DESC, code ASC
        ) AS error_rank
      FROM model_errors
    )
    SELECT modelKey, code, count
    FROM ranked
    WHERE error_rank <= 5
    ORDER BY modelKey ASC, error_rank ASC`);
  const byModel = new Map<
    string,
    DashboardStatsResponse["quality"]["byError"]
  >();
  for (const row of rows) {
    const errors = byModel.get(row.modelKey) ?? [];
    errors.push({ code: row.code, count: numberValue(row.count) });
    byModel.set(row.modelKey, errors);
  }
  return byModel;
}

function loadModelDimensionMetrics(
  database: StatsDatabase,
  context: StatsScopeContext,
  dimension: ModelDimension
): ModelDimensionRow[] {
  if (dimension === "user" && context.scope !== "all") return [];
  const idField =
    dimension === "project"
      ? sql`scoped_tasks.project_id`
      : sql`scoped_tasks.user_id`;
  const nameField =
    dimension === "project"
      ? sql`${projects.name}`
      : sql`COALESCE(${users.name}, '（未知用户）')`;
  const dimensionJoin =
    dimension === "project"
      ? sql`INNER JOIN ${projects} ON ${projects.id} = scoped_tasks.project_id`
      : sql`LEFT JOIN ${users} ON ${users.id} = scoped_tasks.user_id`;
  return database.all<ModelDimensionRow>(sql`
    WITH ${scopedTasksCte(context)}
    SELECT
      scoped_tasks.model_key AS modelKey,
      ${idField} AS id,
      ${nameField} AS name,
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN scoped_tasks.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
      COALESCE(SUM(CASE WHEN scoped_tasks.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM scoped_tasks
    ${dimensionJoin}
    GROUP BY scoped_tasks.model_key, ${idField}, ${nameField}
    ORDER BY scoped_tasks.model_key ASC, total DESC, name COLLATE NOCASE ASC, id ASC`);
}

function loadCostTasks(
  database: StatsDatabase,
  context: StatsScopeContext
): CostTaskRow[] {
  return database.all<CostTaskRow>(sql`
    WITH ${scopedTasksCte(context)}
    SELECT
      scoped_tasks.project_id AS projectId,
      scoped_tasks.user_id AS userId,
      scoped_tasks.kind AS kind,
      scoped_tasks.model_key AS modelKey,
      scoped_tasks.input_json AS inputJson,
      scoped_tasks.usage_json AS usageJson,
      ${assets.metaJson} AS assetMetaJson
    FROM scoped_tasks
    LEFT JOIN ${assets} ON ${assets.id} = scoped_tasks.output_asset_id
    WHERE scoped_tasks.status = 'succeeded'
    ORDER BY scoped_tasks.created_at ASC, scoped_tasks.id ASC`);
}

function loadAssetCount(
  database: StatsDatabase,
  context: StatsScopeContext
): number {
  const row = database.get<{ assetCount: number }>(sql`
    WITH ${scopedAssetsCte(context)}
    SELECT COUNT(*) AS assetCount
    FROM scoped_assets`);
  return numberValue(row?.assetCount);
}

function loadEngagementMetrics(
  database: StatsDatabase,
  context: StatsScopeContext
): DashboardStatsResponse["engagement"] {
  const row = database.get<EngagementRow>(sql`
    WITH ${scopedTasksCte(context)},
    successful_results AS (
      SELECT id
      FROM scoped_tasks
      WHERE status = 'succeeded' AND output_asset_id IS NOT NULL
    )
    SELECT
      COUNT(DISTINCT successful_results.id) AS resultCount,
      COUNT(DISTINCT CASE
        WHEN ${productEvents.action} = 'download' THEN successful_results.id
      END) AS downloadedCount,
      COUNT(DISTINCT CASE
        WHEN ${productEvents.action} = 'reuse' THEN successful_results.id
      END) AS reusedCount,
      COUNT(DISTINCT CASE
        WHEN ${productEvents.action} = 'regenerate' THEN successful_results.id
      END) AS regeneratedCount
    FROM successful_results
    LEFT JOIN ${productEvents}
      ON ${productEvents.taskId} = successful_results.id`);
  const resultCount = numberValue(row?.resultCount);
  const downloadedCount = numberValue(row?.downloadedCount);
  const reusedCount = numberValue(row?.reusedCount);
  const regeneratedCount = numberValue(row?.regeneratedCount);
  const rate = (count: number) =>
    resultCount ? Math.round((count / resultCount) * 100) : 0;
  return {
    resultCount,
    downloadedCount,
    downloadRate: rate(downloadedCount),
    reusedCount,
    reuseRate: rate(reusedCount),
    regeneratedCount,
    regenerateRate: rate(regeneratedCount),
  };
}

function loadActiveUsers(
  database: StatsDatabase,
  context: StatsScopeContext
): number {
  if (context.scope !== "all") return 0;
  const sinceCondition =
    context.sinceMs > 0
      ? sql`AND ${users.lastSeenAt} >= ${context.sinceMs}`
      : sql``;
  const row = database.get<{ total: number }>(sql`
    SELECT COUNT(*) AS total
    FROM ${users}
    WHERE ${users.lastSeenAt} IS NOT NULL
    ${sinceCondition}`);
  return numberValue(row?.total);
}

function loadOperations(
  database: StatsDatabase,
  context: StatsScopeContext
): DashboardStatsResponse["operations"] {
  if (context.scope !== "all") return [];
  return database
    .select()
    .from(operationHealth)
    .all()
    .map((row) => {
      if (
        row.key !== "backup" &&
        row.key !== "bridge-sweep" &&
        row.key !== "data-integrity"
      ) {
        return null;
      }
      let metrics: Record<string, unknown> | null = null;
      if (row.metricsJson) {
        try {
          metrics = JSON.parse(row.metricsJson) as Record<string, unknown>;
        } catch {
          metrics = null;
        }
      }
      return {
        key: row.key,
        status: row.status,
        metrics,
        errorRequestId: row.errorRequestId,
        alertActive: row.alertActive,
        lastRunAt: row.lastRunAt.toISOString(),
        lastSuccessAt: operationTime(row.lastSuccessAt),
        lastFailureAt: operationTime(row.lastFailureAt),
        updatedAt: row.updatedAt.toISOString(),
      };
    })
    .filter((row): row is DashboardStatsResponse["operations"][number] => !!row);
}

export function statsSnapshotCacheKey(input: DashboardStatsLoadInput): string {
  return [input.scope, input.scope === "all" ? "*" : input.userId, input.days].join(":");
}

export function loadDashboardStatsSnapshot(
  database: StatsDatabase,
  input: DashboardStatsLoadInput
): DashboardStatsSnapshot {
  const generatedAtMs = input.nowMs ?? Date.now();
  const context: StatsScopeContext = {
    scope: input.scope,
    userId: input.userId,
    days: input.days,
    generatedAtMs,
    sinceMs: input.days > 0 ? generatedAtMs - input.days * DAY_MS : 0,
  };

  return database.transaction(() => {
    const taskSummary = loadTaskSummary(database, context);
    const percentiles = loadGlobalPercentiles(database, context);
    const assetCount = loadAssetCount(database, context);
    const engagement = loadEngagementMetrics(database, context);
    const modelRows = loadModelMetrics(database, context);
    const modelErrors = loadModelErrorMetrics(database, context);
    const modelProjectRows = groupModelDimensionRows(
      loadModelDimensionMetrics(database, context, "project")
    );
    const modelUserRows = groupModelDimensionRows(
      loadModelDimensionMetrics(database, context, "user")
    );
    const costRows = loadCostTasks(database, context);
    const projectBreakdown = new Map<string, RankBreakdown>();
    const userBreakdown = new Map<string, RankBreakdown>();
    const modelProjectCosts = new Map<string, Map<string, number>>();
    const modelUserCosts = new Map<string, Map<string, number>>();
    const modelCosts = new Map<
      string,
      { estimatedCost: number; accuracy: CostAccuracy }
    >();
    let estimatedCost = 0;

    for (const task of costRows) {
      const estimate = estimateTaskCost(task, task.assetMetaJson);
      if (estimate.yuan !== null) estimatedCost += estimate.yuan;
      updateBreakdown(projectBreakdown, task.projectId, task.kind, estimate.yuan);
      updateBreakdown(userBreakdown, task.userId, task.kind, estimate.yuan);
      updateModelDimensionCost(
        modelProjectCosts,
        task.modelKey,
        task.projectId,
        estimate.yuan
      );
      updateModelDimensionCost(
        modelUserCosts,
        task.modelKey,
        task.userId,
        estimate.yuan
      );
      const model = modelCosts.get(task.modelKey) ?? {
        estimatedCost: 0,
        accuracy: "none" as CostAccuracy,
      };
      if (estimate.yuan !== null) model.estimatedCost += estimate.yuan;
      model.accuracy = mergedAccuracy(model.accuracy, estimate.accuracy);
      modelCosts.set(task.modelKey, model);
    }

    const byModel = modelRows.map((row) => {
      const cost = modelCosts.get(row.modelKey) ?? {
        estimatedCost: 0,
        accuracy: "none" as CostAccuracy,
      };
      return {
        modelKey: row.modelKey,
        label: modelDisplayName(row.modelKey),
        total: numberValue(row.total),
        succeeded: numberValue(row.succeeded),
        failed: numberValue(row.failed),
        estimatedCost:
          cost.accuracy === "none" ? null : roundedMoney(cost.estimatedCost),
        accuracy: cost.accuracy,
        retryCount: numberValue(row.retryCount),
        timing: timingMetrics(row),
        errors: modelErrors.get(row.modelKey) ?? [],
        distribution: {
          projects: buildModelDistribution(
            modelProjectRows,
            modelProjectCosts,
            row.modelKey
          ),
          users: buildModelDistribution(
            modelUserRows,
            modelUserCosts,
            row.modelKey
          ),
        },
      };
    });

    const successRate = taskSummary.total
      ? Math.round((taskSummary.succeeded / taskSummary.total) * 100)
      : 0;
    return {
      context,
      projectBreakdown,
      userBreakdown,
      data: {
        days: input.days,
        scope: input.scope,
        generatedAt: new Date(generatedAtMs).toISOString(),
        summary: {
          total: taskSummary.total,
          succeeded: taskSummary.succeeded,
          failed: taskSummary.failed,
          successRate,
          assetCount,
          activeUsers: loadActiveUsers(database, context),
          estimatedCost: roundedMoney(estimatedCost),
        },
        engagement,
        quality: {
          summary: {
            retryCount: taskSummary.retryCount,
            timing: timingMetrics({ ...taskSummary, ...percentiles }),
          },
          byProvider: loadProviderMetrics(database, context),
          byError: loadErrorMetrics(database, context),
        },
        operations: loadOperations(database, context),
        trend: loadTrend(database, context),
        byKind: loadKindMetrics(database, context),
        byModel,
      },
    };
  });
}

function loadRankCount(
  database: StatsDatabase,
  context: StatsScopeContext,
  dimension: "project" | "user"
): number {
  const field = dimension === "project" ? sql`project_id` : sql`user_id`;
  const row = database.get<{ total: number }>(sql`
    WITH ${scopedTasksCte(context)}
    SELECT COUNT(*) AS total
    FROM (
      SELECT ${field}
      FROM scoped_tasks
      GROUP BY ${field}
    )`);
  return numberValue(row?.total);
}

function loadProjectRankPage(
  database: StatsDatabase,
  snapshot: DashboardStatsSnapshot,
  requestedPage: number,
  pageSize: number
): { items: StatsRankRow[]; pageInfo: StatsPageInfo } {
  const total = loadRankCount(database, snapshot.context, "project");
  const pageInfo = statsPageInfo(total, requestedPage, pageSize);
  if (!total) return { items: [], pageInfo };
  const offset = (pageInfo.page - 1) * pageInfo.pageSize;
  const rows = database.all<
    Omit<StatsRankRow, "byKind" | "estimatedCost">
  >(sql`
    WITH ${scopedTasksCte(snapshot.context)}
    SELECT
      scoped_tasks.project_id AS id,
      ${projects.name} AS name,
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN scoped_tasks.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM scoped_tasks
    INNER JOIN ${projects} ON ${projects.id} = scoped_tasks.project_id
    GROUP BY scoped_tasks.project_id, ${projects.name}
    ORDER BY total DESC, name COLLATE NOCASE ASC, id ASC
    LIMIT ${pageInfo.pageSize} OFFSET ${offset}`);
  return {
    items: rows.map((row) => {
      const breakdown = snapshot.projectBreakdown.get(row.id) ?? {
        byKind: {},
        estimatedCost: 0,
      };
      return {
        id: row.id,
        name: row.name,
        total: numberValue(row.total),
        failed: numberValue(row.failed),
        byKind: breakdown.byKind,
        estimatedCost: roundedMoney(breakdown.estimatedCost),
      };
    }),
    pageInfo,
  };
}

function loadUserRankPage(
  database: StatsDatabase,
  snapshot: DashboardStatsSnapshot,
  requestedPage: number,
  pageSize: number
): { items: StatsRankRow[]; pageInfo: StatsPageInfo } {
  if (snapshot.context.scope !== "all") {
    return { items: [], pageInfo: statsPageInfo(0, 1, pageSize) };
  }
  const total = loadRankCount(database, snapshot.context, "user");
  const pageInfo = statsPageInfo(total, requestedPage, pageSize);
  if (!total) return { items: [], pageInfo };
  const offset = (pageInfo.page - 1) * pageInfo.pageSize;
  const rows = database.all<
    Omit<StatsRankRow, "byKind" | "estimatedCost">
  >(sql`
    WITH ${scopedTasksCte(snapshot.context)}
    SELECT
      scoped_tasks.user_id AS id,
      COALESCE(${users.name}, '（未知用户）') AS name,
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN scoped_tasks.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM scoped_tasks
    LEFT JOIN ${users} ON ${users.id} = scoped_tasks.user_id
    GROUP BY scoped_tasks.user_id, ${users.name}
    ORDER BY total DESC, name COLLATE NOCASE ASC, id ASC
    LIMIT ${pageInfo.pageSize} OFFSET ${offset}`);
  return {
    items: rows.map((row) => {
      const breakdown = snapshot.userBreakdown.get(row.id) ?? {
        byKind: {},
        estimatedCost: 0,
      };
      return {
        id: row.id,
        name: row.name,
        total: numberValue(row.total),
        failed: numberValue(row.failed),
        byKind: breakdown.byKind,
        estimatedCost: roundedMoney(breakdown.estimatedCost),
      };
    }),
    pageInfo,
  };
}

export function loadDashboardStatsRankings(
  database: StatsDatabase,
  snapshot: DashboardStatsSnapshot,
  input: { projectPage: number; userPage: number; pageSize: number }
): DashboardStatsRankings {
  return database.transaction(() => {
    const projectsPage = loadProjectRankPage(
      database,
      snapshot,
      input.projectPage,
      input.pageSize
    );
    const usersPage = loadUserRankPage(
      database,
      snapshot,
      input.userPage,
      input.pageSize
    );
    return {
      byProject: projectsPage.items,
      byUser: usersPage.items,
      pagination: {
        projects: projectsPage.pageInfo,
        users: usersPage.pageInfo,
      },
    };
  });
}
