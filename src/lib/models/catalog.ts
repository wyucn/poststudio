import {
  IMAGE_CAPS,
  VIDEO_CAPS,
  type ImageCapability,
  type VideoCapability,
} from "@/lib/ark/capabilities";
import { ARK_MODELS } from "@/lib/ark/models";
import { COZE_PLUGIN_IDS } from "@/lib/coze/config";
import type {
  ManagedModelCapabilities,
  ManagedModelKind,
  ManagedModelProvider,
} from "./contracts";

export const QWEN_PUBLIC_CONFIG_KEY = "modelscope-qwen3-tts:public";
export const QWEN_SELF_HOSTED_CONFIG_KEY =
  "modelscope-qwen3-tts:self-hosted";

export interface ManagedModelDefinition {
  key: string;
  modelKey: string;
  instanceKey: string | null;
  provider: ManagedModelProvider;
  kind: ManagedModelKind;
  label: string;
  description: string;
  modelName: string;
  default: boolean;
  endpointDefault: string | null;
  credentialEnv: string | null;
  capabilityEditable: boolean;
  capabilities: ManagedModelCapabilities;
}

const ARK_DEFINITIONS: ManagedModelDefinition[] = ARK_MODELS.map((model) => ({
  key: model.key,
  modelKey: model.key,
  instanceKey: null,
  provider: "ark",
  kind: model.kind as "image" | "video",
  label: model.label,
  description: model.description,
  modelName: model.modelName,
  default: !!model.default,
  endpointDefault: model.endpointId,
  credentialEnv: model.apiKeyEnv ?? "ARK_API_KEY",
  capabilityEditable: true,
  capabilities:
    model.kind === "image"
      ? (IMAGE_CAPS[model.key] as ImageCapability)
      : (VIDEO_CAPS[model.key] as VideoCapability),
}));

const SERVICE_DEFINITIONS: ManagedModelDefinition[] = [
  {
    key: "coze-music",
    modelKey: "coze-music",
    instanceKey: null,
    provider: "coze",
    kind: "music",
    label: "Doubao 音乐生成",
    description: "灵感生曲、歌词成曲与纯音乐 BGM",
    modelName: "Doubao 音乐生成",
    default: true,
    endpointDefault: COZE_PLUGIN_IDS.music,
    credentialEnv: "COZE_API_TOKEN",
    capabilityEditable: false,
    capabilities: {
      modes: ["song", "lyrics_song", "bgm"],
      songDurationSeconds: { min: 30, max: 240 },
      bgmDurationSeconds: { min: 30, max: 120 },
    },
  },
  {
    key: "coze-tts",
    modelKey: "coze-tts",
    instanceKey: null,
    provider: "coze",
    kind: "audio",
    label: "豆包预设音色",
    description: "Coze 语音合成插件与系统音色",
    modelName: "豆包语音合成",
    default: true,
    endpointDefault: COZE_PLUGIN_IDS.tts,
    credentialEnv: "COZE_API_TOKEN",
    capabilityEditable: false,
    capabilities: { maxTextBytes: 1024, supportsEmotion: true },
  },
  {
    key: "coze-edit",
    modelKey: "coze-edit",
    instanceKey: null,
    provider: "coze",
    kind: "edit",
    label: "Coze 视频剪辑",
    description: "裁剪、拼接、混音、字幕与超分工具",
    modelName: "Coze 视频剪辑工具",
    default: true,
    endpointDefault: COZE_PLUGIN_IDS.videoEdit,
    credentialEnv: "COZE_API_TOKEN",
    capabilityEditable: false,
    capabilities: { tools: "registered" },
  },
  {
    key: "coze-audio-transcription",
    modelKey: "coze-audio-transcription",
    instanceKey: null,
    provider: "coze",
    kind: "text",
    label: "参考音频语音转写",
    description: "Coze audio_to_subtitle 转写与字幕输出",
    modelName: "Coze 音频转写",
    default: true,
    endpointDefault: COZE_PLUGIN_IDS.videoEdit,
    credentialEnv: "COZE_API_TOKEN",
    capabilityEditable: false,
    capabilities: { output: "srt", maxTextLength: 2048 },
  },
  {
    key: QWEN_PUBLIC_CONFIG_KEY,
    modelKey: "modelscope-qwen3-tts",
    instanceKey: "public",
    provider: "modelscope",
    kind: "audio",
    label: "Qwen3-TTS 公共创空间",
    description: "实验性共享 GPU 实例，忙时可能排队",
    modelName: "Qwen3-TTS 声音克隆",
    default: true,
    endpointDefault: null,
    credentialEnv: "MODELSCOPE_ACCESS_TOKEN",
    capabilityEditable: false,
    capabilities: {
      modelSizes: ["0.6B", "1.7B"],
      maxTextBytes: 1024,
      maxReferenceBytes: 20 * 1024 * 1024,
    },
  },
  {
    key: QWEN_SELF_HOSTED_CONFIG_KEY,
    modelKey: "modelscope-qwen3-tts",
    instanceKey: "self-hosted",
    provider: "modelscope",
    kind: "audio",
    label: "Qwen3-TTS 自建实例",
    description: "管理员维护的专用实例，适合正式和批量任务",
    modelName: "Qwen3-TTS 声音克隆",
    default: false,
    endpointDefault: null,
    credentialEnv: null,
    capabilityEditable: false,
    capabilities: {
      modelSizes: ["0.6B", "1.7B"],
      maxTextBytes: 1024,
      maxReferenceBytes: 20 * 1024 * 1024,
    },
  },
];

export const MANAGED_MODEL_DEFINITIONS: ManagedModelDefinition[] = [
  ...ARK_DEFINITIONS,
  ...SERVICE_DEFINITIONS,
];

export function managedModelDefinition(
  key: string
): ManagedModelDefinition | undefined {
  return MANAGED_MODEL_DEFINITIONS.find((entry) => entry.key === key);
}
