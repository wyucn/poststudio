"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusMessage } from "@/components/ui/status-message";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import { managedModel, useManagedModelCatalog } from "@/lib/client/models";
import {
  assetLabel,
  assetRawUrl,
  type AssetDto,
  type AssetTranscriptDto,
  type QwenTtsHealthDto,
  type QwenTtsHealthStatus,
  type QwenTtsInstanceKey,
  type TaskDto,
} from "@/lib/client/types";
import {
  TTS_EMOTION_LABEL,
  TTS_GROUP_LABEL,
  TTS_GROUP_ORDER,
  TTS_MAX_CHARS,
  TTS_VOICES
} from "@/lib/coze/plugins";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Captions,
  FileUp,
  LayoutTemplate,
  Mic,
  RotateCcw,
  Save
} from "lucide-react";
import { useState } from "react";
import {
  type EmptyWorkspaceAction
} from "../empty-workspace-actions";
import { GenHistory } from "../gen-history";
import { useCanEdit } from "../read-only";
import { TtsInlinePlayer } from "../tts-inline-player";
import { UploadDropZone } from "../upload-drop-zone";
import {
  latestFailedCreatorTask,
  latestSuccessfulCreatorTask,
  useCreatorTasks,
} from "../use-creator-history";
import { CreationWorkspace } from "./creator-stage";
import {
  ComposerSteps,
  CreatorComposer,
  StarterPrompts,
} from "./creator-workspace";

/* ---------------- 配音（Coze / Qwen3-TTS 声音克隆） ---------------- */

const QWEN_TTS_HEALTH_LABEL: Record<QwenTtsHealthStatus, string> = {
  healthy: "可用",
  degraded: "部分可用",
  offline: "暂不可用",
  unconfigured: "未配置",
  disabled: "已下线",
};

function qwenTtsHealthVariant(
  status: QwenTtsHealthStatus | undefined
): "success" | "warning" | "destructive" | "secondary" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "offline") return "destructive";
  if (status === "disabled") return "secondary";
  return "secondary";
}

export function TtsPanel({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const qc = useQueryClient();
  const canEdit = useCanEdit();
  const modelCatalog = useManagedModelCatalog();
  const { data: ttsTasks } = useCreatorTasks(projectId, "audio");
  const referenceAudioQueryKey = ["assets", projectId, "tts-reference"] as const;
  const [providerPreference, setProvider] = useState<"coze" | "modelscope">("coze");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(TTS_VOICES[0].id);
  const [emotion, setEmotion] = useState("none");
  const [emotionScale, setEmotionScale] = useState("5");
  const [speed, setSpeed] = useState("1");
  const [referenceDraft, setReferenceDraft] = useState({
    assetId: "",
    text: "",
    dirty: false,
  });
  const referenceAudioAssetId = referenceDraft.assetId;
  const [language, setLanguage] = useState("Auto");
  const [modelSize, setModelSize] = useState<"0.6B" | "1.7B">("1.7B");
  const [useXVectorOnly, setUseXVectorOnly] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qwenInstanceOverride, setQwenInstanceOverride] =
    useState<QwenTtsInstanceKey | null>(null);

  const cozeTtsEnabled =
    managedModel(modelCatalog.data, "coze-tts")?.enabled !== false;
  const transcriptionEnabled =
    managedModel(modelCatalog.data, "coze-audio-transcription")?.enabled !== false;
  const qwenTtsEnabled =
    modelCatalog.data?.items.some(
      (item) => item.modelKey === "modelscope-qwen3-tts" && item.enabled
    ) ?? true;
  const provider =
    modelCatalog.data &&
    ((providerPreference === "coze" && !cozeTtsEnabled) ||
      (providerPreference === "modelscope" && !qwenTtsEnabled))
      ? qwenTtsEnabled
        ? "modelscope"
        : "coze"
      : providerPreference;

  const qwenHealthQuery = useQuery<QwenTtsHealthDto>({
    queryKey: ["qwen-tts-health"],
    queryFn: () => api<QwenTtsHealthDto>("/api/integrations/qwen-tts/health"),
    enabled: provider === "modelscope",
    staleTime: 30_000,
    refetchInterval: provider === "modelscope" ? 60_000 : false,
    retry: false,
  });
  const qwenInstance =
    qwenInstanceOverride ?? qwenHealthQuery.data?.defaultInstance ?? "public";
  const qwenInstanceOptions =
    qwenHealthQuery.data?.instances ??
    ([
      {
        key: "public" as const,
        label: "公共创空间",
        experimental: true,
        configured: true,
        status: "healthy" as const,
        message: "正在检查服务状态。",
        latencyMs: null,
        capacity: {
          queued: 0,
          running: 0,
          limit: 1,
          utilization: 0,
          hint: "公共创空间共享 GPU，忙时会排队。",
        },
      },
      {
        key: "self-hosted" as const,
        label: "自建实例",
        experimental: false,
        configured: false,
        status: "unconfigured" as const,
        message: "管理员尚未配置自建实例地址。",
        latencyMs: null,
        capacity: {
          queued: 0,
          running: 0,
          limit: 1,
          utilization: 0,
          hint: "管理员尚未配置自建实例。",
        },
      },
    ] satisfies QwenTtsHealthDto["instances"]);
  const selectedQwenInstance = qwenInstanceOptions.find(
    (instance) => instance.key === qwenInstance
  );

  const { data: audioAssets = [] } = useQuery({
    queryKey: referenceAudioQueryKey,
    queryFn: () =>
      api<AssetDto[]>(`/api/projects/${projectId}/assets?kind=audio`),
  });
  const selectedReferenceAudio = audioAssets.find(
    (asset) => asset.id === referenceAudioAssetId
  );
  const referenceAudioTooLarge =
    (selectedReferenceAudio?.bytes ?? 0) > 20 * 1024 * 1024;

  const transcriptQueryKey = [
    "asset-transcript",
    referenceAudioAssetId,
  ] as const;
  const transcriptQuery = useQuery<{
    transcript: AssetTranscriptDto | null;
  }>({
    queryKey: transcriptQueryKey,
    queryFn: () =>
      api(`/api/assets/${referenceAudioAssetId}/transcript`),
    enabled: !!referenceAudioAssetId,
    refetchInterval: (query) => {
      const status = query.state.data?.transcript?.status;
      return status === "queued" || status === "running" ? 2000 : false;
    },
  });
  const transcript = transcriptQuery.data?.transcript ?? null;
  const transcriptActive =
    transcript?.status === "queued" || transcript?.status === "running";
  const transcriptReady =
    transcript?.status === "succeeded" && !!transcript.sourceText;
  const referenceText =
    !referenceDraft.dirty && transcriptReady && transcript?.text
      ? transcript.text
      : referenceDraft.text;

  const transcribeReference = useMutation({
    mutationFn: ({ assetId }: { assetId: string }) =>
      api<{
        transcript: AssetTranscriptDto | null;
        cached: boolean;
      }>(`/api/assets/${assetId}/transcript`, {
        method: "POST",
      }),
    onSuccess: (result, variables) => {
      qc.setQueryData(
        ["asset-transcript", variables.assetId],
        { transcript: result.transcript }
      );
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });
  const saveTranscript = useMutation({
    mutationFn: ({ assetId, text }: { assetId: string; text: string }) =>
      api<{ transcript: AssetTranscriptDto }>(
        `/api/assets/${assetId}/transcript`,
        { method: "PATCH", json: { text } }
      ),
    onSuccess: (result, variables) => {
      qc.setQueryData(["asset-transcript", variables.assetId], result);
      setReferenceDraft((current) =>
        current.assetId === result.transcript.assetId
          ? {
              ...current,
              text: result.transcript.text ?? current.text,
              dirty: false,
            }
          : current
      );
    },
  });

  function selectReferenceAudio(assetId: string) {
    transcribeReference.reset();
    saveTranscript.reset();
    setReferenceDraft((current) =>
      current.assetId === assetId
        ? current
        : { assetId, text: "", dirty: false }
    );
  }

  function changeReferenceText(value: string) {
    setReferenceDraft((current) => ({
      ...current,
      text: value,
      dirty: true,
    }));
  }

  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  const voiceEmotions = voice?.emotions ?? [];
  const supportsEmotion = voiceEmotions.length > 0;
  // 当前选中的情感是否被这个音色支持（多情感音色严格校验，避免 invalid emotion）
  const emotionActive =
    supportsEmotion && emotion !== "none" && (voiceEmotions as string[]).includes(emotion);

  const gen = useMutation({
    mutationFn: () =>
      api<{ task: TaskDto }>(`/api/projects/${projectId}/generate/tts`, {
        method: "POST",
        json:
          provider === "modelscope"
            ? {
                provider,
                text,
                referenceAudioAssetId,
                referenceText: useXVectorOnly ? undefined : referenceText,
                instance:
                  qwenInstanceOverride ?? qwenHealthQuery.data?.defaultInstance,
                language,
                modelSize,
                useXVectorOnly,
              }
            : {
                provider,
                text,
                voiceId,
                emotion: emotionActive ? emotion : undefined,
                emotionScale: emotionActive ? Number(emotionScale) : undefined,
                speedRatio: Number(speed),
              },
      }),
    onSuccess: () => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ["assets", projectId] });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId, "audio"] });
    },
  });

  function reuse(input: Record<string, unknown>) {
    const nextProvider =
      input.provider === "modelscope" || input.referenceAudioAssetId
        ? "modelscope"
        : "coze";
    setProvider(nextProvider);
    setText(String(input.text ?? ""));
    if (typeof input.voiceId === "string") setVoiceId(input.voiceId);
    setEmotion(typeof input.emotion === "string" ? input.emotion : "none");
    if (input.emotionScale !== undefined) setEmotionScale(String(input.emotionScale));
    if (input.speedRatio !== undefined) setSpeed(String(input.speedRatio));
    const reusedReferenceText = String(input.referenceText ?? "");
    setReferenceDraft({
      assetId: String(input.referenceAudioAssetId ?? ""),
      text: reusedReferenceText,
      dirty: !!reusedReferenceText.trim(),
    });
    transcribeReference.reset();
    saveTranscript.reset();
    setQwenInstanceOverride(
      input.instance === "self-hosted" || input.instance === "public"
        ? input.instance
        : null
    );
    setLanguage(String(input.language ?? "Auto"));
    setModelSize(input.modelSize === "0.6B" ? "0.6B" : "1.7B");
    setUseXVectorOnly(input.useXVectorOnly === true);
  }

  const qwenServiceConfigured =
    provider !== "modelscope" ||
    !qwenHealthQuery.data ||
    selectedQwenInstance?.configured !== false;
  const qwenReady =
    (provider === "coze" && cozeTtsEnabled) ||
    (qwenServiceConfigured &&
      !!referenceAudioAssetId &&
      !referenceAudioTooLarge &&
      (useXVectorOnly ||
        (!!referenceText.trim() && referenceText.length <= 2048)));
  const ttsReadyHint = !text.trim()
    ? "先输入要朗读的旁白或台词。"
    : provider === "coze" && !cozeTtsEnabled
      ? "豆包预设音色已由管理员暂时下线，请切换声音克隆或稍后重试。"
      : provider === "modelscope" && !qwenTtsEnabled
        ? "Qwen3-TTS 已由管理员暂时下线，请切换预设音色或稍后重试。"
    : provider === "modelscope" && !qwenServiceConfigured
      ? selectedQwenInstance?.message || "当前声音克隆实例尚未配置，请切换实例或联系管理员。"
      : provider === "modelscope" && !referenceAudioAssetId
      ? "声音克隆还需要上传或选择一段参考音频。"
      : referenceAudioTooLarge
        ? "参考音频超过 20 MB，请先裁剪或压缩。"
        : provider === "modelscope" && referenceText.length > 2048
          ? "参考音频原文超过 2048 字，请先精简校对文本。"
        : provider === "modelscope" && !useXVectorOnly && !referenceText.trim()
          ? "请填写参考音频原文，或打开“转写与校对”自动识别。"
          : null;

  const failedTtsTask = latestFailedCreatorTask(ttsTasks);
  const latestTtsTask = latestSuccessfulCreatorTask(ttsTasks, "audio");
  const ttsEmptyActions: EmptyWorkspaceAction[] = [
    {
      label: "上传参考音频",
      detail: "进入已授权声音克隆流程",
      icon: FileUp,
      onClick: () => {
        setProvider("modelscope");
        setSettingsOpen(true);
      },
      disabled: !canEdit || !qwenTtsEnabled,
    },
    {
      label: "选择音色模板",
      detail: "预设音色、情感和语速",
      icon: LayoutTemplate,
      onClick: () => {
        setProvider("coze");
        setSettingsOpen(true);
      },
      disabled: !canEdit || !cozeTtsEnabled,
    },
    ...(failedTtsTask
      ? [{
          label: "恢复最近失败",
          detail: failedTtsTask.task.error || "恢复上次输入与参数",
          icon: RotateCcw,
          tone: "recovery" as const,
          onClick: () => reuse(failedTtsTask.input),
        }]
      : []),
  ];

  return (
    <CreationWorkspace
      kind="tts"
      index="VOICE / 04"
      label="配音创作"
      projectName={projectName}
      headline="让文字拥有声音"
      description="选择预设音色或克隆已获授权的声音，在同一舞台完成试听与精修。"
      icon={Mic}
      starters={
        <StarterPrompts
          items={[
            { label: "品牌旁白", value: "真正好的工具，不会打断灵感，而是让每一次创作都更自然、更接近想象。" },
            { label: "人物对白", value: "我不是在等待一个答案，我只是在确认，我们是否愿意一起出发。" },
            {
              label: "声音克隆",
              value: "这是一段声音克隆测试文本。",
              action: () => {
                setProvider("modelscope");
                setText("这是一段声音克隆测试文本，请使用已获授权的参考声音完成合成。");
              },
            },
          ]}
          onSelect={setText}
        />
      }
      actions={ttsEmptyActions}
      history={
        <GenHistory
          projectId={projectId}
          kinds="audio"
          title="我的合成记录"
          resubmitPath={`/api/projects/${projectId}/generate/tts`}
          onReuse={reuse}
          variant="sidebar"
        />
      }
      settings={{
        open: settingsOpen,
        onToggle: () => setSettingsOpen((value) => !value),
        onClose: () => setSettingsOpen(false),
        title: "配音与声音克隆设置",
        description: "预设音色、情感表达与声音克隆细节都集中在这里，正文始终留在创作栏。",
        content: (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>合成引擎</Label>
              <Select value={provider} onValueChange={(value) => setProvider(value as "coze" | "modelscope")}>
                <SelectTrigger aria-label="配音合成引擎"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="coze" disabled={!cozeTtsEnabled}>豆包预设音色</SelectItem>
                  <SelectItem value="modelscope" disabled={!qwenTtsEnabled}>Qwen3-TTS 声音克隆（实验）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {provider === "modelscope" && (
              <section
                data-qwen-tts-service-status
                aria-label="声音克隆服务状态"
                className="space-y-3 rounded-lg border border-border bg-muted/35 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">服务实例</span>
                      {qwenInstance === "public" && (
                        <Badge variant="warning">实验性公共创空间</Badge>
                      )}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      健康检查只读取配置和接口元数据，不会触发模型生成。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="重新检查声音克隆服务"
                    loading={qwenHealthQuery.isFetching}
                    loadingText="检查中"
                    onClick={() => qwenHealthQuery.refetch()}
                  >
                    <RotateCcw /> 检查状态
                  </Button>
                </div>
                <Select
                  value={qwenInstance}
                  onValueChange={(value) =>
                    setQwenInstanceOverride(value as QwenTtsInstanceKey)
                  }
                >
                  <SelectTrigger aria-label="声音克隆服务实例">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {qwenInstanceOptions.map((instance) => (
                      <SelectItem
                        key={instance.key}
                        value={instance.key}
                        disabled={!instance.configured}
                      >
                        {instance.label}
                        {instance.experimental
                          ? "（实验）"
                          : !instance.configured
                            ? "（未配置）"
                            : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant={qwenTtsHealthVariant(selectedQwenInstance?.status)}
                  >
                    {selectedQwenInstance
                      ? QWEN_TTS_HEALTH_LABEL[selectedQwenInstance.status]
                      : "检查中"}
                  </Badge>
                  {selectedQwenInstance?.latencyMs != null && (
                    <span>{selectedQwenInstance.latencyMs} ms</span>
                  )}
                  {selectedQwenInstance && (
                    <span>
                      运行 {selectedQwenInstance.capacity.running} · 排队{" "}
                      {selectedQwenInstance.capacity.queued}
                    </span>
                  )}
                </div>
                {selectedQwenInstance && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {selectedQwenInstance.message} {selectedQwenInstance.capacity.hint}
                  </p>
                )}
                {qwenInstance === "public" && (
                  <StatusMessage tone="warning" appearance="inline">
                    公共创空间由第三方共享运行，容量和可用性不承诺；正式或批量任务建议使用自建实例。
                  </StatusMessage>
                )}
                {qwenHealthQuery.isError && (
                  <StatusMessage tone="danger" appearance="inline">
                    服务状态读取失败：{qwenHealthQuery.error.message}
                  </StatusMessage>
                )}
              </section>
            )}

            {provider === "coze" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>音色</Label>
                  <Select
                    value={voiceId}
                    onValueChange={(value) => {
                      setVoiceId(value);
                      const next = TTS_VOICES.find((item) => item.id === value);
                      if (emotion !== "none" && !(next?.emotions as readonly string[] | undefined)?.includes(emotion)) {
                        setEmotion("none");
                      }
                    }}
                  >
                    <SelectTrigger aria-label="配音音色"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-80">
                      {TTS_GROUP_ORDER.map((group) => {
                        const voices = TTS_VOICES.filter((item) => item.group === group);
                        if (!voices.length) return null;
                        return (
                          <SelectGroup key={group}>
                            <SelectLabel>{TTS_GROUP_LABEL[group]}</SelectLabel>
                            {voices.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name}
                                {item.v2 && <span className="ml-1.5 text-xs text-primary">2.0</span>}
                                {!!item.emotions?.length && <span className="ml-1.5 text-xs text-primary">多情感</span>}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>语速</Label>
                    <Select value={speed} onValueChange={setSpeed}>
                      <SelectTrigger aria-label="配音语速"><SelectValue /></SelectTrigger>
                      <SelectContent>{["0.5", "0.8", "1", "1.2", "1.5", "2"].map((value) => <SelectItem key={value} value={value}>{value}x</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {supportsEmotion && (
                    <div className="space-y-2">
                      <Label>情感</Label>
                      <Select value={emotion} onValueChange={setEmotion}>
                        <SelectTrigger aria-label="配音情感"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">默认</SelectItem>
                          {voiceEmotions.map((value) => <SelectItem key={value} value={value}>{TTS_EMOTION_LABEL[value]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {emotionActive && (
                    <div className="col-span-2 space-y-2">
                      <Label>情感强度</Label>
                      <Select value={emotionScale} onValueChange={setEmotionScale}>
                        <SelectTrigger aria-label="配音情感强度"><SelectValue /></SelectTrigger>
                        <SelectContent>{["1", "2", "3", "4", "5"].map((value) => <SelectItem key={value} value={value}>{value} 级</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                {!supportsEmotion && (
                  <p className="text-xs leading-5 text-muted-foreground">需要开心、悲伤或生气等表达时，请选择名称带“多情感”的音色。</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>参考音频素材</Label>
                  <Select value={referenceAudioAssetId} onValueChange={selectReferenceAudio}>
                    <SelectTrigger aria-label="声音克隆参考音频"><SelectValue placeholder="从当前项目选择音频" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {audioAssets.map((asset) => <SelectItem key={asset.id} value={asset.id}>{assetLabel(asset)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <UploadDropZone
                    projectId={projectId}
                    kinds={["audio"]}
                    multiple={false}
                    compact
                    maxFileSizeMb={20}
                    onUploaded={(asset) => {
                      qc.setQueryData<AssetDto[]>(referenceAudioQueryKey, (current) => [asset, ...(current ?? []).filter((item) => item.id !== asset.id)]);
                      selectReferenceAudio(asset.id);
                    }}
                  />
                </div>
                {selectedReferenceAudio && (
                  <div className="space-y-2 rounded-md border border-border bg-background/80 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-medium">{assetLabel(selectedReferenceAudio)}</span>
                      {selectedReferenceAudio.bytes != null && <span className="shrink-0 text-muted-foreground">{(selectedReferenceAudio.bytes / 1024 / 1024).toFixed(1)} MB</span>}
                    </div>
                    <audio key={selectedReferenceAudio.id} src={assetRawUrl(selectedReferenceAudio.id)} controls preload="metadata" className="h-10 w-full" />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                      <div className="min-w-0 text-xs text-muted-foreground">
                        {transcriptReady
                          ? `转写已缓存 · ${new Date(transcript.updatedAt).toLocaleString("zh-CN")}`
                          : transcriptActive
                            ? "正在后台识别语音，完成后会自动回填原文。"
                            : "自动识别后可播放音频逐字校对。"}
                      </div>
                      {!transcriptReady && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          disabled={!canEdit || !transcriptionEnabled || referenceAudioTooLarge || transcriptQuery.isLoading}
                          loading={transcribeReference.isPending || transcriptActive}
                          loadingText="转写中"
                          onClick={() =>
                            transcribeReference.mutate({
                              assetId: referenceAudioAssetId,
                            })
                          }
                        >
                          <Captions />
                          {transcript?.status === "failed" || transcript?.status === "cancelled"
                            ? "重新转写"
                            : "语音转文字"}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {referenceAudioTooLarge && <StatusMessage tone="danger" appearance="inline">该音频超过 20 MB，请裁剪或压缩后重新上传。</StatusMessage>}
                {transcript?.status === "failed" && (
                  <StatusMessage tone="danger" appearance="inline">
                    {transcript.error || "语音转写失败，请稍后重试。"}
                  </StatusMessage>
                )}
                {transcript?.status === "cancelled" && (
                  <StatusMessage tone="neutral" appearance="inline">
                    转写任务已取消，可以重新提交。
                  </StatusMessage>
                )}
                {transcriptQuery.isError && (
                  <StatusMessage tone="danger" appearance="inline">
                    {transcriptQuery.error.message}
                  </StatusMessage>
                )}
                {transcribeReference.isError && (
                  <StatusMessage tone="danger" appearance="inline">
                    {transcribeReference.error.message}
                  </StatusMessage>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>目标语言</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger aria-label="声音克隆目标语言"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[["Auto", "自动识别"], ["Chinese", "中文"], ["English", "英语"], ["Japanese", "日语"], ["Korean", "韩语"], ["French", "法语"], ["German", "德语"], ["Spanish", "西班牙语"], ["Portuguese", "葡萄牙语"], ["Russian", "俄语"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>模型规格</Label>
                    <Select value={modelSize} onValueChange={(value) => setModelSize(value as "0.6B" | "1.7B")}>
                      <SelectTrigger aria-label="声音克隆模型规格"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="1.7B">1.7B · 质量优先</SelectItem><SelectItem value="0.6B">0.6B · 速度优先</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" checked={useXVectorOnly} onChange={(event) => setUseXVectorOnly(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                  <span>仅提取音色（无需参考文本，但相似度和韵律质量会降低）</span>
                </label>
                {!useXVectorOnly && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label>参考音频原文</Label>
                      <span className="text-xs text-muted-foreground">
                        {referenceText.length}/2048 字
                      </span>
                    </div>
                    <Textarea
                      aria-label="参考音频原文"
                      rows={4}
                      value={referenceText}
                      maxLength={2048}
                      readOnly={!canEdit}
                      onChange={(event) => changeReferenceText(event.target.value)}
                      placeholder="逐字填写参考音频里实际说的内容；文本越准确，克隆质量越好"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="mr-auto text-xs leading-5 text-muted-foreground">
                        可播放上方音频，边听边填写和校对。
                      </p>
                      {transcriptReady && canEdit && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={referenceText === transcript.sourceText}
                            onClick={() =>
                              changeReferenceText(transcript.sourceText ?? "")
                            }
                          >
                            <RotateCcw /> 恢复识别文本
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              !referenceDraft.dirty ||
                              !referenceText.trim() ||
                              referenceText.length > 2048
                            }
                            loading={saveTranscript.isPending}
                            loadingText="保存中"
                            onClick={() =>
                              saveTranscript.mutate({
                                assetId: referenceAudioAssetId,
                                text: referenceText,
                              })
                            }
                          >
                            <Save /> 保存校对
                          </Button>
                        </>
                      )}
                    </div>
                    {saveTranscript.isError && (
                      <StatusMessage tone="danger" appearance="inline">
                        {saveTranscript.error.message}
                      </StatusMessage>
                    )}
                    {saveTranscript.isSuccess && !referenceDraft.dirty && (
                      <StatusMessage tone="success" appearance="inline">
                        校对文本已缓存，重新选择该音频时会自动回填。
                      </StatusMessage>
                    )}
                  </div>
                )}
                <StatusMessage tone="warning">仅使用本人或已获明确授权的声音；建议上传 5–15 秒、单人、无背景音乐的清晰语音。</StatusMessage>
              </div>
            )}
          </div>
        ),
      }}
    >
      <CreatorComposer kind="tts">
          {latestTtsTask && (
            <TtsInlinePlayer task={latestTtsTask} onReuse={reuse} />
          )}
          <ComposerSteps finalLabel="生成配音" />
          <div className={provider === "modelscope" ? "creation-tts-main-grid" : ""}>
            <div className="creation-compact-prompt px-4 pt-3">
              <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-2"><Mic className="size-3.5 text-primary" /> 输入旁白或台词</span>
                <span>{text.length}/{TTS_MAX_CHARS} 字</span>
              </div>
              <Textarea
                aria-label="配音文本"
                rows={4}
                className="mt-1 min-h-24 resize-none border-0 bg-transparent px-0 text-base leading-7 shadow-none focus-visible:ring-0"
                placeholder="输入要合成的旁白 / 台词，支持中英文混合……"
                value={text}
                maxLength={TTS_MAX_CHARS}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
            {provider === "modelscope" && (
              <div className="creation-compact-reference border-l border-border/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">参考音频</span>
                  <button type="button" onClick={() => setSettingsOpen(true)} className="text-xs font-medium text-primary hover:underline">转写与校对</button>
                </div>
                <Select value={referenceAudioAssetId} onValueChange={selectReferenceAudio}>
                  <SelectTrigger aria-label="声音克隆参考音频" className="mt-2"><SelectValue placeholder="从项目资产选择" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {audioAssets.map((asset) => <SelectItem key={asset.id} value={asset.id}>{assetLabel(asset)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <UploadDropZone
                  projectId={projectId}
                  kinds={["audio"]}
                  multiple={false}
                  compact
                  maxFileSizeMb={20}
                  onUploaded={(asset) => {
                    qc.setQueryData<AssetDto[]>(referenceAudioQueryKey, (current) => [asset, ...(current ?? []).filter((item) => item.id !== asset.id)]);
                    selectReferenceAudio(asset.id);
                  }}
                />
                {referenceAudioAssetId && (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {transcriptReady
                      ? "参考原文已缓存，可打开“转写与校对”继续修订。"
                      : transcriptActive
                        ? "正在后台转写，完成后会自动回填参考原文。"
                        : "可打开“转写与校对”自动识别参考原文。"}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="creation-compact-toolbar">
            <Select value={provider} onValueChange={(value) => setProvider(value as "coze" | "modelscope")}>
              <SelectTrigger aria-label="配音合成引擎" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="coze" disabled={!cozeTtsEnabled}>豆包预设音色</SelectItem><SelectItem value="modelscope" disabled={!qwenTtsEnabled}>Qwen3-TTS 声音克隆</SelectItem></SelectContent>
            </Select>
            {provider === "coze" ? (
              <>
                <Select value={voiceId} onValueChange={setVoiceId}>
                  <SelectTrigger aria-label="配音音色" className="w-56 flex-1 sm:max-w-64"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-80">{TTS_VOICES.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={speed} onValueChange={setSpeed}>
                  <SelectTrigger aria-label="配音语速" className="w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>{["0.5", "0.8", "1", "1.2", "1.5", "2"].map((value) => <SelectItem key={value} value={value}>{value}x</SelectItem>)}</SelectContent>
                </Select>
              </>
            ) : (
              <>
                <Select
                  value={qwenInstance}
                  onValueChange={(value) =>
                    setQwenInstanceOverride(value as QwenTtsInstanceKey)
                  }
                >
                  <SelectTrigger aria-label="声音克隆服务实例" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {qwenInstanceOptions.map((instance) => (
                      <SelectItem
                        key={instance.key}
                        value={instance.key}
                        disabled={!instance.configured}
                      >
                        {instance.label}
                        {instance.experimental ? "（实验）" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger aria-label="声音克隆目标语言" className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Auto">自动识别</SelectItem><SelectItem value="Chinese">中文</SelectItem><SelectItem value="English">英语</SelectItem><SelectItem value="Japanese">日语</SelectItem><SelectItem value="Korean">韩语</SelectItem></SelectContent>
                </Select>
                <Select value={modelSize} onValueChange={(value) => setModelSize(value as "0.6B" | "1.7B")}>
                  <SelectTrigger aria-label="声音克隆模型规格" className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="1.7B">1.7B</SelectItem><SelectItem value="0.6B">0.6B</SelectItem></SelectContent>
                </Select>
              </>
            )}
            <Button
              onClick={() => {
                setSubmitted(false);
                gen.mutate();
              }}
              disabled={!canEdit || !text.trim() || !qwenReady}
              loading={gen.isPending}
              loadingText="提交中"
              className="creation-primary-action ml-auto shrink-0 px-5"
            >
              <Mic /> 生成配音
            </Button>
          </div>
          {gen.isError && <StatusMessage tone="danger" appearance="strip">{gen.error.message}</StatusMessage>}
          {ttsReadyHint && <p className="composer-ready-hint border-t border-border/55 px-4 py-2.5">{ttsReadyHint}</p>}
          {submitted && <StatusMessage tone="success" appearance="strip">任务已提交，可在左侧记录中查看进度。</StatusMessage>}
      </CreatorComposer>

    </CreationWorkspace>
  );
}
