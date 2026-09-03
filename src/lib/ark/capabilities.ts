/**
 * 模型能力注册表 —— 依据《火山方舟 API 参考》整理。
 * 图像：各 Seedream 模型支持的分辨率档位、画幅比例与推荐像素值。
 * 视频：各 Seedance 模型支持的分辨率、比例、时长、帧数与特性
 * （首尾帧 / 全能参考 / 有声视频等）。
 * 纯数据模块，前后端共用。
 */

// ============================ 图像 ============================

export const IMAGE_RATIOS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
  "21:9",
] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

export type ImageTier = "1K" | "2K" | "3K" | "4K";

/** 文档推荐的「分辨率档位 × 画幅比例 → 宽高像素」对照表 */
const IMAGE_PX: Record<ImageTier, Record<ImageRatio, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "4:3": "1152x864",
    "3:4": "864x1152",
    "16:9": "1280x720",
    "9:16": "720x1280",
    "3:2": "1248x832",
    "2:3": "832x1248",
    "21:9": "1512x648",
  },
  "2K": {
    "1:1": "2048x2048",
    "4:3": "2304x1728",
    "3:4": "1728x2304",
    "16:9": "2848x1600",
    "9:16": "1600x2848",
    "3:2": "2496x1664",
    "2:3": "1664x2496",
    "21:9": "3136x1344",
  },
  "3K": {
    "1:1": "3072x3072",
    "4:3": "3456x2592",
    "3:4": "2592x3456",
    "16:9": "4096x2304",
    "9:16": "2304x4096",
    "3:2": "3744x2496",
    "2:3": "2496x3744",
    "21:9": "4704x2016",
  },
  "4K": {
    "1:1": "4096x4096",
    "4:3": "4704x3520",
    "3:4": "3520x4704",
    "16:9": "5504x3040",
    "9:16": "3040x5504",
    "3:2": "4992x3328",
    "2:3": "3328x4992",
    "21:9": "6240x2656",
  },
};

/** Seedream 4.0 的官方 1K 推荐像素与通用表不同（16:9/9:16/21:9 有差异）。 */
const SEEDREAM_4_0_PX: Record<"1K", Record<ImageRatio, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "4:3": "1152x864",
    "3:4": "864x1152",
    "16:9": "1312x736",
    "9:16": "736x1312",
    "3:2": "1248x832",
    "2:3": "832x1248",
    "21:9": "1568x672",
  },
};

/** Seedream 5.0 Pro 的官方推荐像素与 Lite 不同。 */
const SEEDREAM_5_PRO_PX: Record<"1K" | "2K", Record<ImageRatio, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "4:3": "1152x864",
    "3:4": "864x1152",
    "16:9": "1424x800",
    "9:16": "800x1424",
    "3:2": "1248x832",
    "2:3": "832x1248",
    "21:9": "1568x672",
  },
  "2K": {
    "1:1": "2048x2048",
    "4:3": "2368x1776",
    "3:4": "1776x2368",
    "16:9": "2816x1584",
    "9:16": "1584x2816",
    "3:2": "2496x1664",
    "2:3": "1664x2496",
    "21:9": "3136x1344",
  },
};

export const ALL_IMAGE_TIERS: ImageTier[] = ["1K", "2K", "3K", "4K"];

export interface ImageCapability {
  /** 该模型支持的分辨率档位 */
  tiers: ImageTier[];
  defaultTier: ImageTier;
  /** 最多参考图数量（图生图） */
  maxRefImages: number;
  /** 方舟图片接口是否支持 SSE 流式响应 */
  supportsStream: boolean;
  /** 是否支持组图（sequential_image_generation） */
  supportsSequential: boolean;
  /** 组图 + 参考图数量之和上限（官方：输入参考图数 + 生成数 ≤ 15） */
  maxImagesPerGen: number;
  /** 是否支持 fast 提示词优化模式 */
  supportsFast: boolean;
  /** 是否支持自定义输出格式 png/jpeg（否则固定 jpeg） */
  supportsOutputFormat: boolean;
  /** 是否支持联网搜索工具 */
  supportsWebSearch: boolean;
  /** 是否支持交互编辑（坐标/框选，仅 Pro） */
  supportsInteractiveEdit: boolean;
}

export const IMAGE_CAPS: Record<string, ImageCapability> = {
  "seedream-4.0": {
    tiers: ["1K", "2K", "4K"], defaultTier: "2K", maxRefImages: 14, supportsStream: true,
    supportsSequential: true, maxImagesPerGen: 15, supportsFast: true,
    supportsOutputFormat: false, supportsWebSearch: false, supportsInteractiveEdit: false,
  },
  "seedream-4.5": {
    tiers: ["2K", "4K"], defaultTier: "2K", maxRefImages: 14, supportsStream: true,
    supportsSequential: true, maxImagesPerGen: 15, supportsFast: false,
    supportsOutputFormat: false, supportsWebSearch: false, supportsInteractiveEdit: false,
  },
  "seedream-5.0": {
    tiers: ["2K", "3K", "4K"], defaultTier: "2K", maxRefImages: 14, supportsStream: true,
    supportsSequential: true, maxImagesPerGen: 15, supportsFast: false,
    supportsOutputFormat: true, supportsWebSearch: true, supportsInteractiveEdit: false,
  },
  "seedream-5.0-pro": {
    tiers: ["1K", "2K"], defaultTier: "2K", maxRefImages: 10, supportsStream: false,
    supportsSequential: false, maxImagesPerGen: 1, supportsFast: true,
    supportsOutputFormat: true, supportsWebSearch: false, supportsInteractiveEdit: true,
  },
};

export function imageCap(modelKey: string): ImageCapability {
  return IMAGE_CAPS[modelKey] ?? {
    tiers: ["2K"], defaultTier: "2K", maxRefImages: 5, supportsStream: false,
    supportsSequential: false, maxImagesPerGen: 1, supportsFast: false,
    supportsOutputFormat: false, supportsWebSearch: false, supportsInteractiveEdit: false,
  };
}

/** 档位 + 比例 → 推荐宽高像素值（直接作为 size 传给方舟） */
export function imagePx(tier: ImageTier, ratio: ImageRatio, modelKey?: string): string {
  if (modelKey === "seedream-5.0-pro" && (tier === "1K" || tier === "2K")) {
    return SEEDREAM_5_PRO_PX[tier][ratio];
  }
  if (modelKey === "seedream-4.0" && tier === "1K") {
    return SEEDREAM_4_0_PX[tier][ratio];
  }
  return IMAGE_PX[tier][ratio];
}

/** "2848x1600" → "2848×1600" 展示用 */
export function formatPx(px?: string | null): string {
  if (!px) return "";
  return px.replace("x", "×");
}

/** 校验 size 是否为该模型支持的推荐像素值或档位 */
export function isImageSizeSupported(
  modelKey: string,
  size: string,
  capability: ImageCapability = imageCap(modelKey)
): boolean {
  const cap = capability;
  const upper = size.trim().toUpperCase();
  if (cap.tiers.includes(upper as ImageTier)) return true;
  return cap.tiers.some((t) =>
    IMAGE_RATIOS.some((ratio) => imagePx(t, ratio, modelKey) === size.trim().toLowerCase())
  );
}

// ============================ 视频 ============================

export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p", "4k"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export type VideoServiceTier = "default" | "flex";

export const VIDEO_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const;
export type VideoRatio = (typeof VIDEO_RATIOS)[number];

/** Seedance 1.5 / 2.0 系列「分辨率 × 比例 → 宽高像素」对照表 */
const VIDEO_PX: Record<VideoResolution, Record<VideoRatio, string>> = {
  "480p": {
    "16:9": "864x496",
    "4:3": "752x560",
    "1:1": "640x640",
    "3:4": "560x752",
    "9:16": "496x864",
    "21:9": "992x432",
  },
  "720p": {
    "16:9": "1280x720",
    "4:3": "1112x834",
    "1:1": "960x960",
    "3:4": "834x1112",
    "9:16": "720x1280",
    "21:9": "1470x630",
  },
  "1080p": {
    "16:9": "1920x1080",
    "4:3": "1664x1248",
    "1:1": "1440x1440",
    "3:4": "1248x1664",
    "9:16": "1080x1920",
    "21:9": "2206x946",
  },
  "4k": {
    "16:9": "3840x2160",
    "4:3": "3328x2496",
    "1:1": "2880x2880",
    "3:4": "2496x3328",
    "9:16": "2160x3840",
    "21:9": "4412x1892",
  },
};

/** Seedance 1.0 系列的官方像素尺寸与 1.5/2.0 不同。 */
const VIDEO_PX_1_0: Record<VideoResolution, Record<VideoRatio, string>> = {
  "480p": {
    "16:9": "864x480",
    "4:3": "736x544",
    "1:1": "640x640",
    "3:4": "544x736",
    "9:16": "480x864",
    "21:9": "960x416",
  },
  "720p": {
    "16:9": "1248x704",
    "4:3": "1120x832",
    "1:1": "960x960",
    "3:4": "832x1120",
    "9:16": "704x1248",
    "21:9": "1504x640",
  },
  "1080p": {
    "16:9": "1920x1088",
    "4:3": "1664x1248",
    "1:1": "1440x1440",
    "3:4": "1248x1664",
    "9:16": "1088x1920",
    "21:9": "2176x928",
  },
  // 1.0 系列不支持 4K；该键仅用于保持完整的查表结构。
  "4k": {
    "16:9": "3840x2160",
    "4:3": "3328x2496",
    "1:1": "2880x2880",
    "3:4": "2496x3328",
    "9:16": "2160x3840",
    "21:9": "4412x1892",
  },
};

export function videoPx(
  resolution: VideoResolution,
  ratio: string,
  modelKey?: string
): string | null {
  if (!(VIDEO_RATIOS as readonly string[]).includes(ratio)) return null;
  if (modelKey?.startsWith("seedance-1.0-") && resolution === "4k") return null;
  const table = modelKey?.startsWith("seedance-1.0-") ? VIDEO_PX_1_0 : VIDEO_PX;
  return table[resolution][ratio as VideoRatio];
}

/** 视频生成模式 */
export type VideoMode = "t2v" | "first_frame" | "first_last" | "reference" | "extend";
export type VideoLengthMode = "duration" | "frames";

/** 火山方舟 frames 参数的官方约束（固定 24fps）。 */
export const VIDEO_FRAMES = {
  min: 29,
  max: 289,
  step: 4,
  fps: 24,
} as const;

export interface VideoFrameCapability {
  min: number;
  max: number;
  step: number;
  fps: number;
}

export function isValidVideoFrames(
  value: number,
  limits: VideoFrameCapability = VIDEO_FRAMES
): boolean {
  return (
    Number.isInteger(value) &&
    value >= limits.min &&
    value <= limits.max &&
    (value - limits.min) % limits.step === 0
  );
}

export function videoDurationFromFrames(
  frames: number,
  fps: number = VIDEO_FRAMES.fps
): number {
  return frames / fps;
}

export interface VideoCapability {
  resolutions: VideoResolution[];
  defaultResolution: VideoResolution;
  /** 是否支持 adaptive 自适应比例 */
  adaptiveRatio: boolean;
  /** 时长范围（秒，整数） */
  duration: { min: number; max: number };
  /** 是否支持 duration=-1 智能时长 */
  smartDuration: boolean;
  /** 支持的生成模式 */
  modes: VideoMode[];
  /** 全能参考最多参考图数量（0 = 不支持） */
  maxRefImages: number;
  /** 全能参考最多参考视频段数 */
  maxRefVideos: number;
  /** 全能参考最多参考音频段数 */
  maxRefAudios: number;
  /** 是否支持生成同步音频（generate_audio） */
  generateAudio: boolean;
  /** 是否支持固定摄像头 */
  cameraFixed: boolean;
  /** 是否支持返回无水印尾帧 */
  returnLastFrame: boolean;
  /** 是否支持联网搜索工具 */
  webSearch: boolean;
  /** 是否支持 0-9 的队列优先级 */
  priority: boolean;
  /** 是否支持固定随机种子 */
  seed: boolean;
  /** 是否支持低成本 Draft 样片 */
  draft: boolean;
  /** 可用服务等级；flex 更便宜但排队时间更长 */
  serviceTiers: VideoServiceTier[];
  /** 是否支持按精确帧数生成（当前仅 Seedance 1.0 系列） */
  frames?: VideoFrameCapability;
}

export const VIDEO_CAPS: Record<string, VideoCapability> = {
  "seedance-1.0-pro": {
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    adaptiveRatio: false,
    duration: { min: 2, max: 12 },
    smartDuration: false,
    modes: ["t2v", "first_frame", "first_last"],
    maxRefImages: 0,
    maxRefVideos: 0,
    maxRefAudios: 0,
    generateAudio: false,
    cameraFixed: true,
    returnLastFrame: false,
    webSearch: false,
    priority: false,
    seed: true,
    draft: false,
    serviceTiers: ["default", "flex"],
    frames: VIDEO_FRAMES,
  },
  "seedance-1.0-pro-fast": {
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    adaptiveRatio: false,
    duration: { min: 2, max: 12 },
    smartDuration: false,
    modes: ["t2v", "first_frame"],
    maxRefImages: 0,
    maxRefVideos: 0,
    maxRefAudios: 0,
    generateAudio: false,
    cameraFixed: true,
    returnLastFrame: false,
    webSearch: false,
    priority: false,
    seed: true,
    draft: false,
    serviceTiers: ["default", "flex"],
    frames: VIDEO_FRAMES,
  },
  "seedance-1.5-pro": {
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    adaptiveRatio: true,
    duration: { min: 4, max: 12 },
    smartDuration: true,
    modes: ["t2v", "first_frame", "first_last"],
    maxRefImages: 0,
    maxRefVideos: 0,
    maxRefAudios: 0,
    generateAudio: true,
    cameraFixed: true,
    returnLastFrame: false,
    webSearch: false,
    priority: false,
    seed: true,
    draft: true,
    serviceTiers: ["default", "flex"],
  },
  "seedance-2.0": {
    resolutions: ["480p", "720p", "1080p", "4k"],
    defaultResolution: "720p",
    adaptiveRatio: true,
    duration: { min: 4, max: 15 },
    smartDuration: true,
    modes: ["t2v", "first_frame", "first_last", "reference", "extend"],
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    generateAudio: true,
    cameraFixed: false,
    returnLastFrame: true,
    webSearch: true,
    priority: true,
    seed: false,
    draft: false,
    serviceTiers: ["default"],
  },
  "seedance-2.0-fast": {
    resolutions: ["480p", "720p"],
    defaultResolution: "720p",
    adaptiveRatio: true,
    duration: { min: 4, max: 15 },
    smartDuration: true,
    modes: ["t2v", "first_frame", "first_last", "reference", "extend"],
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    generateAudio: true,
    cameraFixed: false,
    returnLastFrame: true,
    webSearch: true,
    priority: true,
    seed: false,
    draft: false,
    serviceTiers: ["default"],
  },
};

/** 全能参考素材（视频/音频）单段最长秒数（官方限制） */
export const REF_MEDIA_MAX_SECONDS = 15;

export function videoCap(modelKey: string): VideoCapability {
  return (
    VIDEO_CAPS[modelKey] ?? {
      resolutions: ["480p", "720p"],
      defaultResolution: "720p",
      adaptiveRatio: false,
      duration: { min: 4, max: 12 },
      smartDuration: false,
      modes: ["t2v", "first_frame"],
      maxRefImages: 0,
      maxRefVideos: 0,
      maxRefAudios: 0,
      generateAudio: false,
      cameraFixed: false,
      returnLastFrame: false,
      webSearch: false,
      priority: false,
      seed: false,
      draft: false,
      serviceTiers: ["default"],
    }
  );
}

export const VIDEO_MODE_LABEL: Record<VideoMode, string> = {
  t2v: "文生视频",
  first_frame: "首帧",
  first_last: "首尾帧",
  reference: "全能参考",
  extend: "视频延长",
};
