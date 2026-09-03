"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { SelectionIndicator } from "@/components/ui/selection-indicator";
import { StatusMessage } from "@/components/ui/status-message";
import { Textarea } from "@/components/ui/textarea";
import {
  REF_MEDIA_MAX_SECONDS,
  VIDEO_FRAMES,
  VIDEO_MODE_LABEL,
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
  formatPx,
  isValidVideoFrames,
  videoCap,
  videoDurationFromFrames,
  videoPx,
  type VideoCapability,
  type VideoLengthMode,
  type VideoMode,
  type VideoResolution
} from "@/lib/ark/capabilities";
import { api } from "@/lib/client/api";
import {
  enabledManagedModels,
  managedCapabilities,
  useManagedModelCatalog,
} from "@/lib/client/models";
import {
  assetRawUrl,
  type AssetDto,
  type TaskDto
} from "@/lib/client/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  ChevronDown,
  Clock3,
  FileUp,
  Film,
  Gauge,
  Globe2,
  Image as ImageIcon,
  LayoutTemplate,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AssetPicker } from "../asset-picker";
import {
  EmptyWorkspaceActions,
  type EmptyWorkspaceAction,
} from "../empty-workspace-actions";
import { GenHistory } from "../gen-history";
import { MentionTextarea } from "../mention-textarea";
import { ModelSelect } from "../model-select";
import { useCanEdit } from "../read-only";
import { RefChip, ThumbStrip } from "../ref-chip";
import { RefTrimDialog } from "../ref-trim-dialog";
import {
  latestFailedCreatorTask,
  useCreatorTasks
} from "../use-creator-history";
import { useAssetsByIds, useVideoRefs } from "../use-video-refs";
import {
  ComposerSteps,
  CreatorComposer,
  CreatorWorkspaceShell,
  ParamSummary,
  StarterPrompts,
} from "./creator-workspace";
import { StudioSettingsFlyout } from "./settings-flyout";

/* ---------------- 视频 ---------------- */

type FramePickTarget = "first" | "last" | "ref";

function AdaptiveGlowVideo({ src }: { src: string }) {
  const foregroundRef = useRef<HTMLVideoElement>(null);
  const glowRef = useRef<HTMLVideoElement>(null);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);

  const orientation =
    aspectRatio < 0.9 ? "portrait" : aspectRatio > 1.15 ? "landscape" : "square";

  function syncGlow(force = false) {
    const foreground = foregroundRef.current;
    const glow = glowRef.current;
    if (!foreground || !glow) return;
    if (force || Math.abs(glow.currentTime - foreground.currentTime) > 0.15) {
      glow.currentTime = foreground.currentTime;
    }
  }

  function playGlow() {
    syncGlow(true);
    void glowRef.current?.play().catch(() => undefined);
  }

  function pauseGlow() {
    glowRef.current?.pause();
    syncGlow(true);
  }

  return (
    <div
      className={`relative max-h-full max-w-full ${
        orientation === "portrait"
          ? "h-[min(55vh,560px)] w-auto"
          : orientation === "square"
            ? "h-[min(52vh,540px)] w-auto"
            : "h-auto w-[min(92%,980px)]"
      }`}
      style={{ aspectRatio }}
    >
      <video
        ref={glowRef}
        src={src}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 h-full w-full scale-[1.12] object-cover opacity-40 blur-3xl saturate-150"
      />
      <video
        ref={foregroundRef}
        src={src}
        controls
        playsInline
        preload="metadata"
        className="relative z-10 block h-full w-full bg-transparent object-contain shadow-[0_22px_65px_-30px_rgba(0,0,0,0.4)]"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) {
            setAspectRatio(video.videoWidth / video.videoHeight);
          }
          syncGlow(true);
        }}
        onPlay={playGlow}
        onPause={pauseGlow}
        onSeeking={() => syncGlow(true)}
        onSeeked={() => syncGlow(true)}
        onTimeUpdate={() => syncGlow()}
        onRateChange={() => {
          const foreground = foregroundRef.current;
          const glow = glowRef.current;
          if (foreground && glow) glow.playbackRate = foreground.playbackRate;
        }}
      />
    </div>
  );
}

export function VideoPanel({
  projectId,
  initialExtendAsset,
  projectName,
}: {
  projectId: string;
  initialExtendAsset?: AssetDto | null;
  projectName?: string;
}) {
  const qc = useQueryClient();
  const canEdit = useCanEdit();
  const modelCatalog = useManagedModelCatalog();
  const fetchByIds = useAssetsByIds(projectId);
  const [prompt, setPrompt] = useState("");
  const [modelKeyPreference, setModelKeyRaw] = useState("seedance-2.0");
  const [mode, setMode] = useState<VideoMode>(initialExtendAsset ? "extend" : "t2v");
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  const [lengthMode, setLengthMode] = useState<VideoLengthMode>("duration");
  const [duration, setDuration] = useState("5");
  const [frames, setFrames] = useState(String(VIDEO_FRAMES.min));
  const [ratio, setRatio] = useState("adaptive");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [returnLastFrame, setReturnLastFrame] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [priority, setPriority] = useState("0");
  const [serviceTier, setServiceTier] = useState<"default" | "flex">("default");
  const [executionExpiresAfter, setExecutionExpiresAfter] = useState("7200");
  const [seed, setSeed] = useState("-1");
  const [draft, setDraft] = useState(false);
  const [extensionDirection, setExtensionDirection] = useState<"after" | "before">("after");
  const [firstFrame, setFirstFrame] = useState<AssetDto | null>(null);
  const [lastFrame, setLastFrame] = useState<AssetDto | null>(null);
  const [pickTarget, setPickTarget] = useState<FramePickTarget | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [selectedStageTaskId, setSelectedStageTaskId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);

  const availableVideoModels = enabledManagedModels(modelCatalog.data, "video");
  const modelAvailable = !modelCatalog.data || availableVideoModels.length > 0;
  const modelKey =
    modelCatalog.data &&
    !availableVideoModels.some((model) => model.key === modelKeyPreference)
      ? (availableVideoModels.find((model) => model.default)?.key ??
        availableVideoModels[0]?.key ??
        modelKeyPreference)
      : modelKeyPreference;
  const capabilityFor = (key: string) =>
    managedCapabilities<VideoCapability>(
      modelCatalog.data,
      key,
      videoCap(key)
    );
  const cap = capabilityFor(modelKey);
  const px = ratio === "adaptive" ? null : videoPx(resolution, ratio, modelKey);
  const {
    refs,
    setRefs,
    refError,
    refNotice,
    refProbing,
    trim,
    setTrim,
    refCount,
    refKinds,
    audioOnlyRefs,
    addRef,
    removeRef,
  } = useVideoRefs(
    cap,
    initialExtendAsset?.kind === "video" ? [initialExtendAsset] : []
  );

  const referenceNames = useMemo(() => {
    const count = { image: 0, video: 0, audio: 0 };
    const prefix = { image: "图片", video: "视频", audio: "音频" } as const;
    return new Map(
      refs.map((asset) => {
        const kind = asset.kind as keyof typeof count;
        count[kind] += 1;
        return [asset.id, `${prefix[kind]}${count[kind]}`];
      })
    );
  }, [refs]);

  const durations = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    if (cap.smartDuration) list.push({ value: "-1", label: "智能时长（模型自动决定）" });
    for (let s = cap.duration.min; s <= cap.duration.max; s++) {
      list.push({ value: String(s), label: `${s} 秒` });
    }
    return list;
  }, [cap]);

  const frameValue = Number(frames);
  const framesValid =
    !!cap.frames && isValidVideoFrames(frameValue, cap.frames);

  function switchLengthMode(next: VideoLengthMode) {
    if (next === "frames") {
      if (!cap.frames) return;
      if (!isValidVideoFrames(frameValue, cap.frames)) {
        setFrames(String(cap.frames.min));
      }
    }
    setLengthMode(next);
  }

  // 切换模型：回退不支持的取值
  function setModelKey(key: string) {
    setModelKeyRaw(key);
    const next = capabilityFor(key);
    if (!next.resolutions.includes(resolution)) setResolution(next.defaultResolution);
    if (!next.modes.includes(mode)) {
      setMode("t2v");
      setRefs([]);
      setLastFrame(null);
    }
    if (!next.frames && lengthMode === "frames") setLengthMode("duration");
    if (next.frames && !isValidVideoFrames(frameValue, next.frames)) {
      setFrames(String(next.frames.min));
    }
    const d = Number(duration);
    if (d === -1 && !next.smartDuration) setDuration(String(next.duration.min + 1));
    else if (d !== -1 && (d < next.duration.min || d > next.duration.max)) {
      setDuration(String(Math.min(Math.max(d, next.duration.min), next.duration.max)));
    }
    if (ratio === "adaptive" && !next.adaptiveRatio) setRatio("16:9");
    if (!next.cameraFixed) setCameraFixed(false);
    if (!next.returnLastFrame) setReturnLastFrame(false);
    else setReturnLastFrame(true);
    if (!next.webSearch) setWebSearch(false);
    if (!next.priority) setPriority("0");
    if (!next.seed) setSeed("-1");
    if (!next.draft) setDraft(false);
    if (!next.serviceTiers.includes(serviceTier)) setServiceTier("default");
  }

  function switchMode(m: VideoMode) {
    setMode(m);
    setRefs([]);
    if (m === "t2v" || m === "reference" || m === "extend") {
      setFirstFrame(null);
      setLastFrame(null);
    }
    if (m === "first_frame") setLastFrame(null);
    if (m !== "t2v") setCameraFixed(false);
    if (m === "extend" && lengthMode === "frames") setLengthMode("duration");
  }

  function toggleDraft() {
    const next = !draft;
    setDraft(next);
    if (next) {
      setResolution("480p");
      setReturnLastFrame(false);
      setServiceTier("default");
    } else {
      setResolution(cap.defaultResolution);
    }
  }

  const readyToSubmit =
    modelAvailable &&
    !!prompt.trim() &&
    !refProbing &&
    (lengthMode === "duration" || framesValid) &&
    (mode === "t2v" ||
      (mode === "first_frame" && !!firstFrame) ||
      (mode === "first_last" && !!firstFrame && !!lastFrame) ||
      (mode === "reference" && refs.length > 0 && !audioOnlyRefs) ||
      (mode === "extend" && refs.length === 1 && refs[0]?.kind === "video"));
  const readyHint = !prompt.trim()
    ? "先描述你希望画面里发生什么。"
    : refProbing
      ? "正在读取参考素材，请稍候。"
      : lengthMode === "frames" && !framesValid
        ? "帧数必须为 29–289，且按 4 帧递增（24 fps）。"
      : mode === "first_frame" && !firstFrame
        ? "当前模式还需要添加一张首帧图。"
        : mode === "first_last" && (!firstFrame || !lastFrame)
          ? "当前模式需要同时添加首帧和尾帧。"
          : mode === "reference" && refs.length === 0
            ? "当前模式至少需要一份参考素材。"
            : audioOnlyRefs
              ? "音频不能单独参考，请再添加图片或视频。"
              : mode === "extend" && (refs.length !== 1 || refs[0]?.kind !== "video")
                ? "视频延长模式需要选择一段原视频。"
                : null;

  const gen = useMutation({
    mutationFn: () =>
      api<{ task: TaskDto }>(`/api/projects/${projectId}/generate/video`, {
        method: "POST",
        json: {
          prompt,
          modelKey,
          resolution,
          durationMode: lengthMode,
          duration: lengthMode === "duration" ? Number(duration) : undefined,
          frames: lengthMode === "frames" ? frameValue : undefined,
          ratio,
          firstFrameAssetId:
            mode === "first_frame" || mode === "first_last" ? firstFrame?.id : undefined,
          lastFrameAssetId: mode === "first_last" ? lastFrame?.id : undefined,
          refAssetIds:
            mode === "reference" || mode === "extend" ? refs.map((r) => r.id) : [],
          generateAudio: cap.generateAudio ? generateAudio : undefined,
          cameraFixed: cap.cameraFixed && mode === "t2v" ? cameraFixed : undefined,
          watermark,
          returnLastFrame: cap.returnLastFrame ? returnLastFrame : false,
          webSearch: cap.webSearch ? webSearch : false,
          priority: cap.priority ? Number(priority) : 0,
          serviceTier,
          executionExpiresAfter: Number(executionExpiresAfter),
          seed: cap.seed ? Number(seed) : -1,
          draft: cap.draft ? draft : false,
          operation: mode === "extend" ? "extend" : "generate",
          extensionDirection: mode === "extend" ? extensionDirection : undefined,
        },
      }),
    onSuccess: () => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId, "video"] });
    },
  });

  /** 一键复用历史记录配置 */
  async function reuse(input: Record<string, unknown>) {
    const mk = String(input.modelKey ?? "seedance-2.0");
    setModelKey(mk);
    if (typeof input.resolution === "string") {
      setResolution(input.resolution as VideoResolution);
    }
    if (input.duration !== undefined) setDuration(String(input.duration));
    const nextCap = capabilityFor(mk);
    const inputFrames = Number(input.frames);
    if (nextCap.frames && isValidVideoFrames(inputFrames, nextCap.frames)) {
      setFrames(String(inputFrames));
      setLengthMode("frames");
    } else {
      setLengthMode("duration");
    }
    if (typeof input.ratio === "string") setRatio(input.ratio);
    if (typeof input.generateAudio === "boolean") setGenerateAudio(input.generateAudio);
    setCameraFixed(input.cameraFixed === true && capabilityFor(mk).cameraFixed);
    setWatermark(input.watermark === true);
    setReturnLastFrame(
      typeof input.returnLastFrame === "boolean"
        ? input.returnLastFrame
        : capabilityFor(mk).returnLastFrame
    );
    setWebSearch(input.webSearch === true && capabilityFor(mk).webSearch);
    setPriority(String(input.priority ?? 0));
    setServiceTier(input.serviceTier === "flex" ? "flex" : "default");
    setExecutionExpiresAfter(String(input.executionExpiresAfter ?? 7200));
    setSeed(String(input.seed ?? -1));
    setDraft(input.draft === true && capabilityFor(mk).draft);
    if (input.extensionDirection === "before" || input.extensionDirection === "after") {
      setExtensionDirection(input.extensionDirection);
    }
    setPrompt(String(input.prompt ?? ""));
    const refList = await fetchByIds(input.refAssetIds);
    const ff = input.firstFrameAssetId
      ? ((await fetchByIds([input.firstFrameAssetId]))[0] ?? null)
      : null;
    const lf = input.lastFrameAssetId
      ? ((await fetchByIds([input.lastFrameAssetId]))[0] ?? null)
      : null;
    setRefs(refList);
    setFirstFrame(ff);
    setLastFrame(lf);
    setMode(
      input.operation === "extend"
        ? "extend"
        : refList.length
          ? "reference"
          : lf
            ? "first_last"
            : ff
              ? "first_frame"
              : "t2v"
    );
  }

  const { data: videoTasks } = useCreatorTasks(projectId, "video");
  const failedVideoTask = latestFailedCreatorTask(videoTasks);
  const stageTask =
    videoTasks?.find((task) => task.id === selectedStageTaskId) ??
    videoTasks?.find((task) => task.outputAsset?.kind === "video") ??
    videoTasks?.[0];
  const stageAsset = stageTask?.outputAsset?.kind === "video"
    ? stageTask.outputAsset
    : null;
  const videoEmptyActions: EmptyWorkspaceAction[] = [
    {
      label: "上传参考素材",
      detail: "图片、视频或音频起稿",
      icon: FileUp,
      onClick: () => {
        switchMode("reference");
        setPickTarget("ref");
      },
      disabled: !canEdit,
    },
    {
      label: "首尾帧模板",
      detail: "先定义开始与结束画面",
      icon: LayoutTemplate,
      onClick: () => {
        switchMode("first_last");
        setPickTarget("first");
      },
      disabled: !canEdit,
    },
    ...(failedVideoTask
      ? [{
          label: "恢复最近失败",
          detail: failedVideoTask.task.error || "恢复上次输入与参数",
          icon: RotateCcw,
          tone: "recovery" as const,
          onClick: () => void reuse(failedVideoTask.input),
        }]
      : []),
  ];

  return (
    <>
      <CreatorWorkspaceShell
        kind="video"
        index="VIDEO / 02"
        label="视频创作"
        projectName={projectName}
        history={
          <>
            <div className="shrink-0 px-3 pb-2 pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">开启创作</p>
                <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Shot desk
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPrompt("");
                  setSelectedStageTaskId(null);
                  setSubmitted(false);
                }}
                className="video-new-shot mt-3 flex h-10 w-full items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium hover:bg-accent"
              >
                <Plus className="size-4" /> 新建创作
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <GenHistory
                projectId={projectId}
                kinds="video"
                title="最近镜头"
                resubmitPath={`/api/projects/${projectId}/generate/video`}
                onReuse={(input) => void reuse(input)}
                variant="sidebar"
                activeTaskId={stageTask?.id}
                onTaskOpen={(task) => setSelectedStageTaskId(task.id)}
              />
            </div>
          </>
        }
      >
        <section className="video-stage col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col bg-muted/20 min-[1100px]:col-start-2" aria-label="视频创作舞台">
          <div className="video-stage-canvas relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-5 lg:px-10">
            <Button
              ref={settingsTriggerRef}
              type="button"
              variant="outline"
              size="sm"
              className="creation-canvas-settings absolute right-4 top-4 z-30 h-10"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              aria-controls="video-settings-panel"
            >
              <Settings2 /> 更多设置
            </Button>
            {stageAsset ? (
              <AdaptiveGlowVideo
                key={stageAsset.id}
                src={assetRawUrl(stageAsset.id)}
              />
            ) : (
              <div className="video-stage-empty relative z-10 flex max-w-2xl flex-col items-center px-8 text-center text-muted-foreground">
                <p className="video-stage-kicker font-mono text-micro font-semibold uppercase tracking-[0.18em]">
                  {"//"} New shot · 01
                </p>
                <div className="video-stage-mark mb-5 mt-4 flex size-14 items-center justify-center">
                  <Film className="size-6" />
                </div>
                <p className="text-2xl font-bold leading-tight text-foreground">从一个镜头想法开始</p>
                <p className="creation-stage-description mt-2 max-w-sm text-ui leading-6 text-muted-foreground">
                  加入参考素材并描述动作、光线和运镜，生成结果会直接回到这个舞台。
                </p>
                <StarterPrompts
                  items={[
                    { label: "产品广告", value: "低机位环绕一台未来感跑车，雨夜霓虹倒影掠过车身，镜头缓慢推近，电影级光影" },
                    { label: "人物叙事", value: "年轻摄影师清晨走过雾气中的海边小镇，手持跟拍，柔和逆光，情绪温暖而克制" },
                    { label: "自然奇观", value: "航拍镜头掠过冰川峡谷，云层快速流动，阳光穿透形成体积光，宏大而真实" },
                  ]}
                  onSelect={(value) => {
                    switchMode("t2v");
                    setPrompt(value);
                  }}
                />
                <EmptyWorkspaceActions actions={videoEmptyActions} />
                <span className="video-stage-speedline mt-6" aria-hidden="true" />
              </div>
            )}
            {stageTask && (
              <div className="absolute left-4 top-4 z-20 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white/75 backdrop-blur">
                {stageTask.status === "succeeded"
                  ? "最近成片"
                  : stageTask.status === "running"
                    ? "正在生成"
                    : stageTask.status === "queued"
                      ? "排队中"
                      : "最近任务"}
              </div>
            )}
          </div>

          <div className="creation-composer-zone is-video relative z-20 flex shrink-0 justify-center px-4 pb-5 lg:px-8">
            <CreatorComposer kind="video">
              <ComposerSteps finalLabel="生成视频" />
              {(mode === "first_frame" || mode === "first_last") && (
                <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
                  <span className="text-xs font-medium text-muted-foreground">关键帧</span>
                  {firstFrame ? (
                    <ThumbStrip items={[firstFrame]} onRemove={() => setFirstFrame(null)} />
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setPickTarget("first")}>
                      <ImageIcon /> 添加首帧
                    </Button>
                  )}
                  {mode === "first_last" &&
                    (lastFrame ? (
                      <ThumbStrip items={[lastFrame]} onRemove={() => setLastFrame(null)} />
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setPickTarget("last")}>
                        <ImageIcon /> 添加尾帧
                      </Button>
                    ))}
                </div>
              )}

              {(mode === "reference" || mode === "extend") && (
                <div className="border-b border-border/70 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-medium text-muted-foreground">
                      {mode === "extend" ? "待延长视频" : "参考素材"}
                    </span>
                    {refs.map((asset) => (
                      <RefChip
                        key={asset.id}
                        asset={asset}
                        referenceName={
                          mode === "extend"
                            ? "视频1"
                            : referenceNames.get(asset.id) ?? "参考素材"
                        }
                        onRemove={() => removeRef(asset.id)}
                      />
                    ))}
                    {(mode !== "extend" || refs.length === 0) && (
                      <Button variant="ghost" size="sm" onClick={() => setPickTarget("ref")}>
                        <Plus /> {mode === "extend" ? "选择视频" : "添加素材"}
                      </Button>
                    )}
                    {mode === "extend" && (
                      <div className="ml-auto flex rounded-lg bg-muted p-1">
                        {([[
                          "after",
                          "向后续写",
                        ], ["before", "向前补拍"]] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setExtensionDirection(value)}
                            aria-pressed={extensionDirection === value}
                            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${
                              extensionDirection === value
                                ? "bg-background font-medium shadow-sm"
                                : "text-muted-foreground"
                            }`}
                          >
                            <SelectionIndicator
                              selected={extensionDirection === value}
                              className="size-3.5"
                            />
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {mode === "reference" && (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      图 {refCount.image}/{cap.maxRefImages}
                      {cap.maxRefVideos > 0 && ` · 视频 ${refCount.video}/${cap.maxRefVideos}`}
                      {cap.maxRefAudios > 0 && ` · 音频 ${refCount.audio}/${cap.maxRefAudios}`}
                      {` · 音视频单段 2-${REF_MEDIA_MAX_SECONDS}s`}
                      {cap.maxRefAudios > 0 && " · 音频按需自动压缩"}
                    </p>
                  )}
                  {refProbing && (
                    <p
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                      className="mt-2 text-xs text-muted-foreground"
                    >
                      正在检测素材时长...
                    </p>
                  )}
                  {refNotice && <StatusMessage tone="success" appearance="inline" className="mt-2">{refNotice}</StatusMessage>}
                  {refError && <StatusMessage tone="danger" appearance="inline" className="mt-2">{refError}</StatusMessage>}
                  {audioOnlyRefs && (
                    <StatusMessage tone="danger" appearance="inline" className="mt-2">
                      音频不能单独作为参考，请至少再添加一张图片或一段视频。
                    </StatusMessage>
                  )}
                </div>
              )}

              <div className="px-4 pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 text-primary" />
                  描述主体、动作、环境、光线与运镜
                </div>
                {mode === "reference" ? (
                  <MentionTextarea
                    projectId={projectId}
                    ariaLabel="视频提示词"
                    rows={3}
                    placeholder="描述目标视频；输入 @ 可引用素材库中的人物、场景或声音……"
                    value={prompt}
                    onChange={setPrompt}
                    kinds={refKinds}
                    onPick={(asset) => void addRef(asset)}
                  />
                ) : (
                  <Textarea
                    aria-label="视频提示词"
                    rows={3}
                    className="mt-1 min-h-20 resize-none border-0 bg-transparent px-0 text-base leading-7 shadow-none focus-visible:ring-0"
                    placeholder={
                      mode === "extend"
                        ? extensionDirection === "before"
                          ? "描述原片开始前发生的内容，以及如何自然衔接……"
                          : "描述原片结束后继续发生的内容、动作与运镜……"
                        : "例如：低机位跟拍赛车驶入雨夜维修区，霓虹倒影划过车身，镜头缓慢推近……"
                    }
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border/55 px-4 py-3">
                <ModelSelect
                  kind="video"
                  value={modelKey}
                  onChange={setModelKey}
                  ariaLabel="视频模型"
                  className="h-10 min-w-44 flex-1 bg-background sm:max-w-60"
                />
                <Select value={mode} onValueChange={(value) => switchMode(value as VideoMode)}>
                  <SelectTrigger aria-label="视频创作模式" className="h-10 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VIDEO_MODE_LABEL) as VideoMode[]).map((value) => (
                      <SelectItem key={value} value={value} disabled={!cap.modes.includes(value)}>
                        {VIDEO_MODE_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={resolution} onValueChange={(value) => setResolution(value as VideoResolution)}>
                  <SelectTrigger aria-label="视频分辨率" className="h-10 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VIDEO_RESOLUTIONS.map((value) => (
                      <SelectItem
                        key={value}
                        value={value}
                        disabled={!cap.resolutions.includes(value) || (draft && value !== "480p")}
                      >
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={ratio} onValueChange={setRatio}>
                  <SelectTrigger aria-label="视频画幅比例" className="h-10 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cap.adaptiveRatio && <SelectItem value="adaptive">自适应</SelectItem>}
                    {VIDEO_RATIOS.map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {cap.frames && (
                  <Select value={lengthMode} onValueChange={(value) => switchLengthMode(value as VideoLengthMode)}>
                    <SelectTrigger aria-label="视频长度模式" className="h-10 w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="duration">按时长</SelectItem>
                      <SelectItem value="frames">按帧数</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {lengthMode === "frames" && cap.frames ? (
                  <Input
                    aria-label="视频帧数"
                    type="number"
                    min={cap.frames.min}
                    max={cap.frames.max}
                    step={cap.frames.step}
                    value={frames}
                    onChange={(event) => setFrames(event.target.value)}
                    className="h-10 w-24 bg-background"
                  />
                ) : (
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger aria-label="视频时长" className="h-10 w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {durations.map((item) => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {cap.generateAudio && (
                  <button
                    type="button"
                    onClick={() => setGenerateAudio((value) => !value)}
                    aria-pressed={generateAudio}
                    className="flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {generateAudio ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
                    {generateAudio ? "有声" : "无声"}
                  </button>
                )}
                <Button
                  onClick={() => {
                    setSubmitted(false);
                    gen.mutate();
                  }}
                  disabled={!canEdit || !readyToSubmit}
                  loading={gen.isPending}
                  loadingText="提交中"
                  className="creation-primary-action ml-auto h-10 shrink-0 px-5 text-sm font-semibold"
                >
                  <Film /> {draft ? "生成 Draft" : "生成视频"}
                </Button>
                {submitted && (
                  <StatusMessage tone="success" appearance="inline" className="w-full">
                    任务已提交
                  </StatusMessage>
                )}
              </div>
              {readyHint && (
                <p className="composer-ready-hint border-t border-border/55 px-4 py-2.5">{readyHint}</p>
              )}
              {gen.isError && (
                <StatusMessage tone="danger" appearance="strip">
                  {gen.error.message}
                </StatusMessage>
              )}
              {!modelAvailable && (
                <StatusMessage tone="info" appearance="strip">
                  当前没有上线的视频模型，请联系管理员。
                </StatusMessage>
              )}
            </CreatorComposer>
          </div>
        </section>

        <StudioSettingsFlyout
          open={settingsOpen}
          id="video-settings-panel"
          title="视频生成设置"
          description="常用参数保持在创作框中，完整能力从画布侧边展开。"
          onClose={() => setSettingsOpen(false)}
          triggerRef={settingsTriggerRef}
        >
          <div className="space-y-6">
            <div>
              <p className="text-sm font-semibold">输出</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                常用参数保持可见，其余能力按需展开。
              </p>
            </div>

            {cap.draft && (
              <button
                type="button"
                onClick={toggleDraft}
                aria-pressed={draft}
                className="flex w-full items-center justify-between border-b border-border/70 pb-4 text-left"
              >
                <span>
                  <span className="block text-sm font-medium">Draft 样片</span>
                  <span className="mt-1 block text-xs text-muted-foreground">480p 低成本验证</span>
                </span>
                <span className={`font-mono text-xs ${draft ? "text-warning" : "text-muted-foreground"}`}>
                  {draft ? "ON" : "OFF"}
                </span>
              </button>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>分辨率</Label>
                <Select value={resolution} onValueChange={(value) => setResolution(value as VideoResolution)}>
                  <SelectTrigger aria-label="视频分辨率"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VIDEO_RESOLUTIONS.map((value) => {
                      const supported = cap.resolutions.includes(value) && (!draft || value === "480p");
                      return (
                        <SelectItem key={value} value={value} disabled={!supported}>
                          {value}{value === "4k" ? " · 10-bit H.265" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>画幅比例</Label>
                <Select value={ratio} onValueChange={setRatio}>
                  <SelectTrigger aria-label="视频画幅比例"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cap.adaptiveRatio && <SelectItem value="adaptive">自适应</SelectItem>}
                    {VIDEO_RATIOS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value} · {formatPx(videoPx(resolution, value, modelKey) ?? "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{lengthMode === "frames" ? "帧数" : mode === "extend" ? "新片段时长" : "时长"}</Label>
                {cap.frames && (
                  <Select value={lengthMode} onValueChange={(value) => switchLengthMode(value as VideoLengthMode)}>
                    <SelectTrigger aria-label="视频长度模式"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="duration">按时长</SelectItem>
                      <SelectItem value="frames">按帧数</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {lengthMode === "frames" && cap.frames ? (
                  <>
                    <Input
                      aria-label="视频帧数"
                      type="number"
                      min={cap.frames.min}
                      max={cap.frames.max}
                      step={cap.frames.step}
                      value={frames}
                      onChange={(event) => setFrames(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      24 fps · 约 {videoDurationFromFrames(frameValue, cap.frames.fps).toFixed(2)} 秒；29–289，步长 4
                    </p>
                  </>
                ) : (
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger aria-label={mode === "extend" ? "新片段时长" : "视频时长"}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {durations.map((item) => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="divide-y divide-border/70 border-y border-border/70">
              {cap.generateAudio && (
                <button
                  type="button"
                  onClick={() => setGenerateAudio((value) => !value)}
                  aria-pressed={generateAudio}
                  className="flex w-full items-center gap-2 py-3 text-sm"
                >
                  {generateAudio ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                  同步音频
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {generateAudio ? "ON" : "OFF"}
                  </span>
                </button>
              )}
              {cap.cameraFixed && mode === "t2v" && (
                <button
                  type="button"
                  onClick={() => setCameraFixed((value) => !value)}
                  aria-pressed={cameraFixed}
                  className="flex w-full items-center gap-2 py-3 text-sm"
                >
                  <Camera className="size-4" /> 固定摄像头
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {cameraFixed ? "ON" : "OFF"}
                  </span>
                </button>
              )}
            </div>

            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <Settings2 className="size-4" /> 高级设置
                <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-4 space-y-4 border-l border-border pl-4">
                {cap.webSearch && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setWebSearch((value) => !value)}
                      aria-pressed={webSearch}
                      className="flex w-full items-center gap-2 text-sm"
                    >
                      <Globe2 className="size-4" /> 联网搜索
                      <span className="ml-auto font-mono text-xs text-muted-foreground">{webSearch ? "ON" : "OFF"}</span>
                    </button>
                    {webSearch && (
                      <p className="text-xs leading-5 text-muted-foreground">
                        模型自主决定实际搜索次数；公网资源每月前 2 万次免费，超出后公开价 4 元/千次。
                      </p>
                    )}
                  </div>
                )}
                {cap.returnLastFrame && !draft && (
                  <button
                    type="button"
                    onClick={() => setReturnLastFrame((value) => !value)}
                    aria-pressed={returnLastFrame}
                    className="flex w-full items-center gap-2 text-sm"
                  >
                    <Film className="size-4" /> 保存无水印尾帧
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{returnLastFrame ? "ON" : "OFF"}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setWatermark((value) => !value)}
                  aria-pressed={watermark}
                  className="flex w-full items-center gap-2 text-sm"
                >
                  <ShieldCheck className="size-4" /> 视频水印
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{watermark ? "ON" : "OFF"}</span>
                </button>
                {cap.priority && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Gauge className="size-3.5" /> 队列优先级</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger aria-label="视频队列优先级"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, value) => (
                          <SelectItem key={value} value={String(value)}>{value}{value === 0 ? " · 普通" : value === 9 ? " · 最高" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {cap.serviceTiers.length > 1 && !draft && (
                  <div className="space-y-2">
                    <Label>服务等级</Label>
                    <Select value={serviceTier} onValueChange={(value) => setServiceTier(value as "default" | "flex")}>
                      <SelectTrigger aria-label="视频服务等级"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">在线 · 标准速度</SelectItem>
                        <SelectItem value="flex">Flex · 约半价 / 延迟更高</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {serviceTier === "flex"
                        ? "离线推理：公开价约为在线的 50%，TPD 配额更高但通常等待更久。"
                        : "在线推理：优先响应；实际用量按供应商返回 token 计费。"}
                    </p>
                  </div>
                )}
                {modelKey.startsWith("seedance-2.0") &&
                  (mode === "extend" || refs.some((asset) => asset.kind === "video")) && (
                    <div className="rounded-lg border border-warning/30 bg-warning-muted/45 p-3 text-xs leading-5 text-muted-foreground">
                      输入包含视频时存在最低 token 用量门槛；低于门槛仍按最低值计费，门槛随分辨率、画幅和输入/输出时长变化。完成后可在任务详情查看供应商实际 token。
                    </div>
                  )}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><Clock3 className="size-3.5" /> 最长执行时间</Label>
                  <Select value={executionExpiresAfter} onValueChange={setExecutionExpiresAfter}>
                    <SelectTrigger aria-label="视频最长执行时间"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3600">1 小时</SelectItem>
                      <SelectItem value="7200">2 小时（推荐）</SelectItem>
                      <SelectItem value="43200">12 小时</SelectItem>
                      <SelectItem value="172800">48 小时</SelectItem>
                      <SelectItem value="259200">72 小时</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {cap.seed && (
                  <div className="space-y-2">
                    <Label>随机种子</Label>
                    <Input aria-label="视频随机种子" type="number" min={-1} max={4294967295} value={seed} onChange={(event) => setSeed(event.target.value)} />
                    <p className="text-xs text-muted-foreground">-1 为随机</p>
                  </div>
                )}
              </div>
            </details>

            <ParamSummary>
              {resolution} · {ratio === "adaptive" ? "自适应" : `${ratio} · ${formatPx(px ?? "")} px`} · {lengthMode === "frames" && cap.frames
                ? `${frames} 帧 · ${videoDurationFromFrames(frameValue, cap.frames.fps).toFixed(3)}s`
                : duration === "-1"
                  ? "智能"
                  : `${duration}s`}
            </ParamSummary>
          </div>
        </StudioSettingsFlyout>
      </CreatorWorkspaceShell>

      <AssetPicker
        projectId={projectId}
        open={pickTarget !== null}
        onOpenChange={(o) => !o && setPickTarget(null)}
        kinds={pickTarget === "ref" ? (mode === "extend" ? ["video"] : refKinds) : ["image"]}
        onSelect={(a) => {
          if (pickTarget === "first") setFirstFrame(a);
          else if (pickTarget === "last") setLastFrame(a);
          else if (pickTarget === "ref") void addRef(a);
        }}
        title={
          pickTarget === "first"
            ? "选择首帧图"
            : pickTarget === "last"
              ? "选择尾帧图"
              : mode === "extend"
                ? "选择待延长视频"
                : "选择参考素材"
        }
      />

      <RefTrimDialog
        projectId={projectId}
        asset={trim?.asset ?? null}
        duration={trim?.duration ?? 0}
        onClose={() => setTrim(null)}
        onDone={(a, trimmedDuration) => {
          setTrim(null);
          void addRef(a, trimmedDuration);
        }}
      />
    </>
  );
}
