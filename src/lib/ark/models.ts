export type ModelKind = "text" | "image" | "video";

export interface ArkModel {
  /** 业务内使用的短 key */
  key: string;
  kind: ModelKind;
  /** 模型完整名（仅展示用） */
  modelName: string;
  /** 方舟推理接入点，调用时作为 model 参数 */
  endpointId: string;
  /** 使用独立 API Key 时对应的服务端环境变量名；缺省使用 ARK_API_KEY */
  apiKeyEnv?: string;
  label: string;
  description: string;
  default?: boolean;
}

export const ARK_MODELS: ArkModel[] = [
  // ---- 图像 ----
  {
    key: "seedream-4.0",
    kind: "image",
    modelName: "doubao-seedream-4-0-250115",
    endpointId: process.env.ARK_SEEDREAM_40_ENDPOINT_ID ?? "",
    label: "Seedream 4.0",
    description: "上一代，速度快",
  },
  {
    key: "seedream-4.5",
    kind: "image",
    modelName: "doubao-seedream-4-5-251128",
    endpointId: process.env.ARK_SEEDREAM_45_ENDPOINT_ID ?? "",
    label: "Seedream 4.5",
    description: "质量与速度平衡",
  },
  {
    key: "seedream-5.0",
    kind: "image",
    modelName: "doubao-seedream-5-0-250528",
    endpointId: process.env.ARK_SEEDREAM_50_LITE_ENDPOINT_ID ?? "",
    label: "Seedream 5.0 Lite",
    description: "当前接入的 Lite 版本；默认图像模型",
    default: true,
  },
  {
    key: "seedream-5.0-pro",
    kind: "image",
    modelName: "doubao-seedream-5-0-pro",
    endpointId: process.env.ARK_SEEDREAM_50_PRO_ENDPOINT_ID ?? "",
    apiKeyEnv: "ARK_SEEDREAM5_PRO_API_KEY",
    label: "Seedream 5.0 Pro",
    description: "高质量单图；1K/2K，最多 10 张参考图",
  },
  // ---- 视频 ----
  // 方舟官方 API 允许直接使用模型 ID 作为 model 参数；这两个旧版模型
  // 是当前支持 frames（精确帧数 / 小数秒视频）的 Seedance 型号。
  {
    key: "seedance-1.0-pro",
    kind: "video",
    modelName: "doubao-seedance-1-0-pro-250528",
    endpointId: "doubao-seedance-1-0-pro-250528",
    label: "Seedance 1.0 Pro",
    description: "精确帧数；支持 2–12 秒与小数秒视频",
  },
  {
    key: "seedance-1.0-pro-fast",
    kind: "video",
    modelName: "doubao-seedance-1-0-pro-fast-251015",
    endpointId: "doubao-seedance-1-0-pro-fast-251015",
    label: "Seedance 1.0 Pro Fast",
    description: "快速出片；支持精确帧数与小数秒视频",
  },
  {
    key: "seedance-1.5-pro",
    kind: "video",
    modelName: "doubao-seedance-1-5-pro-251215",
    endpointId: process.env.ARK_SEEDANCE_15_PRO_ENDPOINT_ID ?? "",
    label: "Seedance 1.5 Pro",
    description: "上一代备用",
  },
  {
    key: "seedance-2.0",
    kind: "video",
    modelName: "doubao-seedance-2-0-260128",
    endpointId: process.env.ARK_SEEDANCE_20_ENDPOINT_ID ?? "",
    label: "Seedance 2.0",
    description: "正式出片首选；最高 4K 10-bit",
    default: true,
  },
  {
    key: "seedance-2.0-fast",
    kind: "video",
    modelName: "doubao-seedance-2-0-fast-260128",
    endpointId: process.env.ARK_SEEDANCE_20_FAST_ENDPOINT_ID ?? "",
    label: "Seedance 2.0 Fast",
    description: "草稿预览，省时省钱",
  },
];

export function getModel(key: string): ArkModel {
  const m = ARK_MODELS.find((m) => m.key === key);
  if (!m) throw new Error(`未知模型 key: ${key}`);
  return m;
}

export function defaultModel(kind: ModelKind): ArkModel {
  return ARK_MODELS.find((m) => m.kind === kind && m.default) ?? ARK_MODELS.filter((m) => m.kind === kind)[0];
}

export function modelsByKind(kind: ModelKind): ArkModel[] {
  return ARK_MODELS.filter((m) => m.kind === kind);
}

/** 用户可见的模型名称；任务和历史记录仍使用稳定的内部 key。 */
export function modelDisplayName(key: string): string {
  return ARK_MODELS.find((m) => m.key === key)?.label ?? key;
}
