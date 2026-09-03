"use client";

import {
  Ban,
  CheckCircle2,
  CircleX,
  Clock3,
  Coins,
  Gauge,
  Hash,
  LoaderCircle,
  Wrench,
} from "lucide-react";
import type { RefObject, ReactNode } from "react";
import type { TaskDto } from "@/lib/client/types";
import { buildTaskDetailSnapshot } from "@/lib/tasks/task-details";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogDrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusMessage } from "@/components/ui/status-message";

const KIND_LABEL: Record<TaskDto["kind"], string> = {
  text: "文案",
  image: "图像",
  video: "视频",
  audio: "配音",
  music: "音乐",
  edit: "剪辑",
};

const SERVICE_TIER_LABEL: Record<string, string> = {
  default: "默认服务等级",
  flex: "灵活服务等级",
  priority: "高优先级服务",
};

function TaskStatus({ status }: { status: TaskDto["status"] }) {
  switch (status) {
    case "queued":
      return <Badge variant="warning" className="gap-1"><Clock3 className="size-3" />排队中</Badge>;
    case "running":
      return <Badge variant="info" className="gap-1"><LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />生成中</Badge>;
    case "succeeded":
      return <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" />已完成</Badge>;
    case "failed":
      return <Badge variant="destructive" className="gap-1"><CircleX className="size-3" />失败</Badge>;
    case "cancelled":
      return <Badge variant="secondary" className="gap-1"><Ban className="size-3" />已取消</Badge>;
  }
}

function asDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: number | string | null | undefined): string {
  return asDate(value)?.toLocaleString("zh-CN", { hour12: false }) ?? "未记录";
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} 毫秒`;
  const seconds = Math.round(milliseconds / 100) / 10;
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

function executionDuration(task: TaskDto): string {
  if (!task.completedAt && task.status !== "succeeded" && task.status !== "failed" && task.status !== "cancelled") {
    return "尚未结束";
  }
  const start = asDate(task.startedAt) ?? asDate(task.createdAt);
  const end = asDate(task.completedAt) ?? asDate(task.updatedAt);
  if (!start || !end) return "未记录";
  return formatDuration(Math.max(0, end.getTime() - start.getTime()));
}

function formatNumber(value: number | null): string {
  return value === null ? "未返回" : value.toLocaleString("zh-CN");
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-medium ${mono ? "select-all font-mono text-xs leading-5" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border/70 pt-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function costCopy(task: TaskDto, yuan: number | null, accuracy: string): {
  value: string;
  note: string;
} {
  if (yuan === null) {
    return { value: "暂无法核算", note: "该供应商暂未返回可换算的金额用量" };
  }
  const amount = yuan > 0 && yuan < 0.01 ? `¥${yuan.toFixed(4)}` : `¥${yuan.toFixed(2)}`;
  if (accuracy === "actual") return { value: amount, note: "按供应商实际用量换算" };
  if (accuracy === "exact") {
    return {
      value: amount,
      note: task.status === "succeeded" ? "按固定单价核算" : "按请求数量与固定单价预计",
    };
  }
  return { value: `约 ${amount}`, note: "按请求/产物规格及附加服务公开标价估算，未计账户折扣与免费额度" };
}

function searchCostCopy(calls: number | null, yuan: number | null): string {
  if (calls === null) return "未返回实际次数";
  if (yuan === null) return `${calls.toLocaleString("zh-CN")} 次 · 暂无法核算`;
  const amount = yuan > 0 && yuan < 0.01 ? yuan.toFixed(4) : yuan.toFixed(2);
  return `${calls.toLocaleString("zh-CN")} 次 · 公开标价 ¥${amount}`;
}

export type TaskDetailsDrawerProps = {
  task: TaskDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

export function TaskDetailsDrawer({
  task,
  open,
  onOpenChange,
  restoreFocusRef,
}: TaskDetailsDrawerProps) {
  const detail = task ? buildTaskDetailSnapshot(task) : null;
  const cost = task && detail
    ? costCopy(task, detail.billing.total.yuan, detail.billing.total.accuracy)
    : null;
  const tokenValue = detail
    ? detail.tokens !== null && detail.totalTokens !== null && detail.totalTokens !== detail.tokens
      ? `${formatNumber(detail.tokens)} 输出 / ${formatNumber(detail.totalTokens)} 总计`
      : formatNumber(detail.tokens ?? detail.totalTokens)
    : "未返回";
  const seedValue = detail?.seed !== null && detail?.seed !== undefined
    ? detail.seed.toLocaleString("zh-CN", { useGrouping: false })
    : detail?.randomSeedRequested
      ? "随机（供应商未返回实际值）"
      : "未返回 / 不适用";

  return (
    <Dialog open={open && !!task} onOpenChange={onOpenChange}>
      <DialogDrawerContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = restoreFocusRef?.current;
          if (target) window.requestAnimationFrame(() => target.focus());
        }}
      >
        {task && detail && cost && (
          <div className="space-y-5">
            <DialogHeader className="pr-10">
              <div className="flex flex-wrap items-center gap-2">
                <TaskStatus status={task.status} />
                <Badge variant="secondary">{KIND_LABEL[task.kind]}</Badge>
              </div>
              <DialogTitle className="pt-2 text-xl">任务详情</DialogTitle>
              <DialogDescription>
                {detail.modelLabel} · {detail.providerLabel}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Coins className="size-4 text-primary" /> 参考合计
                </div>
                <p className="mt-2 text-xl font-semibold tracking-tight">{cost.value}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{cost.note}</p>
              </div>
              <div className="rounded-xl border border-info/20 bg-info-muted/45 p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Gauge className="size-4 text-info" /> Token 用量
                </div>
                <p className="mt-2 break-words font-mono text-sm font-semibold">{tokenValue}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {detail.webSearchCalls !== null
                    ? `联网搜索 ${detail.webSearchCalls.toLocaleString("zh-CN")} 次`
                    : "供应商未单独返回联网搜索次数"}
                </p>
              </div>
            </div>

            <Section title="计费拆分">
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DetailItem
                  label="模型计价"
                  value={detail.billing.model.yuan === null
                    ? "暂无法核算"
                    : `¥${detail.billing.model.yuan.toFixed(2)} · ${detail.billing.modelBasis}`}
                />
                <DetailItem
                  label="联网搜索"
                  value={searchCostCopy(detail.billing.webSearch.calls, detail.billing.webSearch.listYuan)}
                />
                <DetailItem
                  label="服务等级计价"
                  value={`${detail.billing.serviceTier.label} · ${detail.billing.serviceTier.note}`}
                />
                <DetailItem
                  label="最低 token 规则"
                  value={detail.billing.minimumToken.note}
                />
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">
                {detail.billing.webSearch.note} 最终金额以供应商账单为准。
              </p>
            </Section>

            <Section title="生成规格">
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DetailItem label="分辨率 / 尺寸" value={detail.resolution ?? "未返回 / 不适用"} />
                <DetailItem label="随机种子" value={seedValue} mono={detail.seed !== null} />
                <DetailItem label="实际帧数" value={detail.frames === null ? "未返回 / 不适用" : detail.frames.toLocaleString("zh-CN")} />
                <DetailItem label="FPS" value={detail.framesPerSecond === null ? "未返回 / 不适用" : `${detail.framesPerSecond} fps`} />
                <DetailItem label="时长" value={detail.durationSeconds === null ? "未返回 / 不适用" : `${detail.durationSeconds} 秒`} />
                <DetailItem label="输出数量" value={detail.outputCount === null ? "未返回 / 不适用" : detail.outputCount.toLocaleString("zh-CN")} />
              </dl>
            </Section>

            <Section title="工具与供应商">
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DetailItem label="供应商" value={detail.providerLabel} />
                <DetailItem
                  label="服务等级"
                  value={detail.serviceTier
                    ? `${SERVICE_TIER_LABEL[detail.serviceTier] ?? detail.serviceTier} · ${detail.billing.serviceTier.label}`
                    : "未返回 / 未指定"}
                />
                <DetailItem
                  label="队列优先级"
                  value={detail.priority === null ? "未返回 / 不适用" : detail.priority.toLocaleString("zh-CN")}
                />
                <DetailItem
                  label="供应商任务 ID"
                  value={task.arkTaskId ?? "供应商未返回"}
                  mono={!!task.arkTaskId}
                />
                <DetailItem label="本站任务 ID" value={task.id} mono />
              </dl>
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Wrench className="size-4" /> 使用工具
                </div>
                {detail.tools.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detail.tools.map((tool) => (
                      <Badge key={tool.id} variant="outline" className="gap-1.5">
                        {tool.label}
                        <span className="font-mono text-xs text-muted-foreground">{tool.id}</span>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">无额外工具或供应商未返回工具信息。</p>
                )}
              </div>
            </Section>

            <Section title="执行记录">
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DetailItem label="提交时间" value={formatDate(task.createdAt)} />
                <DetailItem label="开始时间" value={formatDate(task.startedAt)} />
                <DetailItem label="结束时间" value={formatDate(task.completedAt)} />
                <DetailItem label="执行耗时" value={executionDuration(task)} />
                <DetailItem label="执行次数" value={`${detail.attemptCount} 次`} />
                <DetailItem label="模型" value={detail.modelLabel} />
              </dl>
            </Section>

            {detail.prompt && (
              <Section title="提示词 / 文本">
                <p className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-muted/20 p-3 text-sm leading-6">
                  {detail.prompt}
                </p>
              </Section>
            )}

            {task.error && (
              <Section title="失败信息">
                <StatusMessage tone="danger" icon={false}>
                  <p>{task.error}</p>
                  {task.errorRequestId && (
                    <p className="mt-2 select-all font-mono text-xs">
                      {task.errorCode ? `${task.errorCode} · ` : ""}错误编号 {task.errorRequestId}
                    </p>
                  )}
                </StatusMessage>
              </Section>
            )}

            <div className="flex items-center gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground">
              <Hash className="size-3.5" /> 成本仅作任务级核算参考，最终以供应商账单为准。
            </div>
          </div>
        )}
      </DialogDrawerContent>
    </Dialog>
  );
}
