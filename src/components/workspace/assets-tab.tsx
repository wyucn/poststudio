"use client";

import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUp,
  CheckCircle2,
  Download,
  FileAudio,
  FileText,
  Film,
  Image as ImageIcon,
  Info,
  Library,
  LoaderCircle,
  MessageSquare,
  Search,
  Send,
  Sigma,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/client/api";
import {
  assetDownloadUrl,
  assetLabel,
  assetMeta,
  assetRawUrl,
  assetThumbnailUrl,
  type AssetCommentDto,
  type AssetDto,
  type AssetPageDto,
  type ProjectDetailDto,
} from "@/lib/client/types";
import { parseFormulaAssetState } from "@/lib/formula-assets";
import { PRESET_LABEL } from "@/lib/presets";
import { modelDisplayName } from "@/lib/ark/models";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusMessage } from "@/components/ui/status-message";
import { AudioWaveSavable } from "./gen-history";
import { UploadDropZone } from "./upload-drop-zone";
import { SnapshotVideo } from "./video-snapshot";
import { VideoPoster } from "./video-poster";
import { useCanEdit } from "./read-only";

const KIND_LABEL: Record<string, string> = {
  text: "文案",
  image: "图像",
  video: "视频",
  audio: "音频",
};

function readFormulaAssetState(asset: AssetDto) {
  const candidate = assetMeta(asset).formula;
  if (!candidate) return null;
  try {
    return parseFormulaAssetState(candidate);
  } catch {
    return null;
  }
}

/** 评审区：采用 / 废弃标记 + 成员评论 */
function ReviewSection({ asset }: { asset: AssetDto }) {
  const qc = useQueryClient();
  const canEdit = useCanEdit();
  const [text, setText] = useState("");
  const [status, setStatus] = useState(asset.reviewStatus);

  const { data: comments } = useQuery<AssetCommentDto[]>({
    queryKey: ["asset-comments", asset.id],
    queryFn: () => api(`/api/assets/${asset.id}/comments`),
  });

  const review = useMutation({
    mutationFn: (reviewStatus: "approved" | "rejected" | null) =>
      api(`/api/assets/${asset.id}`, { method: "PATCH", json: { reviewStatus } }),
    onSuccess: (_d, reviewStatus) => {
      setStatus(reviewStatus);
      qc.invalidateQueries({ queryKey: ["assets", asset.projectId] });
    },
  });

  const post = useMutation({
    mutationFn: () =>
      api(`/api/assets/${asset.id}/comments`, { method: "POST", json: { content: text } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["asset-comments", asset.id] });
    },
  });

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          评审{status === "approved" ? "：已采用" : status === "rejected" ? "：已废弃" : "："}
        </span>
        {canEdit && (
          <>
            <Button
              variant={status === "approved" ? "secondary" : "outline"}
              size="sm"
              className={status === "approved" ? "text-success" : ""}
              aria-pressed={status === "approved"}
              onClick={() => review.mutate(status === "approved" ? null : "approved")}
              loading={review.isPending && (review.variables === "approved" || (review.variables === null && status === "approved"))}
              loadingText="更新中"
              disabled={review.isPending}
            >
              <CheckCircle2 /> 采用
            </Button>
            <Button
              variant={status === "rejected" ? "secondary" : "outline"}
              size="sm"
              className={status === "rejected" ? "text-destructive" : ""}
              aria-pressed={status === "rejected"}
              onClick={() => review.mutate(status === "rejected" ? null : "rejected")}
              loading={review.isPending && (review.variables === "rejected" || (review.variables === null && status === "rejected"))}
              loadingText="更新中"
              disabled={review.isPending}
            >
              <XCircle /> 废弃
            </Button>
          </>
        )}
      </div>
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MessageSquare className="size-3.5" /> 评论（{comments?.length ?? 0}）
        </p>
        <div className="max-h-40 space-y-2 overflow-y-auto">
          {comments?.map((c) => (
            <div key={c.id} className="rounded-md bg-muted/60 px-2.5 py-1.5 text-sm">
              <span className="mr-2 font-semibold">{c.userName}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(c.createdAt).toLocaleString("zh-CN")}
              </span>
              <p className="mt-0.5 whitespace-pre-wrap">{c.content}</p>
            </div>
          ))}
          {!comments?.length && (
            <p className="text-xs text-muted-foreground">还没有评论，说点什么吧</p>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Input
              aria-label="评审意见"
              value={text}
              maxLength={500}
              placeholder="写下评审意见…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && text.trim()) post.mutate();
              }}
            />
            <Button
              size="sm"
              onClick={() => post.mutate()}
              disabled={!text.trim()}
              loading={post.isPending}
              loadingText="发送中"
            >
              <Send />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssetDetail({
  asset,
  onDeleted,
  onExtend,
  onEditFormula,
  onToggleFavorite,
  favoriting,
}: {
  asset: AssetDto;
  onDeleted: () => void;
  onExtend?: (asset: AssetDto) => void;
  onEditFormula?: (asset: AssetDto) => void;
  onToggleFavorite?: (asset: AssetDto) => void;
  favoriting?: boolean;
}) {
  const meta = assetMeta(asset);
  const formula = readFormulaAssetState(asset);
  const qc = useQueryClient();
  const canEdit = useCanEdit();
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`/api/assets/${asset.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", asset.projectId] });
      onDeleted();
    },
  });
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>素材详情</DialogTitle>
        <DialogDescription>
          查看{assetLabel(asset)}的预览、元数据、评审与管理操作。
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto">
        {asset.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetRawUrl(asset.id)} alt="" className="w-full rounded-md" />
        )}
        {asset.kind === "video" && (
          <SnapshotVideo
            src={assetRawUrl(asset.id)}
            projectId={asset.projectId}
            className="w-full rounded-md"
          />
        )}
        {asset.kind === "audio" && (
          <AudioWaveSavable
            projectId={asset.projectId}
            src={assetRawUrl(asset.id)}
            filename={assetMeta(asset).filename ?? "audio"}
          />
        )}
        {asset.kind === "text" && (
          <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
            {asset.textContent}
          </p>
        )}
        <div className="space-y-2 text-sm">
          {meta.preset && (
            <p>
              <span className="text-muted-foreground">设定：</span>
              {PRESET_LABEL[meta.preset]}「{meta.presetName}」
              <span className="ml-1 text-xs text-muted-foreground">
                可在流水线新建分镜时引用
              </span>
            </p>
          )}
          {meta.modelName && (
            <p>
              <span className="text-muted-foreground">模型：</span>
              <code className="font-mono text-xs">
                {meta.modelKey ? modelDisplayName(meta.modelKey) : meta.modelName}
              </code>
            </p>
          )}
          {meta.prompt && (
            <p>
              <span className="text-muted-foreground">提示词：</span>
              {meta.prompt}
            </p>
          )}
          {(() => {
            const p = (meta.params ?? {}) as Record<string, unknown>;
            const px = String(p.actualSize || p.size || "").replace("x", "×");
            const ratio = String(p.actualRatio || p.ratio || "");
            const resolution = String(p.actualResolution || p.resolution || "");
            const duration = p.actualDuration ?? p.duration;
            const frames = p.actualFrames ?? p.frames;
            const fps = p.framesPerSecond ?? p.actualFramesPerSecond;
            const parts = [
              px && `${px} px`,
              resolution,
              ratio && ratio !== "adaptive" && ratio,
              duration !== undefined && duration !== -1 && `${duration}s`,
              frames !== undefined && `${frames} 帧${fps ? ` · ${fps} fps` : ""}`,
            ].filter(Boolean);
            return parts.length ? (
              <p>
                <span className="text-muted-foreground">规格：</span>
                <code className="font-mono text-xs">{parts.join(" · ")}</code>
              </p>
            ) : null;
          })()}
          {meta.uploaded && (
            <p className="text-muted-foreground">用户上传：{meta.filename}</p>
          )}
          {formula && (
            <div className="space-y-1 rounded-md border border-primary/25 bg-primary/5 p-2.5">
              <p>
                <span className="text-muted-foreground">公式：</span>
                {formula.mode === "latex" ? "LaTeX" : "中文近似"} · {formula.exportSize}
              </p>
              <code className="block max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-xs">
                {formula.activeLatex || "—"}
              </code>
              <p className="text-xs text-muted-foreground">
                {formula.renderedWidth} × {formula.renderedHeight} · {formula.cjkFont.split(",")[0]}
              </p>
            </div>
          )}
          <p className="text-muted-foreground">
            创建于 {new Date(asset.createdAt).toLocaleString("zh-CN")}
            {asset.bytes ? ` · ${(asset.bytes / 1024 / 1024).toFixed(2)} MB` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && onToggleFavorite && (
            <Button
              variant="outline"
              size="sm"
              className={asset.favorite ? "text-favorite" : "text-muted-foreground"}
              title={asset.favorite ? "已收藏为可用备选，点击取消" : "收藏为可用备选"}
              aria-pressed={asset.favorite}
              loading={favoriting}
              loadingText="更新中"
              onClick={() => onToggleFavorite(asset)}
            >
              <Star className={asset.favorite ? "fill-current" : ""} />
              {asset.favorite ? "已收藏" : "收藏"}
            </Button>
          )}
          {canEdit && asset.kind === "video" && onExtend && (
            <Button variant="outline" size="sm" onClick={() => onExtend(asset)}>
              <Film /> 原生延长
            </Button>
          )}
          {canEdit && formula && onEditFormula && (
            <Button variant="outline" size="sm" onClick={() => onEditFormula(asset)}>
              <Sigma /> 编辑公式
            </Button>
          )}
          {asset.kind !== "text" && (
            <Button asChild variant="outline" size="sm">
              <a href={assetDownloadUrl(asset.id)} download>
                <Download /> 下载
              </a>
            </Button>
          )}
          {canEdit &&
            (confirming ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => del.mutate()}
                  loading={del.isPending}
                  loadingText="删除中"
                >
                  <Trash2 /> 确认删除
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  取消
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 /> 删除
              </Button>
            ))}
        </div>
        {del.isError && (
          <StatusMessage tone="danger">{del.error.message}</StatusMessage>
        )}
        <ReviewSection asset={asset} />
      </div>
    </DialogContent>
  );
}

/** 瀑布流视频卡：按真实比例占位，悬停预览播放 */
function MasonryVideo({ assetId }: { assetId: string }) {
  const [ratio, setRatio] = useState<number>();
  return (
    <div className="relative w-full" style={{ aspectRatio: ratio ?? 16 / 9 }}>
      <VideoPoster
        assetId={assetId}
        hoverPreview
        onAspectRatio={setRatio}
        className="absolute inset-0"
      />
    </div>
  );
}

export function AssetsTab({
  projectId,
  onExtend,
  onEditFormula,
}: {
  projectId: string;
  onExtend?: (asset: AssetDto) => void;
  onEditFormula?: (asset: AssetDto) => void;
}) {
  const canEdit = useCanEdit();
  const [kind, setKind] = useState<string>("all");
  const [selected, setSelected] = useState<AssetDto | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [creator, setCreator] = useState("all");
  const [preset, setPreset] = useState("all");
  const [favOnly, setFavOnly] = useState(false);
  const [showTop, setShowTop] = useState(false);

  // 素材库随页面（window）滚动，滚超过一屏显示「回到顶部」
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: project } = useQuery<ProjectDetailDto>({
    queryKey: ["project", projectId],
    queryFn: () => api(`/api/projects/${projectId}`),
  });

  const qs = new URLSearchParams();
  if (kind !== "all") qs.set("kind", kind);
  if (qDebounced) qs.set("q", qDebounced);
  if (creator !== "all") qs.set("userId", creator);
  if (preset !== "all") qs.set("preset", preset);
  if (favOnly) qs.set("favorite", "1");
  const qsStr = qs.toString();

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AssetPageDto>({
    queryKey: ["assets", projectId, kind, qDebounced, creator, preset, favOnly],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const pageQs = new URLSearchParams(qsStr);
      pageQs.set("limit", "50");
      if (pageParam) pageQs.set("cursor", String(pageParam));
      return api(`/api/projects/${projectId}/assets?${pageQs}`);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 15000,
  });
  const assetItems = data?.pages.flatMap((page) => page.items);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // 逐个触发浏览器下载：可下载的素材（非文案）依次点击隐藏 <a download>，
  // 每个之间留 300ms 间隔，避免浏览器把连续下载当成弹窗拦截。
  const downloadSelected = async () => {
    const targets = (assetItems ?? []).filter(
      (a) => selectedIds.has(a.id) && a.kind !== "text"
    );
    if (!targets.length) return;
    setDownloading(true);
    try {
      for (const a of targets) {
        const link = document.createElement("a");
        link.href = assetDownloadUrl(a.id);
        link.download = ""; // 文件名由后端 Content-Disposition 决定
        document.body.appendChild(link);
        link.click();
        link.remove();
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      setDownloading(false);
    }
  };

  const qc = useQueryClient();
  const assetsKey = ["assets", projectId, kind, qDebounced, creator, preset, favOnly];
  const toggleFavorite = useMutation({
    mutationFn: (asset: AssetDto) =>
      api(`/api/assets/${asset.id}`, {
        method: "PATCH",
        json: { favorite: !asset.favorite },
      }),
    onMutate: async (asset) => {
      await qc.cancelQueries({ queryKey: assetsKey });
      const prev = qc.getQueryData<{ pages: AssetPageDto[] }>(assetsKey);
      qc.setQueryData<{ pages: AssetPageDto[]; pageParams: unknown[] }>(assetsKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((it) =>
                  it.id === asset.id ? { ...it, favorite: !asset.favorite } : it
                ),
              })),
            }
          : old
      );
      setSelected((cur) => (cur?.id === asset.id ? { ...cur, favorite: !asset.favorite } : cur));
      return { prev };
    },
    onError: (_e, _asset, ctx) => {
      if (ctx?.prev) qc.setQueryData(assetsKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["assets", projectId] });
    },
  });

  const downloadableCount = (assetItems ?? []).filter(
    (a) => selectedIds.has(a.id) && a.kind !== "text"
  ).length;

  return (
    <div className="space-y-4">
      <Tabs value={kind} onValueChange={setKind}>
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="image">
            <ImageIcon className="size-4" /> 图像
          </TabsTrigger>
          <TabsTrigger value="video">
            <Film className="size-4" /> 视频
          </TabsTrigger>
          <TabsTrigger value="audio">
            <FileAudio className="size-4" /> 音频
          </TabsTrigger>
          <TabsTrigger value="text">
            <FileText className="size-4" /> 文案
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索素材"
            className="pl-8"
            placeholder="搜索提示词 / 文件名 / 设定名……"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={creator} onValueChange={setCreator}>
          <SelectTrigger aria-label="按创建人筛选素材" className="w-36">
            <SelectValue placeholder="创建人" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部创建人</SelectItem>
            {project?.members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={preset} onValueChange={setPreset}>
          <SelectTrigger aria-label="按素材类型筛选" className="w-32">
            <SelectValue placeholder="设定" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部素材</SelectItem>
            <SelectItem value="character">角色设定</SelectItem>
            <SelectItem value="scene">场景设定</SelectItem>
            <SelectItem value="style">风格设定</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={favOnly ? "default" : "outline"}
          size="sm"
          className={favOnly ? "" : "text-muted-foreground"}
          title="只看收藏为「可用备选」的素材"
          aria-pressed={favOnly}
          onClick={() => setFavOnly((v) => !v)}
        >
          <Star className={`size-4 ${favOnly ? "fill-current" : ""}`} /> 只看收藏
        </Button>
        {selectMode ? (
          <>
            <Button
              variant="magenta"
              size="sm"
              onClick={downloadSelected}
              disabled={!downloadableCount}
              loading={downloading}
              loadingText="下载中"
            >
              <Download /> 下载选中（{downloadableCount}）
            </Button>
            <Button variant="ghost" size="sm" onClick={exitSelectMode}>
              取消
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>
            <Download /> 批量下载
          </Button>
        )}
      </div>

      {canEdit && <UploadDropZone projectId={projectId} compact />}

      {isLoading ? (
        <LoadingState label="正在加载素材…" />
      ) : assetItems?.length ? (
        <>
        <div className="columns-2 gap-2 sm:columns-3 lg:columns-4 xl:columns-5">
          {assetItems.map((a) => {
            const meta = assetMeta(a);
            const formula = readFormulaAssetState(a);
            return (
              <Card
                key={a.id}
                data-asset-id={a.id}
                className={`group mb-2 block break-inside-avoid overflow-hidden transition-colors hover:border-primary/50 ${
                  selectMode && a.kind === "text"
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer"
                } ${selectMode && selectedIds.has(a.id) ? "border-primary ring-2 ring-primary/35" : ""}`}
                onClick={() => {
                  if (selectMode) {
                    if (a.kind !== "text") toggleSelect(a.id);
                  } else {
                    setSelected(a);
                  }
                }}
              >
                <div className="relative bg-muted">
                  {selectMode && a.kind !== "text" && (
                    <div className="absolute right-2 top-2 z-10 flex size-5 items-center justify-center rounded-full border-2 border-white bg-black/40 shadow">
                      {selectedIds.has(a.id) && (
                        <CheckCircle2 className="size-5 text-primary" />
                      )}
                    </div>
                  )}
                  {a.kind === "image" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetThumbnailUrl(a.id)}
                      alt=""
                      className="block h-auto w-full"
                      loading="lazy"
                    />
                  )}
                  {a.kind === "video" && <MasonryVideo assetId={a.id} />}
                  {a.kind === "audio" && (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 p-2">
                      <FileAudio className="size-7 text-primary" />
                      <audio
                        src={assetRawUrl(a.id)}
                        controls
                        className="h-8 w-full"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  {a.kind === "text" && (
                    <p className="line-clamp-6 p-3 text-xs text-muted-foreground">
                      {a.textContent}
                    </p>
                  )}
                  <div className="absolute left-2 top-2 flex gap-1">
                    {/* 类型标签是低信息量的常驻噪音，改为 hover 才显现 */}
                    <Badge
                      variant="secondary"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      {KIND_LABEL[a.kind]}
                    </Badge>
                    {/* 设定/评审状态承载语义，常驻 */}
                    {meta.preset && (
                      <Badge variant="magenta">
                        {PRESET_LABEL[meta.preset]}
                      </Badge>
                    )}
                    {formula && <Badge variant="secondary">公式</Badge>}
                    {a.reviewStatus === "approved" && (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="size-3" /> 采用
                      </Badge>
                    )}
                    {a.reviewStatus === "rejected" && (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="size-3" /> 废弃
                      </Badge>
                    )}
                  </div>
                  <Info className="absolute right-2 top-2 size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  {!selectMode && canEdit && (
                    <button
                      type="button"
                      title={a.favorite ? "已收藏为可用备选，点击取消" : "收藏为可用备选"}
                      aria-label={a.favorite ? "取消收藏" : "收藏为可用备选"}
                      aria-pressed={a.favorite}
                      disabled={toggleFavorite.isPending}
                      aria-busy={toggleFavorite.isPending && toggleFavorite.variables?.id === a.id}
                      className={`absolute bottom-2 right-2 rounded-full bg-black/45 p-1 text-white transition-opacity hover:bg-black/65 ${
                        a.favorite ? "bg-black/70 opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite.mutate(a);
                      }}
                    >
                      {toggleFavorite.isPending && toggleFavorite.variables?.id === a.id ? (
                        <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Star className={`size-3.5 ${a.favorite ? "fill-favorite-muted text-favorite-muted" : ""}`} />
                      )}
                    </button>
                  )}
                </div>
                <CardContent className="p-2.5">
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {meta.presetName || meta.prompt || meta.filename || "—"}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {hasNextPage && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fetchNextPage()}
            loading={isFetchingNextPage}
            loadingText="加载中"
          >
            加载更多素材
          </Button>
        )}
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12">
            <Library className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">
              还没有素材：拖拽本地文件到上方上传，或去「手动创作」生成
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <AssetDetail
            asset={selected}
            onDeleted={() => setSelected(null)}
            onExtend={(asset) => {
              setSelected(null);
              onExtend?.(asset);
            }}
            onEditFormula={(asset) => {
              setSelected(null);
              onEditFormula?.(asset);
            }}
            onToggleFavorite={canEdit ? (asset) => toggleFavorite.mutate(asset) : undefined}
            favoriting={toggleFavorite.isPending}
          />
        )}
      </Dialog>

      {showTop && (
        <Button
          variant="secondary"
          size="icon"
          className="fixed bottom-6 right-6 z-40 size-10 rounded-full shadow-lg"
          title="回到顶部"
          aria-label="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <ArrowUp className="size-5" />
        </Button>
      )}
    </div>
  );
}
