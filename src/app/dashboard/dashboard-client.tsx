"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudCog,
  CircleAlert,
  CircleCheck,
  FolderKanban,
  RotateCcw,
  Settings2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { SelectionIndicator } from "@/components/ui/selection-indicator";
import { StatusMessage } from "@/components/ui/status-message";
import { DeferredDashboardCharts } from "./deferred-dashboard-charts";
import type {
  DashboardStatsResponse,
  StatsPageInfo,
  StatsRankRow,
} from "@/lib/stats/contracts";

type StatsData = DashboardStatsResponse;
type ModelStat = StatsData["byModel"][number];
type ProviderMetric = StatsData["quality"]["byProvider"][number];
type ErrorMetric = StatsData["quality"]["byError"][number];
type TimingMetric = StatsData["quality"]["summary"]["timing"];
type OperationHealthRow = StatsData["operations"][number];
type StatRow = StatsRankRow;

const KIND_LABEL: Record<string, string> = {
  text: "文案",
  image: "图像",
  video: "视频",
  audio: "音频",
  music: "音乐",
  edit: "剪辑",
};
const ACCURACY_NOTE: Record<string, string> = {
  actual: "真实用量",
  exact: "按张精确",
  approx: "按分辨率×时长估算",
  rough: "粗估",
  none: "不计费用",
};

const RANGES = [
  { label: "近 7 天", days: 7 },
  { label: "近 30 天", days: 30 },
  { label: "全部", days: 0 },
];

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function timingCoverage(sampleCount: number, terminalCount: number): string {
  const rate = terminalCount
    ? Math.round((sampleCount / terminalCount) * 100)
    : 0;
  return `${sampleCount}/${terminalCount}（${rate}%）`;
}

export function DashboardClient({ isAdmin }: { isAdmin: boolean }) {
  const [days, setDays] = useState(30);
  const [projectPage, setProjectPage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const { data, isLoading, isError, isFetching } = useQuery<StatsData>({
    queryKey: ["dashboard-stats", days, projectPage, userPage],
    queryFn: () => {
      const params = new URLSearchParams({
        days: String(days),
        projectPage: String(projectPage),
        userPage: String(userPage),
        pageSize: "10",
      });
      return api(`/api/stats?${params.toString()}`);
    },
    placeholderData: (previous) =>
      previous?.days === days ? previous : undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-primary/70">
            {"// dashboard"}
          </p>
          <h1 className="text-title flex items-center gap-2 text-2xl font-bold">
            控制台
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
              {isAdmin ? "全平台" : "我的用量"}
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/models">
                <Settings2 /> 模型配置
              </Link>
            </Button>
          )}
          <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => {
                  setDays(r.days);
                  setProjectPage(1);
                  setUserPage(1);
                }}
                aria-pressed={days === r.days}
                className={`focus-ring flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors ${
                  days === r.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <SelectionIndicator selected={days === r.days} />
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="正在加载控制台数据…" />
      ) : isError || !data ? (
        <StatusMessage tone="danger">统计数据加载失败，请稍后重试。</StatusMessage>
      ) : (
        <DashboardBody
          data={data}
          isAdmin={isAdmin}
          rankingLoading={isFetching}
          onProjectPageChange={setProjectPage}
          onUserPageChange={setUserPage}
        />
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  hint,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={className} data-kpi={label}>
      <CardContent className="space-y-1.5 p-4">
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          data-kpi-value
          className="text-3xl font-bold leading-none tracking-tight lg:text-[2.5rem]"
        >
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        {hint && <p className="text-xs text-warning">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function DashboardBody({
  data,
  isAdmin,
  rankingLoading,
  onProjectPageChange,
  onUserPageChange,
}: {
  data: StatsData;
  isAdmin: boolean;
  rankingLoading: boolean;
  onProjectPageChange: (page: number) => void;
  onUserPageChange: (page: number) => void;
}) {
  const s = data.summary;
  const engagement = data.engagement;
  const timing = data.quality.summary.timing;
  return (
    <div className="space-y-6">
      {/* KPI 卡（成员视角不显示「活跃成员」，改为 4 列） */}
      <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 ${isAdmin ? "2xl:grid-cols-9" : "2xl:grid-cols-8"}`}>
        <KpiCard label="生成任务数" value={s.total.toLocaleString()} sub={`成功 ${s.succeeded} · 失败 ${s.failed}`} />
        <KpiCard label="成功率" value={`${s.successRate}%`} />
        <KpiCard label="累计重试" value={data.quality.summary.retryCount.toLocaleString()} />
        <KpiCard
          label="执行 P95"
          value={formatDuration(timing.executionP95DurationMs)}
          sub={`精确计时 ${timingCoverage(timing.sampleCount, timing.terminalCount)} · 排队 P95 ${formatDuration(timing.queueP95DurationMs)}`}
        />
        <KpiCard
          label="素材产出"
          value={s.assetCount.toLocaleString()}
          sub={`可跟踪生成结果 ${engagement.resultCount}`}
        />
        <KpiCard
          label="结果使用"
          value={`下载 ${engagement.downloadRate}%`}
          sub={`复用 ${engagement.reuseRate}% · 再次生成 ${engagement.regenerateRate}%`}
        />
        <KpiCard
          label="预估消耗"
          value={`¥${s.estimatedCost.toLocaleString()}`}
          hint="预估，以官方账单为准"
          className="2xl:col-span-2"
        />
        {isAdmin && <KpiCard label="活跃成员" value={String(s.activeUsers)} />}
      </div>

      <DeferredDashboardCharts trend={data.trend} byKind={data.byKind} />

      <QualityPanel
        timing={timing}
        providers={data.quality.byProvider}
        errors={data.quality.byError}
      />

      {isAdmin && <OperationsPanel rows={data.operations} />}

      <ModelTable rows={data.byModel} isAdmin={isAdmin} />

      <RankTable
        byProject={data.byProject}
        byUser={data.byUser}
        pagination={data.pagination}
        isAdmin={isAdmin}
        loading={rankingLoading}
        onProjectPageChange={onProjectPageChange}
        onUserPageChange={onUserPageChange}
      />
    </div>
  );
}

const OPERATION_NAME: Record<OperationHealthRow["key"], string> = {
  backup: "每日数据备份",
  "bridge-sweep": "中转桶孤儿清理",
  "data-integrity": "数据库一致性巡检",
};

function operationMetricSummary(row: OperationHealthRow): string {
  const metrics = row.metrics ?? {};
  const number = (key: string) =>
    typeof metrics[key] === "number" ? Number(metrics[key]) : 0;
  if (row.key === "backup") {
    if (metrics.configured === false) return "未配置 Supabase，已跳过";
    if (metrics.writeEnabled === false)
      return "远端备份写入未启用，已跳过";
    const largeFiles = number("largeFilesUploaded");
    const chunks = number("chunkObjectsUploaded");
    const checksums = number("mediaChecksumManifests");
    const purged = number("mediaPurged");
    const pending = number("mediaTombstonesPending");
    const diskUsage = number("diskUsage");
    const capacity =
      metrics.capacityStatus === "critical"
        ? "容量临界"
        : metrics.capacityStatus === "warning"
          ? "容量预警"
          : "容量正常";
    return `数据库快照 ${number("databaseSnapshots")} · 新增媒体 ${number("mediaUploaded")}${checksums ? ` · 校验清单 ${checksums}` : ""}${largeFiles ? ` · 大文件 ${largeFiles} / 分片 ${chunks}` : ""}${purged || pending ? ` · 删除 ${purged} / 待保留 ${pending}` : ""}${diskUsage ? ` · ${capacity} ${Math.round(diskUsage * 100)}%` : ""} · ${formatDuration(number("durationMs"))}`;
  }
  if (row.key === "data-integrity") {
    return `检查 ${number("checkedRelations")} 项 · 阻断 ${number("blockingIssueCount")} · 提示 ${number("advisoryIssueCount")} · 安全修复 ${number("repairedDanglingTaskOutputs")} · ${formatDuration(number("durationMs"))}`;
  }
  if (metrics.configured === false) return "未配置 Supabase，已跳过";
  return `扫描 ${number("scanned")} · 过期 ${number("stale")} · 删除 ${number("deleted")} · 失败 ${number("deleteFailed")} · ${formatDuration(number("durationMs"))}`;
}

function formatOperationTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "尚无";
}

function OperationsPanel({ rows }: { rows: OperationHealthRow[] }) {
  const ordered = ["backup", "data-integrity", "bridge-sweep"]
    .map((key) => rows.find((row) => row.key === key))
    .filter((row): row is OperationHealthRow => !!row);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <CloudCog className="size-4 text-primary" /> 运维健康
          <span className="text-xs font-normal text-muted-foreground">
            备份、数据库一致性与外部媒体中转的最近调度结果
          </span>
        </div>
        {ordered.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">
            调度器尚未完成首轮检查
          </p>
        ) : (
          <div className="divide-y divide-border">
            {ordered.map((row) => {
              const ok = row.status === "ok";
              const skipped = row.status === "skipped";
              return (
                <div
                  key={row.key}
                  className="grid gap-2 py-3 text-sm lg:grid-cols-[12rem_minmax(0,1fr)_15rem] lg:items-center"
                >
                  <div className="flex items-center gap-2 font-medium">
                    {ok ? (
                      <CircleCheck className="size-4 text-success" />
                    ) : (
                      <CircleAlert
                        className={`size-4 ${skipped ? "text-muted-foreground" : "text-destructive"}`}
                      />
                    )}
                    <span>{OPERATION_NAME[row.key]}</span>
                    <span
                      className={`ml-auto rounded-full border px-2 py-0.5 font-mono text-micro ${
                        ok
                          ? "border-success/25 bg-success-muted text-success"
                          : skipped
                            ? "border-border bg-muted text-muted-foreground"
                            : "border-destructive/25 bg-destructive-muted text-destructive"
                      }`}
                    >
                      {ok ? "成功" : skipped ? "已跳过" : "失败"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-muted-foreground">
                      {operationMetricSummary(row)}
                    </p>
                    {row.errorRequestId && (
                      <p className="mt-1 font-mono text-xs text-destructive">
                        错误编号 {row.errorRequestId}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground lg:text-right">
                    <p>最近运行 {formatOperationTime(row.lastRunAt)}</p>
                    <p>最近成功 {formatOperationTime(row.lastSuccessAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QualityPanel({
  timing,
  providers,
  errors,
}: {
  timing: TimingMetric;
  providers: ProviderMetric[];
  errors: ErrorMetric[];
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <Clock3 className="size-4 text-primary" /> 运行质量
          <span className="text-xs font-normal text-muted-foreground">
            成功率、重试、排队与精确执行耗时
          </span>
        </div>
        <div className="mb-4 rounded-md border border-info/30 bg-info-muted px-3 py-2 text-xs text-info">
          精确计时 {timingCoverage(timing.sampleCount, timing.terminalCount)}；仅统计完整
          startedAt → completedAt 样本，历史回退不进入耗时分位数。
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
          <section className="min-w-0">
            {providers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">本期暂无任务质量数据</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[820px]">
                  <div className="grid grid-cols-[1.4fr_repeat(7,minmax(4.5rem,0.7fr))] gap-2 border-b border-border pb-2 font-mono text-xs uppercase text-muted-foreground">
                    <span>供应商</span>
                    <span className="text-right">任务</span>
                    <span className="text-right">成功率</span>
                    <span className="text-right">重试</span>
                    <span className="text-right">精确计时</span>
                    <span className="text-right">排队 P50</span>
                    <span className="text-right">执行 P50</span>
                    <span className="text-right">执行 P95</span>
                  </div>
                  {providers.map((provider) => {
                    const successRate = provider.total
                      ? Math.round((provider.succeeded / provider.total) * 100)
                      : 0;
                    return (
                      <div
                        key={provider.provider}
                        className="grid grid-cols-[1.4fr_repeat(7,minmax(4.5rem,0.7fr))] items-center gap-2 border-b border-border/70 py-2.5 text-sm last:border-0"
                      >
                        <span className="font-medium">{provider.label}</span>
                        <span className="text-right text-muted-foreground">{provider.total}</span>
                        <span className="text-right">{successRate}%</span>
                        <span className="text-right text-muted-foreground">{provider.retryCount}</span>
                        <span className="text-right text-muted-foreground">
                          {provider.timing.sampleCount}/{provider.timing.terminalCount}
                        </span>
                        <span className="text-right text-muted-foreground">
                          {formatDuration(provider.timing.queueP50DurationMs)}
                        </span>
                        <span className="text-right text-muted-foreground">
                          {formatDuration(provider.timing.executionP50DurationMs)}
                        </span>
                        <span className="text-right text-muted-foreground">
                          {formatDuration(provider.timing.executionP95DurationMs)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
          <section className="border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <TriangleAlert className="size-4 text-warning" /> 主要错误类型
            </div>
            {errors.length === 0 ? (
              <p className="text-sm text-muted-foreground">本期没有失败任务</p>
            ) : (
              <div className="space-y-2">
                {errors.map((error) => (
                  <div key={error.code} className="flex items-center gap-3 text-xs">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 text-xs">
                      {error.code}
                    </code>
                    <span className="shrink-0 font-medium">{error.count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function RankTable({
  byProject,
  byUser,
  pagination,
  isAdmin,
  loading,
  onProjectPageChange,
  onUserPageChange,
}: {
  byProject: StatRow[];
  byUser: StatRow[];
  pagination: { projects: StatsPageInfo; users: StatsPageInfo };
  isAdmin: boolean;
  loading: boolean;
  onProjectPageChange: (page: number) => void;
  onUserPageChange: (page: number) => void;
}) {
  const [tab, setTab] = useState<"project" | "user">("project");
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = tab === "project" ? byProject : byUser;
  const pageInfo = tab === "project" ? pagination.projects : pagination.users;
  const onPageChange =
    tab === "project" ? onProjectPageChange : onUserPageChange;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-sm font-medium">{isAdmin ? "项目 / 成员排行" : "我参与的项目"}</span>
          {isAdmin && (
            <div className="flex gap-1 rounded-md border border-border p-0.5">
              <button
                type="button"
                onClick={() => { setTab("project"); setExpanded(null); }}
                aria-pressed={tab === "project"}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                  tab === "project" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                <SelectionIndicator selected={tab === "project"} className="size-3.5" />
                <FolderKanban className="size-3.5" /> 按项目
              </button>
              <button
                type="button"
                onClick={() => { setTab("user"); setExpanded(null); }}
                aria-pressed={tab === "user"}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                  tab === "user" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                <SelectionIndicator selected={tab === "user"} className="size-3.5" />
                <Users className="size-3.5" /> 按成员
              </button>
            </div>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">本期暂无数据</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const open = expanded === r.id;
              return (
                <div key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-muted/40"
                    onClick={() => setExpanded(open ? null : r.id)}
                    aria-expanded={open}
                  >
                    {open ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="w-16 text-right text-muted-foreground">{r.total} 次</span>
                    <span className="w-24 text-right font-medium">
                      ¥{r.estimatedCost.toLocaleString()}
                    </span>
                  </button>
                  {open && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 px-7 pb-3 pt-1 text-xs text-muted-foreground">
                      {Object.entries(r.byKind).length ? (
                        Object.entries(r.byKind).map(([k, n]) => (
                          <span key={k}>
                            {KIND_LABEL[k] ?? k} <span className="text-foreground">{n}</span>
                          </span>
                        ))
                      ) : (
                        <span>无成功产出</span>
                      )}
                      <span>失败 <span className="text-foreground">{r.failed}</span></span>
                      <span className="text-warning">预估 ¥{r.estimatedCost.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-muted-foreground">
              <span>
                第 {pageInfo.page} / {pageInfo.totalPages} 页 · 共 {pageInfo.total} 项
                {loading && (
                  <span className="ml-2" role="status">
                    正在更新…
                  </span>
                )}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 disabled:opacity-45"
                  disabled={!pageInfo.hasPrevious || loading}
                  onClick={() => {
                    setExpanded(null);
                    onPageChange(pageInfo.page - 1);
                  }}
                  aria-label={`上一页${tab === "project" ? "项目" : "成员"}排行`}
                >
                  <ChevronLeft className="size-4" /> 上一页
                </button>
                <button
                  type="button"
                  className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 disabled:opacity-45"
                  disabled={!pageInfo.hasNext || loading}
                  onClick={() => {
                    setExpanded(null);
                    onPageChange(pageInfo.page + 1);
                  }}
                  aria-label={`下一页${tab === "project" ? "项目" : "成员"}排行`}
                >
                  下一页 <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type ModelDistributionDimension = "project" | "user";

function ModelDistributionPanel({
  model,
  isAdmin,
  dimension,
  onDimensionChange,
}: {
  model: ModelStat;
  isAdmin: boolean;
  dimension: ModelDistributionDimension;
  onDimensionChange: (dimension: ModelDistributionDimension) => void;
}) {
  const distribution =
    dimension === "project"
      ? model.distribution.projects
      : model.distribution.users;
  const dimensionLabel = dimension === "project" ? "项目" : "成员";
  return (
    <div
      className="mt-3 rounded-lg border border-border bg-muted/20 p-3"
      data-model-distribution={model.modelKey}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">项目 / 成员使用分布</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            按预估成本优先排序 · Top {distribution.items.length} / 共 {distribution.total}
            {dimension === "project" ? " 个项目" : " 位成员"}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-1 rounded-md border border-border bg-card p-1">
            {(["project", "user"] as const).map((value) => {
              const selected = dimension === value;
              const label = value === "project" ? "按项目" : "按成员";
              return (
                <button
                  key={value}
                  type="button"
                  className={`focus-ring inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label={`${label}查看 ${model.label} 分布`}
                  aria-pressed={selected}
                  onClick={() => onDimensionChange(value)}
                >
                  <SelectionIndicator selected={selected} />
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {distribution.items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          本期暂无{dimensionLabel}使用记录
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {distribution.items.map((row) => {
            const successRate = row.total
              ? Math.round((row.succeeded / row.total) * 100)
              : 0;
            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/70 bg-card px-3 py-2 text-xs"
                data-model-distribution-row
              >
                <span className="min-w-0 flex-[1_1_10rem] truncate font-medium text-foreground">
                  {row.name}
                </span>
                <span className="w-16 text-right text-muted-foreground">
                  {row.total} 次
                </span>
                <span className="w-20 text-right text-muted-foreground">
                  成功率 {successRate}%
                </span>
                <span className="w-24 text-right font-medium text-warning">
                  {row.estimatedCost === null
                    ? "成本 —"
                    : `¥${row.estimatedCost.toLocaleString()}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModelTable({ rows, isAdmin }: { rows: ModelStat[]; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dimension, setDimension] =
    useState<ModelDistributionDimension>("project");
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Activity className="size-4 text-primary" /> 模型用量明细
          <span className="text-xs font-normal text-muted-foreground">
            成本为预估值，以官方账单为准
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">本期暂无生成任务</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const open = expanded === r.modelKey;
              const rate = r.total ? Math.round((r.succeeded / r.total) * 100) : 0;
              return (
                <div key={r.modelKey}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-muted/40"
                    onClick={() => {
                      setExpanded(open ? null : r.modelKey);
                      if (!open) setDimension("project");
                    }}
                    aria-expanded={open}
                  >
                    {open ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 font-medium">{r.label}</span>
                    <span className="w-16 text-right text-muted-foreground">{r.total} 次</span>
                    <span className="w-14 text-right text-muted-foreground">{rate}%</span>
                    <span className="w-24 text-right font-medium">
                      {r.estimatedCost === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        `¥${r.estimatedCost.toLocaleString()}`
                      )}
                    </span>
                  </button>
                  {open && (
                    <div
                      className="px-7 pb-3 pt-1 text-xs text-muted-foreground"
                      data-model-timing={r.modelKey}
                    >
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4 xl:grid-cols-10">
                        <div>成功 <span className="text-foreground">{r.succeeded}</span></div>
                        <div>失败 <span className="text-foreground">{r.failed}</span></div>
                        <div>成功率 <span className="text-foreground">{rate}%</span></div>
                        <div className="flex items-center gap-1">
                          <RotateCcw className="size-3" /> 重试 <span className="text-foreground">{r.retryCount}</span>
                        </div>
                        <div>
                          精确计时{" "}
                          <span className="text-foreground">
                            {r.timing.sampleCount}/{r.timing.terminalCount}
                          </span>
                        </div>
                        <div>排队 P50 <span className="text-foreground">{formatDuration(r.timing.queueP50DurationMs)}</span></div>
                        <div>排队 P95 <span className="text-foreground">{formatDuration(r.timing.queueP95DurationMs)}</span></div>
                        <div>执行 P50 <span className="text-foreground">{formatDuration(r.timing.executionP50DurationMs)}</span></div>
                        <div>执行 P95 <span className="text-foreground">{formatDuration(r.timing.executionP95DurationMs)}</span></div>
                        <div>
                          计费 <span className="text-foreground">{ACCURACY_NOTE[r.accuracy]}</span>
                        </div>
                        {r.errors.length > 0 && (
                          <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-4 xl:col-span-10">
                            <span>失败类型</span>
                            {r.errors.map((error) => (
                              <span
                                key={error.code}
                                className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5"
                              >
                                <code className="text-foreground">{error.code}</code>
                                <span>{error.count}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {r.estimatedCost !== null && (
                          <div className="col-span-2 sm:col-span-4 xl:col-span-10">
                            预估总成本{" "}
                            <span className="text-warning">¥{r.estimatedCost.toLocaleString()}</span>
                            <span className="ml-1 text-xs">
                              （公开价占位，未含商务折扣）
                            </span>
                          </div>
                        )}
                      </div>
                      <ModelDistributionPanel
                        model={r}
                        isAdmin={isAdmin}
                        dimension={dimension}
                        onDimensionChange={setDimension}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
