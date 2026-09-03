import type { TaskDto } from "@/lib/client/types";
import { modelDisplayName } from "@/lib/ark/models";
import {
  buildTaskBilling,
  type CostEstimate,
  type TaskBilling,
} from "@/lib/pricing";
import {
  TASK_PROVIDER_LABEL,
  taskProvider,
  type TaskProvider,
} from "./task-metrics";

type JsonRecord = Record<string, unknown>;

const MODEL_LABEL: Record<string, string> = {
  "coze-music": "音乐生成",
  "coze-tts": "语音合成",
  "coze-audio-transcription": "语音转写",
  "modelscope-qwen3-tts": "Qwen3-TTS 声音克隆",
  "coze-edit": "视频剪辑工具",
};

const TOOL_LABEL: Record<string, string> = {
  web_search: "联网搜索",
  gen_bgm: "背景音乐生成",
  gen_song: "灵感生曲",
  lyrics_gen_song: "歌词成曲",
  speech_synthesis: "语音合成",
  audio_to_subtitle: "语音转写",
  voice_clone: "声音克隆",
  video_trim: "视频裁剪",
  concat_videos: "视频拼接",
  compile_video_audio: "音视频合成",
  compile_image_audio: "图片+音频成片",
  audio_extract: "提取音频",
  video_speed: "视频变速",
  ajust_audio_volume: "音量调整",
  audio_denoise: "音频降噪",
  audio_mix: "音频混音",
  video_super_resolution: "视频超分",
  insert_frame: "视频插帧",
};

export interface TaskToolDetail {
  id: string;
  label: string;
}

export interface TaskDetailSnapshot {
  input: JsonRecord;
  usage: JsonRecord;
  assetParams: JsonRecord;
  prompt: string;
  provider: TaskProvider;
  providerLabel: string;
  modelLabel: string;
  cost: CostEstimate;
  billing: TaskBilling;
  tokens: number | null;
  totalTokens: number | null;
  webSearchCalls: number | null;
  seed: number | null;
  randomSeedRequested: boolean;
  frames: number | null;
  framesPerSecond: number | null;
  resolution: string | null;
  durationSeconds: number | null;
  outputCount: number | null;
  serviceTier: string | null;
  priority: number | null;
  tools: TaskToolDetail[];
  attemptCount: number;
}

function parseRecord(value: string | null | undefined): JsonRecord {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

function nestedRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return null;
}

function derivedTool(task: TaskDto, input: JsonRecord): string | null {
  if (task.modelKey === "coze-music") {
    if (input.mode === "bgm") return "gen_bgm";
    if (input.mode === "lyrics_song") return "lyrics_gen_song";
    return "gen_song";
  }
  if (task.modelKey === "coze-tts") return "speech_synthesis";
  if (task.modelKey === "coze-audio-transcription") return "audio_to_subtitle";
  if (task.modelKey === "modelscope-qwen3-tts") return "voice_clone";
  if (task.modelKey === "coze-edit") return firstText(input.tool);
  return null;
}

function taskTools(task: TaskDto, input: JsonRecord, usage: JsonRecord): TaskToolDetail[] {
  const ids = new Set<string>();
  if (Array.isArray(usage.tools)) {
    usage.tools.forEach((tool) => {
      if (typeof tool === "string" && tool.trim()) ids.add(tool.trim());
    });
  }
  const webSearchCalls = firstNumber(usage.webSearchCalls);
  if (input.webSearch === true || (webSearchCalls !== null && webSearchCalls > 0)) {
    ids.add("web_search");
  }
  const derived = derivedTool(task, input);
  if (derived) ids.add(derived);
  return [...ids].map((id) => ({ id, label: TOOL_LABEL[id] ?? id }));
}

export function buildTaskDetailSnapshot(task: TaskDto): TaskDetailSnapshot {
  const input = parseRecord(task.inputJson);
  const usage = parseRecord(task.usageJson);
  const assetMeta = parseRecord(task.outputAsset?.metaJson);
  const assetParams = nestedRecord(assetMeta.params);
  const provider = taskProvider(task.modelKey);
  const inputSeed = firstNumber(input.seed);
  const billing = buildTaskBilling(task, task.outputAsset?.metaJson);
  const toolUsage = nestedRecord(usage.tool_usage);

  return {
    input,
    usage,
    assetParams,
    prompt: firstText(input.prompt, input.text) ?? "",
    provider,
    providerLabel: TASK_PROVIDER_LABEL[provider],
    modelLabel: MODEL_LABEL[task.modelKey] ?? modelDisplayName(task.modelKey),
    cost: billing.model,
    billing,
    tokens: firstNumber(usage.tokens, usage.completionTokens, usage.outputTokens),
    totalTokens: firstNumber(usage.totalTokens),
    webSearchCalls: firstNumber(usage.webSearchCalls, toolUsage.web_search),
    seed: firstNumber(usage.seed, assetParams.actualSeed, assetParams.seed),
    randomSeedRequested: inputSeed === -1,
    frames: firstNumber(
      usage.frames,
      assetParams.actualFrames,
      assetParams.frames,
      input.frames
    ),
    framesPerSecond: firstNumber(
      usage.framesPerSecond,
      assetParams.framesPerSecond,
      assetParams.actualFramesPerSecond,
      assetParams.fps
    ),
    resolution: firstText(
      assetParams.actualResolution,
      assetParams.actualSize,
      assetParams.resolution,
      assetParams.size,
      input.resolution,
      input.size
    ),
    durationSeconds: firstNumber(
      assetParams.actualDuration,
      assetParams.duration,
      usage.durationSeconds,
      input.duration
    ),
    outputCount: firstNumber(usage.images, assetParams.imageCount, input.count),
    serviceTier:
      firstText(
        usage.serviceTier,
        assetParams.actualServiceTier,
        input.serviceTier
      ) ?? (task.kind === "video" ? "default" : null),
    priority: firstNumber(usage.priority, assetParams.priority, input.priority),
    tools: taskTools(task, input, usage),
    attemptCount:
      task.attemptCount ?? (task.status === "queued" ? 0 : 1),
  };
}
