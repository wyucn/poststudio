"use client";

/**
 * 「我的生成记录」：展示当前用户在某个功能区的生成任务历史（持久化于任务表），
 * 切换功能区 / 刷新页面都不会丢失；支持一键复用配置与再次生成。
 * 素材库仍是全项目共享的内容池，这里只是个人视角。
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  AudioWaveform,
  Ban,
  CheckCircle2,
  Clock3,
  CircleX,
  CircleStop,
  Copy,
  Download,
  Film,
  History,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  PanelRightOpen,
  Rocket,
  RotateCcw,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { recordTaskProductEvent } from "@/lib/client/product-events";
import { uploadAssetFile } from "@/lib/client/upload";
import { assetDownloadUrl, assetRawUrl, type AssetDto, type TaskDto } from "@/lib/client/types";
import { modelDisplayName } from "@/lib/ark/models";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusMessage, type StatusTone } from "@/components/ui/status-message";
import { cn } from "@/lib/utils";
import {
  automaticTaskRetryInfo,
  manualRetryNeedsConfirmation,
  supportsTaskManualRetry,
} from "@/lib/tasks/retry";
import { AudioWave } from "./audio-wave";
import { useCanEdit } from "./read-only";
import { SnapshotVideo } from "./video-snapshot";
import { VideoPoster } from "./video-poster";
import { useCreatorTasks } from "./use-creator-history";
import { LazyTaskDetailsDrawer } from "./lazy-task-details-drawer";

const STATUS_LABEL: Record<string, { text: string; cls: string; icon: LucideIcon }> = {
  queued: { text: "排队中", cls: "border-warning/30 bg-warning-muted text-warning", icon: Clock3 },
  running: { text: "生成中", cls: "border-info/30 bg-info-muted text-info", icon: LoaderCircle },
  succeeded: { text: "完成", cls: "border-success/30 bg-success-muted text-success", icon: CheckCircle2 },
  failed: { text: "失败", cls: "border-destructive/30 bg-destructive-muted text-destructive", icon: CircleX },
  cancelled: { text: "已取消", cls: "border-border bg-muted/55 text-muted-foreground", icon: Ban },
};

function TaskStatusBadge({ status, className }: { status: string; className?: string }) {
  const badge = STATUS_LABEL[status] ?? STATUS_LABEL.queued;
  const Icon = badge.icon;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs",
        badge.cls,
        className
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0",
          status === "running" && "animate-spin motion-reduce:animate-none"
        )}
      />
      {badge.text}
    </span>
  );
}

function canDeleteTask(task: TaskDto): boolean {
  return task.status !== "queued" && task.status !== "running";
}

const COZE_MODEL_LABEL: Record<string, string> = {
  "coze-music": "音乐生成",
  "coze-tts": "语音合成",
  "modelscope-qwen3-tts": "Qwen3-TTS 声音克隆",
  "coze-edit": "视频剪辑工具",
};

function taskModelLabel(modelKey: string): string {
  return COZE_MODEL_LABEL[modelKey] ?? modelDisplayName(modelKey);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return today ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 从任务输入提取展示用的提示词与参数摘要 */
function summarize(input: Record<string, unknown>): { prompt: string; params: string } {
  const prompt = String(input.prompt ?? input.text ?? "");
  const skip = new Set([
    "prompt",
    "text",
    "refAssetIds",
    "params",
    "draftTaskId",
    "draftSourceTaskId",
    "durationMode",
    "firstFrameAssetId",
    "lastFrameAssetId",
  ]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (skip.has(k) || v === undefined || v === null || v === "") continue;
    if (typeof v === "object") continue;
    parts.push(`${k}=${v}`);
    if (parts.length >= 5) break;
  }
  return { prompt, params: parts.join(" · ") };
}

/** 波形 + 选区另存：把选区片段以 WAV 上传回素材库 */
export function AudioWaveSavable({
  projectId,
  src,
  filename,
}: {
  projectId: string;
  src: string;
  filename?: string;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: StatusTone; text: string } | null>(null);

  async function saveClip(blob: Blob) {
    setSaving(true);
    setMessage(null);
    try {
      const file = new File([blob], `${filename ?? "clip"}.wav`, {
        type: "audio/wav",
      });
      await uploadAssetFile({ projectId, file, allowedKinds: ["audio"] });
      qc.invalidateQueries({ queryKey: ["assets", projectId] });
      setMessage({ tone: "success", text: "已存入素材库（音频分类）" });
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      <AudioWave src={src} filename={filename} onSaveClip={saveClip} saving={saving} />
      {message && (
        <StatusMessage tone={message.tone} appearance="inline">
          {message.text}
        </StatusMessage>
      )}
    </div>
  );
}

/** 图片 / 视频全屏放大预览 */
function MediaPreviewDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] p-2 sm:max-w-4xl">
        <DialogTitle className="sr-only">素材预览</DialogTitle>
        <DialogDescription className="sr-only">
          放大查看当前{asset.kind === "image" ? "图片" : "视频"}素材。
        </DialogDescription>
        {asset.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetRawUrl(asset.id)}
            alt=""
            className="max-h-[80vh] w-full rounded-md object-contain"
          />
        ) : (
          <SnapshotVideo
            src={assetRawUrl(asset.id)}
            projectId={asset.projectId}
            className="max-h-[80vh] w-full rounded-md"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function HistoryItem({
  task,
  projectId,
  onReuse,
  onResubmit,
  onRetry,
  resubmitting,
  retrying,
  selected,
  onSelectedChange,
  onDelete,
  deleting,
  onCancel,
  cancelling,
  onPromoteDraft,
  promoting,
  onToggleFavorite,
  favoriting,
  active = false,
  onActivate,
  onDetails,
  compact = false,
  sidebar = false,
}: {
  task: TaskDto;
  projectId: string;
  onReuse?: (input: Record<string, unknown>) => void;
  onResubmit?: (input: Record<string, unknown>) => void;
  onRetry?: () => void;
  resubmitting: boolean;
  retrying: boolean;
  selected: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onDelete?: () => void;
  deleting: boolean;
  onCancel?: () => void;
  cancelling: boolean;
  onPromoteDraft?: () => void;
  promoting: boolean;
  onToggleFavorite?: (asset: AssetDto) => void;
  favoriting: boolean;
  active?: boolean;
  onActivate?: () => void;
  onDetails: (element: HTMLElement) => void;
  compact?: boolean;
  sidebar?: boolean;
}) {
  const [showWave, setShowWave] = useState(false);
  const [preview, setPreview] = useState(false);
  const input = (() => {
    try {
      return JSON.parse(task.inputJson) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const { prompt, params } = summarize(input);
  const usage = (() => {
    try {
      return task.usageJson
          ? (JSON.parse(task.usageJson) as {
            tokens?: number;
            outputTokens?: number;
            webSearchCalls?: number;
            serviceTier?: string;
          })
        : null;
    } catch {
      return null;
    }
  })();
  const asset = task.outputAsset;
  const deletable = canDeleteTask(task);
  const automaticRetry =
    task.status === "queued" ? automaticTaskRetryInfo(task.contextJson) : null;

  if (sidebar) {
    const activate = onActivate ?? (asset?.kind === "image" || asset?.kind === "video"
      ? () => setPreview(true)
      : undefined);
    const PlaceholderIcon =
      task.kind === "image" ? ImageIcon : task.kind === "video" ? Film : AudioWaveform;

    return (
      <article
        className={`history-sidebar-item ${active ? "is-active" : ""}`}
        aria-current={active ? "true" : undefined}
      >
        {(asset?.kind === "image" || asset?.kind === "video") && (
          <button
            type="button"
            className="history-sidebar-preview group relative block aspect-video w-full overflow-hidden bg-muted"
            title={onActivate ? "在创作舞台查看" : "点击放大预览"}
            onClick={activate}
          >
            {asset.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetRawUrl(asset.id)}
                alt=""
                className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
              />
            ) : (
              <VideoPoster assetId={asset.id} className="!absolute inset-0" />
            )}
            <TaskStatusBadge status={task.status} className="absolute bottom-1.5 left-1.5 bg-background/90 backdrop-blur" />
            <span className="absolute right-1.5 top-1.5 rounded bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Maximize2 className="size-3.5" />
            </span>
          </button>
        )}

        {!asset && (
          <button
            type="button"
            className="history-sidebar-preview flex aspect-video w-full items-center justify-center bg-muted/65 text-muted-foreground"
            disabled={!onActivate}
            onClick={onActivate}
          >
            <PlaceholderIcon className="size-5 opacity-55" />
            <TaskStatusBadge status={task.status} className="absolute bottom-1.5 left-1.5 bg-background/90" />
          </button>
        )}

        {asset?.kind === "audio" && (
          <div className="history-sidebar-audio rounded-md border border-border/70 bg-background/70 p-2">
            {showWave ? (
              <AudioWaveSavable
                projectId={projectId}
                src={assetRawUrl(asset.id)}
                filename={prompt.slice(0, 16) || "audio"}
              />
            ) : (
              <audio
                src={assetRawUrl(asset.id)}
                controls
                preload="none"
                className="h-9 w-full min-w-0"
              />
            )}
          </div>
        )}

        <div className="mt-2.5 flex items-center gap-2">
          {(asset?.kind === "audio" || asset?.kind === "text") && (
            <TaskStatusBadge status={task.status} />
          )}
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {taskModelLabel(task.modelKey)}
          </span>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
            {fmtTime(task.createdAt)}
          </span>
        </div>

        {onActivate ? (
          <button
            type="button"
            className="mt-1.5 block w-full text-left"
            onClick={onActivate}
          >
            <span className="line-clamp-2 text-ui font-semibold leading-5 text-foreground">
              {prompt || "未填写提示词"}
            </span>
          </button>
        ) : (
          <p className="mt-1.5 line-clamp-2 text-ui font-semibold leading-5 text-foreground">
            {prompt || "未填写提示词"}
          </p>
        )}

        {task.status === "failed" && task.error && (
          <StatusMessage tone="danger" appearance="inline" className="mt-1.5">
            <p className="line-clamp-2">{task.error}</p>
          </StatusMessage>
        )}
        {automaticRetry && (
          <StatusMessage tone="info" appearance="inline" className="mt-1.5">
            {automaticRetry.message} 已安排第 {automaticRetry.nextAttempt}/
            {automaticRetry.maxAttempts} 次执行。
          </StatusMessage>
        )}

        {onPromoteDraft && task.status === "succeeded" && input.draft === true && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-8 w-full justify-center text-xs"
            loading={promoting}
            loadingText="提交中"
            onClick={onPromoteDraft}
          >
            <Rocket className="size-3.5" /> 生成正式版
          </Button>
        )}

        {(onReuse || onResubmit || onRetry) && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {onReuse && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 min-w-0 justify-center px-2 text-xs"
              title="把这条记录的参数填回当前创作器"
              onClick={() => onReuse(input)}
            >
              <Copy className="size-3.5" /> 复用
            </Button>
          )}
          {onRetry ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-w-0 justify-center px-2 text-xs"
              title="重新执行同一任务并保留尝试次数"
              loading={retrying}
              loadingText="重试中"
              onClick={onRetry}
            >
              <RotateCcw className="size-3.5" /> 重试
            </Button>
          ) : onResubmit ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-w-0 justify-center px-2 text-xs"
              title="按相同参数再生成一次"
              loading={resubmitting}
              loadingText="提交中"
              onClick={() => onResubmit(input)}
            >
              <RotateCcw className="size-3.5" /> 再生成
            </Button>
          ) : null}
        </div>
        )}

        <div className="mt-1.5 flex min-h-8 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 min-w-0 flex-1 justify-start px-2 text-xs"
            onClick={(event) => onDetails(event.currentTarget)}
          >
            <PanelRightOpen className="size-3.5" /> 详情
          </Button>
          {asset && asset.kind !== "text" && (
            <Button asChild variant="ghost" size="sm" className="h-8 min-w-0 flex-1 justify-start px-2 text-xs">
              <a href={assetDownloadUrl(asset.id)} download>
                <Download className="size-3.5" /> 下载
              </a>
            </Button>
          )}
          {asset?.kind === "audio" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              title={showWave ? "收起波形编辑" : "显示波形并裁剪"}
              aria-label={showWave ? "收起波形编辑" : "显示波形并裁剪"}
              onClick={() => setShowWave((value) => !value)}
            >
              <AudioWaveform className="size-3.5" />
            </Button>
          )}
          {onToggleFavorite && asset && (
            <Button
              variant="ghost"
              size="icon"
              className={`size-8 shrink-0 ${asset.favorite ? "text-favorite" : "text-muted-foreground hover:text-favorite"}`}
              title={asset.favorite ? "取消收藏" : "收藏为可用备选"}
              aria-label={asset.favorite ? "取消收藏" : "收藏为可用备选"}
              aria-pressed={asset.favorite}
              loading={favoriting}
              loadingText="更新中"
              onClick={() => onToggleFavorite(asset)}
            >
              <Star className={`size-3.5 ${asset.favorite ? "fill-current" : ""}`} />
            </Button>
          )}
          {onCancel && task.status === "queued" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              title="取消排队任务"
              aria-label="取消排队任务"
              loading={cancelling}
              loadingText="取消中"
              onClick={onCancel}
            >
              <CircleStop className="size-3.5" />
            </Button>
          )}
          {onDelete && deletable && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              title="删除这条生成记录"
              aria-label="删除这条生成记录"
              loading={deleting}
              loadingText="删除中"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>

        {asset && (asset.kind === "image" || asset.kind === "video") && (
          <MediaPreviewDialog asset={asset} open={preview} onOpenChange={setPreview} />
        )}
      </article>
    );
  }

  return (
    <div
      className={`space-y-3 rounded-xl border border-border bg-background/75 p-3.5 ${
        compact ? "min-w-0" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {onSelectedChange && (
          <input
            type="checkbox"
            checked={selected}
            disabled={!deletable || deleting}
            aria-label="选择这条生成记录"
            className="size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-35"
            onChange={(e) => onSelectedChange(e.target.checked)}
          />
        )}
        <TaskStatusBadge status={task.status} className="px-2" />
        <span className="font-mono text-xs text-muted-foreground">
          {fmtTime(task.createdAt)} · {taskModelLabel(task.modelKey)}
        </span>
        <span className="flex-1" />
        {onCancel && task.status === "queued" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
            title="取消仍在队列中的任务"
            loading={cancelling}
            loadingText="取消中"
            onClick={onCancel}
          >
            <CircleStop className="size-3.5" /> 取消
          </Button>
        )}
        {onPromoteDraft && task.status === "succeeded" && input.draft === true && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            title="沿用样片输入生成 720p 正式视频"
            loading={promoting}
            loadingText="提交中"
            onClick={onPromoteDraft}
          >
            <Rocket className="size-3.5" /> 生成正式版
          </Button>
        )}
        {onToggleFavorite && asset && (
          <Button
            variant="ghost"
            size="icon"
            className={`size-6 ${asset.favorite ? "text-favorite" : "text-muted-foreground hover:text-favorite"}`}
            title={asset.favorite ? "已收藏为可用备选，点击取消" : "收藏为可用备选"}
            aria-label={asset.favorite ? "取消收藏" : "收藏为可用备选"}
            aria-pressed={asset.favorite}
            loading={favoriting}
            loadingText="更新中"
            onClick={() => onToggleFavorite(asset)}
          >
            <Star className={`size-3.5 ${asset.favorite ? "fill-current" : ""}`} />
          </Button>
        )}
        {onReuse && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            title="把这条记录的参数填回当前创作器"
            onClick={() => onReuse(input)}
          >
            <Copy className="size-3" /> 复用配置
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={(event) => onDetails(event.currentTarget)}
        >
          <PanelRightOpen className="size-3" /> 详情
        </Button>
        {onRetry ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            title="重新执行同一任务并保留尝试次数"
            loading={retrying}
            loadingText="重试中"
            onClick={onRetry}
          >
            <RotateCcw className="size-3" /> 重试
          </Button>
        ) : onResubmit ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            title="按相同参数再生成一次"
            loading={resubmitting}
            loadingText="提交中"
            onClick={() => onResubmit(input)}
          >
            <RotateCcw className="size-3" /> 再次生成
          </Button>
        ) : null}
        {onDelete && deletable && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-destructive"
            title="删除这条生成记录"
            aria-label="删除这条生成记录"
            loading={deleting}
            loadingText="删除中"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {prompt && (
        <p className={`${compact ? "line-clamp-1" : "line-clamp-2"} text-sm leading-6 text-muted-foreground`}>
          {prompt}
        </p>
      )}
      {!compact && params && (
        <p className="font-mono text-xs leading-5 text-muted-foreground/80">{params}</p>
      )}
      {!compact && usage && (usage.tokens || usage.outputTokens || usage.webSearchCalls || usage.serviceTier) && (
        <p className="font-mono text-xs text-muted-foreground">
          {(usage.tokens ?? usage.outputTokens) ? `${(usage.tokens ?? usage.outputTokens)?.toLocaleString()} tokens` : ""}
          {usage.webSearchCalls ? ` · 联网搜索 ${usage.webSearchCalls} 次` : ""}
          {usage.serviceTier ? ` · ${usage.serviceTier}` : ""}
        </p>
      )}
      {task.status === "failed" && task.error && (
        <StatusMessage tone="danger" icon={false}>
          <p className="text-sm leading-5">{task.error}</p>
          {task.errorRequestId && (
            <p className="mt-1 select-all font-mono text-xs text-destructive/80">
              {task.errorCode ? `${task.errorCode} · ` : ""}错误编号 {task.errorRequestId}
            </p>
          )}
        </StatusMessage>
      )}
      {automaticRetry && (
        <StatusMessage tone="info">
          {automaticRetry.message} 已安排第 {automaticRetry.nextAttempt}/
          {automaticRetry.maxAttempts} 次执行。
        </StatusMessage>
      )}

      {asset && (
        <div className="space-y-1.5">
          {asset.kind === "text" && (
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-xs leading-relaxed">
              {asset.textContent}
            </p>
          )}
          {asset.kind === "image" && (
            <button
              type="button"
              className="group relative block w-fit"
              title="点击放大预览"
              onClick={() => setPreview(true)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={assetRawUrl(asset.id)}
                alt=""
                className="max-h-64 w-auto rounded-md border border-border"
              />
              <span className="absolute right-1.5 top-1.5 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Maximize2 className="size-3.5" />
              </span>
            </button>
          )}
          {asset.kind === "video" && (
            <div className="relative w-full">
              <VideoPoster
                assetId={asset.id}
                className={`${compact ? "aspect-video" : "aspect-video max-h-64"} w-full rounded-md border border-border`}
              />
              <button
                type="button"
                title="点击放大预览"
                aria-label="放大预览"
                className="absolute right-1.5 top-1.5 rounded bg-black/50 p-1 text-white transition-colors hover:bg-black/70"
                onClick={() => setPreview(true)}
              >
                <Maximize2 className="size-3.5" />
              </button>
            </div>
          )}
          {asset.kind === "audio" &&
            (showWave ? (
              <AudioWaveSavable
                projectId={projectId}
                src={assetRawUrl(asset.id)}
                filename={prompt.slice(0, 16) || "audio"}
              />
            ) : (
              <div className="flex items-center gap-2">
                <audio src={assetRawUrl(asset.id)} controls className="h-9 min-w-0 flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  title="显示波形，可框选片段试听 / 下载 / 存为素材"
                  onClick={() => setShowWave(true)}
                >
                  <AudioWaveform className="size-3.5" /> 波形/裁剪
                </Button>
              </div>
            ))}
          {asset.kind !== "text" && (
            <a
              href={assetDownloadUrl(asset.id)}
              download
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Download className="size-3" /> 下载原始文件
            </a>
          )}
          {(asset.kind === "image" || asset.kind === "video") && (
            <MediaPreviewDialog asset={asset} open={preview} onOpenChange={setPreview} />
          )}
        </div>
      )}
    </div>
  );
}

export function GenHistory({
  projectId,
  kinds,
  title = "我的生成记录",
  onReuse,
  resubmitPath,
  resubmitBody,
  variant = "default",
  activeTaskId,
  onTaskOpen,
}: {
  projectId: string;
  /** 任务类型，逗号分隔，如 "image" 或 "audio" */
  kinds: string;
  title?: string;
  /** 一键复用配置：把记录参数填回表单 */
  onReuse?: (input: Record<string, unknown>) => void;
  /** 再次生成的 POST 地址 */
  resubmitPath: string;
  /** 输入 → 再次生成请求体（默认原样重发） */
  resubmitBody?: (input: Record<string, unknown>) => Record<string, unknown>;
  /** 视频工作台使用横向胶片条，其余功能沿用纵向记录卡片。 */
  variant?: "default" | "filmstrip" | "sidebar";
  /** 侧栏中当前正在舞台查看的任务。 */
  activeTaskId?: string;
  /** 点击侧栏记录时在创作舞台打开。 */
  onTaskOpen?: (task: TaskDto) => void;
}) {
  const qc = useQueryClient();
  const canEdit = useCanEdit();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);
  const { data: items } = useCreatorTasks(projectId, kinds);
  const detailTask = items?.find((task) => task.id === detailTaskId) ?? null;

  // 有任务完成时刷新素材库
  const doneCount = items?.filter((t) => t.status === "succeeded").length ?? 0;
  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (doneCount > prevDone.current) {
      qc.invalidateQueries({ queryKey: ["assets", projectId] });
    }
    prevDone.current = doneCount;
  }, [doneCount, projectId, qc]);

  const resubmit = useMutation({
    mutationFn: async ({
      task,
      input,
    }: {
      task: TaskDto;
      input: Record<string, unknown>;
    }) => {
      const result = await api(resubmitPath, {
        method: "POST",
        json: resubmitBody ? resubmitBody(input) : input,
      });
      void recordTaskProductEvent(task.id, "regenerate");
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gen-history", projectId, kinds] });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const retryTask = useMutation({
    mutationFn: (task: TaskDto) =>
      api(`/api/tasks/${task.id}/retry`, {
        method: "POST",
        json: {
          confirmDuplicateSpend: manualRetryNeedsConfirmation(
            task.errorCode,
            task.arkTaskId
          ),
        },
      }),
    onSuccess: (_result, task) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId, kinds] });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  function requestRetry(task: TaskDto) {
    if (
      manualRetryNeedsConfirmation(task.errorCode, task.arkTaskId) &&
      !window.confirm(
        "上一次请求可能已被外部服务受理。继续重试会再次调用模型，并可能产生重复费用。确认重新执行？"
      )
    ) {
      return;
    }
    retryTask.mutate(task);
  }

  const cancelTask = useMutation({
    mutationFn: (taskId: string) =>
      api(`/api/tasks/${taskId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gen-history", projectId, kinds] });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const promoteDraft = useMutation({
    mutationFn: ({ task, input }: { task: TaskDto; input: Record<string, unknown> }) =>
      api(resubmitPath, {
        method: "POST",
        json: {
          ...input,
          draft: false,
          draftSourceTaskId: task.id,
          draftTaskId: undefined,
          resolution: "720p",
          serviceTier: "default",
          returnLastFrame: false,
          firstFrameAssetId: undefined,
          lastFrameAssetId: undefined,
          refAssetIds: [],
          operation: "generate",
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gen-history", projectId, kinds] });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const deletableIds = items?.filter(canDeleteTask).map((task) => task.id) ?? [];
  const allSelected =
    deletableIds.length > 0 && deletableIds.every((id) => selectedIds.has(id));
  const selectedCount = deletableIds.filter((id) => selectedIds.has(id)).length;

  const removeTasks = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ deleted: number }>(`/api/projects/${projectId}/tasks`, {
        method: "DELETE",
        json: { ids },
      }),
    onSuccess: (_result, ids) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId] });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  function requestDelete(ids: string[]) {
    if (!ids.length) return;
    const confirmed = window.confirm(
      `确认删除 ${ids.length} 条生成记录？\n\n只会移除记录，素材库中的产物会保留。`
    );
    if (confirmed) removeTasks.mutate(ids);
  }

  const historyKey = ["gen-history", projectId, kinds] as const;
  const toggleFavorite = useMutation({
    mutationFn: (asset: AssetDto) =>
      api(`/api/assets/${asset.id}`, {
        method: "PATCH",
        json: { favorite: !asset.favorite },
      }),
    // 乐观更新：立即翻转本地缓存里对应产物的 favorite
    onMutate: async (asset) => {
      await qc.cancelQueries({ queryKey: historyKey });
      const prev = qc.getQueryData<TaskDto[]>(historyKey);
      qc.setQueryData<TaskDto[]>(historyKey, (old) =>
        old?.map((t) =>
          t.outputAsset?.id === asset.id
            ? { ...t, outputAsset: { ...t.outputAsset, favorite: !asset.favorite } }
            : t
        )
      );
      return { prev };
    },
    onError: (_e, _asset, ctx) => {
      if (ctx?.prev) qc.setQueryData(historyKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: historyKey });
      qc.invalidateQueries({ queryKey: ["assets", projectId] });
    },
  });

  return (
    <>
    <Card
      className={
        variant === "filmstrip"
          ? "rounded-none border-x-0 border-b-0 bg-muted/10 shadow-none"
          : variant === "sidebar"
            ? "creation-history-card flex h-full min-h-0 flex-col rounded-none border-0 bg-transparent shadow-none"
          : undefined
      }
    >
      <CardHeader className={`gap-3 ${variant === "filmstrip" ? "px-5 py-4 lg:px-6" : variant === "sidebar" ? "shrink-0 px-3 pb-2 pt-4" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className={`flex items-center gap-2 ${variant === "sidebar" ? "text-sm" : "text-base"}`}>
            <History className="size-4 text-primary" /> {title}
            {variant === "sidebar" ? (
              <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground">
                {items?.length ?? 0}
              </span>
            ) : (
              <span className="font-mono text-xs font-normal text-muted-foreground">
                仅自己可见 · 持久保存
              </span>
            )}
          </CardTitle>
          {variant !== "sidebar" && canEdit && deletableIds.length > 0 && (
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label="全选可删除的生成记录"
                  className="size-4 accent-primary"
                  onChange={(e) =>
                    setSelectedIds(e.target.checked ? new Set(deletableIds) : new Set())
                  }
                />
                全选
              </label>
              <span className="font-mono text-xs">已选 {selectedCount}</span>
              <Button
                variant="destructive"
                size="sm"
                className="h-7"
                disabled={!selectedCount}
                loading={removeTasks.isPending}
                loadingText="删除中"
                onClick={() =>
                  requestDelete(deletableIds.filter((id) => selectedIds.has(id)))
                }
              >
                <Trash2 /> 删除
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className={`space-y-2.5 ${variant === "filmstrip" ? "px-5 pb-5 lg:px-6" : variant === "sidebar" ? "flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2" : ""}`}>
        {resubmit.isError && <StatusMessage tone="danger" appearance="inline">{resubmit.error.message}</StatusMessage>}
        {retryTask.isError && <StatusMessage tone="danger" appearance="inline">{retryTask.error.message}</StatusMessage>}
        {cancelTask.isError && <StatusMessage tone="danger" appearance="inline">{cancelTask.error.message}</StatusMessage>}
        {promoteDraft.isError && <StatusMessage tone="danger" appearance="inline">{promoteDraft.error.message}</StatusMessage>}
        {removeTasks.isError && <StatusMessage tone="danger" appearance="inline">{removeTasks.error.message}</StatusMessage>}
        {items?.length ? (
          <div className={variant === "sidebar" ? "relative min-h-0 flex-1" : "relative"}>
          <div
            ref={scrollRef}
            onScroll={(e) =>
              variant === "default" && setShowTop(e.currentTarget.scrollTop > 400)
            }
            className={
              variant === "filmstrip"
                ? "grid auto-cols-[minmax(310px,360px)] grid-flow-col gap-3 overflow-x-auto pb-2"
                : variant === "sidebar"
                  ? "history-sidebar-list h-full min-h-0 overflow-y-auto pr-1"
                : "max-h-[70vh] space-y-2.5 overflow-y-auto pr-1"
            }
          >
            {items.map((t) => (
              <HistoryItem
                key={t.id}
                task={t}
                projectId={projectId}
                onReuse={
                  canEdit && onReuse
                    ? (input) => {
                        void recordTaskProductEvent(t.id, "reuse");
                        onReuse(input);
                      }
                    : undefined
                }
                onResubmit={
                  canEdit && t.status === "succeeded"
                    ? (input) => resubmit.mutate({ task: t, input })
                    : undefined
                }
                onRetry={
                  canEdit &&
                  t.status === "failed" &&
                  supportsTaskManualRetry(t)
                    ? () => requestRetry(t)
                    : undefined
                }
                resubmitting={resubmit.isPending}
                retrying={retryTask.isPending && retryTask.variables?.id === t.id}
                selected={selectedIds.has(t.id)}
                onSelectedChange={
                  canEdit && variant !== "sidebar"
                    ? (checked) =>
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (checked) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        })
                    : undefined
                }
                onDelete={canEdit ? () => requestDelete([t.id]) : undefined}
                deleting={removeTasks.isPending}
                onCancel={canEdit ? () => cancelTask.mutate(t.id) : undefined}
                cancelling={cancelTask.isPending}
                onPromoteDraft={
                  canEdit && kinds.split(",").includes("video")
                    ? () => {
                        let input: Record<string, unknown> = {};
                        try {
                          input = JSON.parse(t.inputJson) as Record<string, unknown>;
                        } catch {
                          // HistoryItem 会展示损坏的旧记录；这里只是不提供有效复用参数。
                        }
                        promoteDraft.mutate({ task: t, input });
                      }
                    : undefined
                }
                promoting={promoteDraft.isPending}
                onToggleFavorite={
                  canEdit ? (asset) => toggleFavorite.mutate(asset) : undefined
                }
                favoriting={toggleFavorite.isPending}
                compact={variant === "filmstrip" || variant === "sidebar"}
                sidebar={variant === "sidebar"}
                active={activeTaskId === t.id}
                onActivate={onTaskOpen ? () => onTaskOpen(t) : undefined}
                onDetails={(element) => {
                  detailTriggerRef.current = element;
                  setDetailTaskId(t.id);
                }}
              />
            ))}
          </div>
          {variant === "default" && showTop && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute bottom-3 right-3 size-9 rounded-full shadow-md"
              title="回到顶部"
              aria-label="回到顶部"
              onClick={() =>
                scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
              }
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            还没有生成记录。提交生成后，记录与结果会持久显示在这里（产物同时存入共享素材库）。
          </p>
        )}
      </CardContent>
    </Card>
    {detailTaskId && (
      <LazyTaskDetailsDrawer
        task={detailTask}
        open
        restoreFocusRef={detailTriggerRef}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDetailTaskId(null);
        }}
      />
    )}
    </>
  );
}
