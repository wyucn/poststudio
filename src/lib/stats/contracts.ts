export type StatsScope = "all" | "mine";
export type CostAccuracy = "actual" | "exact" | "approx" | "rough" | "none";

export interface StatsPageInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface StatsRankRow {
  id: string;
  name: string;
  total: number;
  failed: number;
  byKind: Record<string, number>;
  estimatedCost: number;
}

export interface StatsModelDistributionRow {
  id: string;
  name: string;
  total: number;
  succeeded: number;
  failed: number;
  estimatedCost: number | null;
}

export interface StatsModelDistribution {
  total: number;
  items: StatsModelDistributionRow[];
}

export interface StatsTimingMetrics {
  terminalCount: number;
  sampleCount: number;
  queueP50DurationMs: number | null;
  queueP95DurationMs: number | null;
  executionAverageDurationMs: number | null;
  executionP50DurationMs: number | null;
  executionP95DurationMs: number | null;
}

export interface StatsModelRow {
  modelKey: string;
  label: string;
  total: number;
  succeeded: number;
  failed: number;
  estimatedCost: number | null;
  accuracy: CostAccuracy;
  retryCount: number;
  timing: StatsTimingMetrics;
  errors: StatsErrorRow[];
  distribution: {
    projects: StatsModelDistribution;
    users: StatsModelDistribution;
  };
}

export interface StatsProviderRow {
  provider: string;
  label: string;
  total: number;
  succeeded: number;
  failed: number;
  retryCount: number;
  timing: StatsTimingMetrics;
}

export interface StatsErrorRow {
  code: string;
  count: number;
}

export interface StatsOperationRow {
  key: "backup" | "bridge-sweep" | "data-integrity";
  status: "ok" | "failed" | "skipped";
  metrics: Record<string, unknown> | null;
  errorRequestId: string | null;
  alertActive: boolean;
  lastRunAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  updatedAt: string;
}

export interface DashboardStatsResponse {
  days: number;
  scope: StatsScope;
  generatedAt: string;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number;
    assetCount: number;
    activeUsers: number;
    estimatedCost: number;
  };
  engagement: {
    resultCount: number;
    downloadedCount: number;
    downloadRate: number;
    reusedCount: number;
    reuseRate: number;
    regeneratedCount: number;
    regenerateRate: number;
  };
  quality: {
    summary: {
      retryCount: number;
      timing: StatsTimingMetrics;
    };
    byProvider: StatsProviderRow[];
    byError: StatsErrorRow[];
  };
  operations: StatsOperationRow[];
  trend: Array<{ date: string; count: number }>;
  byKind: Array<{ kind: string; count: number }>;
  byModel: StatsModelRow[];
  byProject: StatsRankRow[];
  byUser: StatsRankRow[];
  pagination: {
    projects: StatsPageInfo;
    users: StatsPageInfo;
  };
}

export interface StatsQuery {
  days: number;
  projectPage: number;
  userPage: number;
  pageSize: number;
}

function integerParam(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function parseStatsQuery(url: string): StatsQuery {
  const params = new URL(url).searchParams;
  const requestedDays = integerParam(params.get("days"), 30);
  const requestedPageSize = integerParam(params.get("pageSize"), 10);
  return {
    days:
      requestedDays === 0
        ? 0
        : Math.min(365, Math.max(1, requestedDays)),
    projectPage: Math.max(1, integerParam(params.get("projectPage"), 1)),
    userPage: Math.max(1, integerParam(params.get("userPage"), 1)),
    pageSize: Math.min(50, Math.max(1, requestedPageSize)),
  };
}

export function statsPageInfo(
  total: number,
  requestedPage: number,
  pageSize: number
): StatsPageInfo {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}
