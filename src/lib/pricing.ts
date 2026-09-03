/**
 * 模型用量成本估算（任务级参考，非供应商最终账单）。
 *
 * 单价来源：火山方舟官方模型价格/计费说明（公开价，未含商务折扣、代金券和
 * 账户级免费额度）。价格会变化，更新价格时应同时更新执行记录和测试样例。
 *
 * 相关官方页面：
 * - https://docs.volcengine.com/docs/82379/1544106 （模型价格）
 * - https://docs.volcengine.com/docs/82379/1544681 （模型服务计费说明）
 * - https://docs.volcengine.com/docs/82379/1338550 （联网内容插件产品计费）
 */

/** 单次成本估算结果 */
export interface CostEstimate {
  /** 金额（元）；null 表示不估（如 Coze 插件） */
  yuan: number | null;
  /** 精度：actual 真实用量 / exact 图像按张 / approx 视频查表 / rough 文本粗估 / none 不估 */
  accuracy: "actual" | "exact" | "approx" | "rough" | "none";
}
/** 方舟联网内容插件公网资源的公开价；前 2 万次/月免费，账户实际抵扣未知。 */
export const WEB_SEARCH_PRICE_PER_CALL = 4 / 1000;
export const WEB_SEARCH_FREE_MONTHLY_CALLS = 20_000;

export interface BillingServiceTier {
  requested: string | null;
  label: string;
  /** flex 对支持该服务等级的模型约为在线公开价的 50%。 */
  priceMultiplier: number | null;
  note: string;
}

export interface BillingSearch {
  calls: number | null;
  listYuan: number | null;
  pricePerThousand: number;
  freeMonthlyCalls: number;
  note: string;
}

export interface BillingMinimumToken {
  applies: boolean;
  note: string;
}

/** 任务详情抽屉使用的成本拆分；不把“公开标价”伪装成账户最终账单。 */
export interface TaskBilling {
  model: CostEstimate;
  modelBasis: string;
  tokenRateYuanPerMillion: number | null;
  serviceTier: BillingServiceTier;
  webSearch: BillingSearch;
  minimumToken: BillingMinimumToken;
  /** 含联网搜索公开标价的参考合计；月度免费额度未知时仍只是参考值。 */
  total: CostEstimate;
}

/**
 * 视频 token 单价（元/百万 token），官方文档。按输出分辨率 + 是否含输入视频区分。
 * 用于有真实 completion_tokens 时精确核算。
 */
const VIDEO_TOKEN_PRICE: Record<string, { noInput: Partial<Record<string, number>>; withInput: Partial<Record<string, number>> }> = {
  "seedance-2.0": {
    noInput: { "480p": 46, "720p": 46, "1080p": 51, "4k": 26 },
    withInput: { "480p": 28, "720p": 28, "1080p": 31, "4k": 16 },
  },
  "seedance-2.0-fast": {
    noInput: { "480p": 37, "720p": 37 },
    withInput: { "480p": 22, "720p": 22 },
  },
  "seedance-1.5-pro": {
    noInput: { "480p": 8, "720p": 8, "1080p": 8 }, // 无声档；有声档在 videoTokenPrice 中单独处理
    withInput: { "480p": 8, "720p": 8, "1080p": 8 },
  },
  "seedance-1.0-pro": {
    noInput: { "480p": 15, "720p": 15, "1080p": 15 },
    withInput: { "480p": 15, "720p": 15, "1080p": 15 },
  },
  "seedance-1.0-pro-fast": {
    noInput: { "480p": 4.2, "720p": 4.2, "1080p": 4.2 },
    withInput: { "480p": 4.2, "720p": 4.2, "1080p": 4.2 },
  },
};
/** 图像模型单价（元/张）。5.0-pro 按输出像素分档。 */
const IMAGE_PRICE: Record<string, number> = {
  "seedream-4.0": 0.2,
  "seedream-4.5": 0.25,
  "seedream-5.0": 0.22, // Lite
};
const SEEDREAM5_PRO_LOW = 0.3; // ≤ 261 万像素（1.5K及以下）
const SEEDREAM5_PRO_HIGH = 0.6; // > 261 万像素
const SEEDREAM5_PRO_PX_THRESHOLD = 2_610_000;
const SEEDREAM5_PRO_INPUT_IMAGE_PRICE = 0.02; // 首张参考图免费，第 2 张起

/**
 * 视频模型单价（元/秒），取自官方「价格示例」表（输入不含视频、无声档，保守）。
 * 键：模型 key → 分辨率 → 元/秒。缺失分辨率表示该模型不支持。
 */
const VIDEO_PRICE_PER_SEC: Record<string, Partial<Record<string, number>>> = {
  "seedance-2.0": { "480p": 0.46, "720p": 0.99, "1080p": 2.48, "4k": 5.05 },
  "seedance-2.0-fast": { "480p": 0.37, "720p": 0.8 },
  "seedance-1.5-pro": { "480p": 0.08, "720p": 0.17, "1080p": 0.39 },
  // 1.0 系列按官方 16:9 像素尺寸 × 24fps × token 单价换算。
  "seedance-1.0-pro": { "480p": 0.1458, "720p": 0.30888, "1080p": 0.7344 },
  "seedance-1.0-pro-fast": { "480p": 0.040824, "720p": 0.0864864, "1080p": 0.205632 },
};
/** 视频延长（输入含视频）成本更高，官方含输入视频档约为不含的 1.1~2.4 倍，取保守中值。 */
const VIDEO_EXTEND_MULTIPLIER = 1.3;

interface TaskLike {
  kind: string;
  modelKey: string;
  inputJson: string;
  usageJson?: string | null;
}
interface UsageSnapshot {
  tokens?: number;
  completionTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  images?: number;
  generatedImages?: number;
  inputImages?: number;
  webSearchCalls?: number;
  tool_usage?: { web_search?: number };
  tools?: unknown[];
  serviceTier?: string;
  generateAudio?: boolean;
  source?: string;
}
interface AssetMetaParams {
  actualResolution?: string;
  actualDuration?: number;
  size?: string;
  resolution?: string;
  duration?: number;
  actualFrames?: number;
  frames?: number;
  framesPerSecond?: number;
  actualFramesPerSecond?: number;
  imageCount?: number;
  actualServiceTier?: string;
  generateAudio?: boolean;
}

function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function roundMoney(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** "2048x2048" → 像素数；解析失败返回 0 */
function pixelsOf(size?: string): number {
  if (!size) return 0;
  const m = size.match(/(\d+)\s*[x×]\s*(\d+)/);
  return m ? Number(m[1]) * Number(m[2]) : 0;
}

function requestedInputImageCount(input: Record<string, unknown>): number {
  return Array.isArray(input.refAssetIds) ? input.refAssetIds.length : 0;
}

function hasInputVideo(input: Record<string, unknown>): boolean {
  if (input.operation === "extend") return true;
  const kinds = [input.referenceKinds, input.refMediaKinds, input.referenceMediaKinds];
  return kinds.some(
    (value) => Array.isArray(value) && value.some((kind) => String(kind) === "video")
  );
}

function serviceTierFrom(
  input: Record<string, unknown>,
  usage: UsageSnapshot,
  assetParams: AssetMetaParams
): string {
  return String(
    usage.serviceTier ?? assetParams.actualServiceTier ?? input.serviceTier ?? "default"
  );
}

function supportsFlexPrice(modelKey: string): boolean {
  return (
    modelKey === "seedance-1.0-pro" ||
    modelKey === "seedance-1.0-pro-fast" ||
    modelKey === "seedance-1.5-pro"
  );
}

function videoGenerateAudio(
  input: Record<string, unknown>,
  usage: UsageSnapshot,
  assetParams: AssetMetaParams
): boolean {
  return (
    usage.generateAudio === true ||
    input.generateAudio === true ||
    assetParams.generateAudio === true
  );
}

function videoTokenPrice(
  modelKey: string,
  resolution: string,
  inputHasVideo: boolean,
  generateAudio: boolean,
  serviceTier: string
): number | null {
  const table = VIDEO_TOKEN_PRICE[modelKey];
  if (!table) return null;
  let price = (inputHasVideo ? table.withInput : table.noInput)[resolution]
    ?? (inputHasVideo ? table.withInput : table.noInput)["720p"]
    ?? null;
  // Seedance 1.5 Pro 的官方有声档为无声档 2 倍。
  if (modelKey === "seedance-1.5-pro" && generateAudio && price !== null) price *= 2;
  if (price !== null && serviceTier === "flex" && supportsFlexPrice(modelKey)) price *= 0.5;
  return price;
}

function videoMinimumTokenApplies(modelKey: string, input: Record<string, unknown>): boolean {
  return (
    (modelKey === "seedance-2.0" || modelKey === "seedance-2.0-fast") &&
    hasInputVideo(input)
  );
}

/**
 * 估算单个任务的预估成本。
 * @param task tasks 行（含 kind/modelKey/inputJson）
 * @param assetMetaJson 关联产物 asset 的 metaJson（可选，视频优先用其中的实际分辨率/时长）
 */
export function estimateTaskCost(
  task: TaskLike,
  assetMetaJson?: string | null
): CostEstimate {
  const input = parseJson<Record<string, unknown>>(task.inputJson) ?? {};
  const assetMeta = parseJson<{ params?: AssetMetaParams }>(assetMetaJson ?? null);
  const p = assetMeta?.params ?? {};
  const usage = parseJson<UsageSnapshot>(task.usageJson ?? null);
  const hasRealUsage = usage?.source === "actual";

  // ---- 图像 ----
  if (task.kind === "image") {
    // 每张单价（5.0-pro 按输出像素分档）
    let perImage: number | undefined;
    if (task.modelKey === "seedream-5.0-pro") {
      const px = pixelsOf((p.size as string) || (input.size as string));
      perImage = px > SEEDREAM5_PRO_PX_THRESHOLD ? SEEDREAM5_PRO_HIGH : SEEDREAM5_PRO_LOW;
    } else {
      perImage = IMAGE_PRICE[task.modelKey];
    }
    if (perImage === undefined) return { yuan: null, accuracy: "none" };
    // 真实张数优先（组图场景更准），否则按 1 张
    const outputImages = firstNumber(usage?.images, usage?.generatedImages);
    const requestedImages = firstNumber(input.count);
    const imageCount =
      outputImages !== null && outputImages >= 0
        ? outputImages
        : requestedImages !== null && requestedImages > 0
          ? requestedImages
          : 1;
    let yuan = perImage * imageCount;
    if (task.modelKey === "seedream-5.0-pro") {
      const inputImages = firstNumber(usage?.inputImages) ?? requestedInputImageCount(input);
      yuan += Math.max(0, inputImages - 1) * SEEDREAM5_PRO_INPUT_IMAGE_PRICE;
    }
    if (hasRealUsage) {
      return { yuan: roundMoney(yuan), accuracy: "actual" };
    }
    return { yuan: roundMoney(yuan), accuracy: "exact" };
  }

  // ---- 视频 ----
  if (task.kind === "video") {
    const resolution = String(p.actualResolution || input.resolution || "720p");
    const isExtend = hasInputVideo(input);
    const serviceTier = serviceTierFrom(input, usage ?? {}, p);
    const generateAudio = videoGenerateAudio(input, usage ?? {}, p);
    // 真实 token 优先：token × token单价（元/百万token）
    const actualTokens = firstNumber(usage?.tokens, usage?.completionTokens, usage?.outputTokens);
    if (hasRealUsage && actualTokens !== null) {
      const perM = videoTokenPrice(
        task.modelKey,
        resolution,
        isExtend,
        generateAudio,
        serviceTier
      );
      if (perM) {
        const yuan = (actualTokens / 1_000_000) * perM;
        return { yuan: roundMoney(yuan), accuracy: "actual" };
      }
    }
    // 回退：按分辨率×时长查表估算
    const table = VIDEO_PRICE_PER_SEC[task.modelKey];
    if (!table) return { yuan: null, accuracy: "none" };
    const perSec = table[resolution] ?? table["720p"] ?? 0;
    const requestedFrames = Number(input.frames ?? p.actualFrames ?? p.frames);
    const fps = Number(
      p.framesPerSecond ?? p.actualFramesPerSecond ?? 24
    );
    const frameDuration =
      Number.isFinite(requestedFrames) && requestedFrames > 0 && fps > 0
        ? requestedFrames / fps
        : undefined;
    const duration = Number(p.actualDuration ?? input.duration ?? frameDuration ?? 5);
    const secs = duration > 0 ? duration : 5;
    const tierMultiplier = serviceTier === "flex" && supportsFlexPrice(task.modelKey) ? 0.5 : 1;
    const audioMultiplier =
      task.modelKey === "seedance-1.5-pro" && generateAudio ? 2 : 1;
    const draftMultiplier =
      task.modelKey === "seedance-1.5-pro" && input.draft === true
        ? generateAudio ? 0.6 : 0.7
        : 1;
    const yuan =
      perSec * secs * (isExtend ? VIDEO_EXTEND_MULTIPLIER : 1) * tierMultiplier * audioMultiplier * draftMultiplier;
    return { yuan: roundMoney(yuan), accuracy: "approx" };
  }

  // ---- Coze（music/tts/edit）等：不估 ----
  return { yuan: null, accuracy: "none" };
}

function modelBasis(
  task: TaskLike,
  input: Record<string, unknown>,
  usage: UsageSnapshot,
  assetParams: AssetMetaParams,
  model: CostEstimate
): { text: string; tokenRate: number | null } {
  if (task.kind === "image") {
    if (task.modelKey === "seedream-5.0-pro") {
      return {
        text: "输出图按 ¥0.30/张（≤261万像素）或 ¥0.60/张（>261万像素）；第 2 张起参考图另计 ¥0.02/张",
        tokenRate: null,
      };
    }
    const perImage = IMAGE_PRICE[task.modelKey];
    return {
      text: perImage === undefined ? "供应商未提供可换算单价" : `输出图按 ¥${perImage.toFixed(2)}/张`,
      tokenRate: null,
    };
  }
  if (task.kind !== "video") {
    return { text: model.yuan === null ? "该供应商暂未提供公开金额单价" : "按供应商公开规格估算", tokenRate: null };
  }
  const resolution = String(assetParams.actualResolution || input.resolution || "720p");
  const inputVideo = hasInputVideo(input);
  const tier = serviceTierFrom(input, usage, assetParams);
  const rate = videoTokenPrice(
    task.modelKey,
    resolution,
    inputVideo,
    videoGenerateAudio(input, usage, assetParams),
    tier
  );
  const flexSuffix =
    tier === "flex" && supportsFlexPrice(task.modelKey)
      ? "（Flex 50% 公开价）"
      : "";
  const actualTokens = firstNumber(usage.tokens, usage.completionTokens, usage.outputTokens);
  if (rate !== null && actualTokens !== null) {
    return {
      text: `${formatToken(actualTokens)} × ¥${rate.toFixed(2)}/百万 token${flexSuffix}`,
      tokenRate: rate,
    };
  }
  const duration = Number(assetParams.actualDuration ?? input.duration ?? 5);
  return {
    text: `按 ${resolution} × ${Number.isFinite(duration) && duration > 0 ? duration : 5} 秒规格估算${flexSuffix}`,
    tokenRate: rate,
  };
}

function formatToken(value: number): string {
  return value.toLocaleString("zh-CN");
}

function serviceTierInfo(
  task: TaskLike,
  input: Record<string, unknown>,
  usage: UsageSnapshot,
  assetParams: AssetMetaParams
): BillingServiceTier {
  const requested =
    task.kind === "video" ? serviceTierFrom(input, usage, assetParams) : null;
  if (requested === "flex" && supportsFlexPrice(task.modelKey)) {
    return {
      requested,
      label: "Flex / 离线推理",
      priceMultiplier: 0.5,
      note: "公开价约为在线推理的 50%，TPD 配额更高但等待时间通常更长。",
    };
  }
  if (requested === "flex") {
    return {
      requested,
      label: "Flex（该模型不支持）",
      priceMultiplier: null,
      note: "该历史任务记录了 Flex，但当前官方规则不允许该模型使用 Flex；以供应商返回用量为准。",
    };
  }
  if (requested === "default") {
    return {
      requested,
      label: "Default / 在线推理",
      priceMultiplier: 1,
      note: "在线推理模式，时效性优先；RPM 与并发配额按接入点配置。",
    };
  }
  return {
    requested: null,
    label: "未指定",
    priceMultiplier: null,
    note: "非方舟视频任务或供应商未返回服务等级。",
  };
}

/** 将任务的模型、联网搜索、服务等级和最低 token 规则归一化为可展示的账单说明。 */
export function buildTaskBilling(
  task: TaskLike,
  assetMetaJson?: string | null
): TaskBilling {
  const input = parseJson<Record<string, unknown>>(task.inputJson) ?? {};
  const assetMeta = parseJson<{ params?: AssetMetaParams }>(assetMetaJson ?? null);
  const assetParams = assetMeta?.params ?? {};
  const usage = parseJson<UsageSnapshot>(task.usageJson ?? null) ?? {};
  const model = estimateTaskCost(task, assetMetaJson);
  const modelInfo = modelBasis(task, input, usage, assetParams, model);
  const tier = serviceTierInfo(task, input, usage, assetParams);
  const calls = firstNumber(usage.webSearchCalls, usage.tool_usage?.web_search);
  const requestedSearch = input.webSearch === true ||
    (Array.isArray(usage.tools) &&
      usage.tools.some((tool: unknown) => tool === "web_search"));
  const searchYuan = calls === null ? null : roundMoney(calls * WEB_SEARCH_PRICE_PER_CALL, 4);
  const search: BillingSearch = {
    calls,
    listYuan: searchYuan,
    pricePerThousand: WEB_SEARCH_PRICE_PER_CALL * 1000,
    freeMonthlyCalls: WEB_SEARCH_FREE_MONTHLY_CALLS,
    note:
      calls !== null
        ? "按联网内容插件公网资源公开价 4 元/千次计算；每月前 2 万次免费额度、账户折扣和代金券未计入。"
        : requestedSearch
          ? "已请求联网搜索，但供应商未返回实际次数，暂无法核算搜索费用。"
          : "未启用联网搜索或供应商未返回搜索用量。",
  };
  const minimumApplies = videoMinimumTokenApplies(task.modelKey, input);
  const minimumToken: BillingMinimumToken = {
    applies: minimumApplies,
    note: minimumApplies
      ? "输入包含视频时，平台会按分辨率、画幅和输入/输出时长应用最低 token 门槛；准确 completion_tokens（含可能触发的最低值）以供应商响应为准。"
      : "当前任务未触发 Seedance 2.0 输入视频最低 token 规则。",
  };
  const totalYuan =
    model.yuan === null
      ? searchYuan
      : roundMoney(model.yuan + (searchYuan ?? 0), 4);
  const totalAccuracy =
    totalYuan === null
      ? "none"
      : searchYuan !== null || (requestedSearch && calls === null)
        ? "approx"
        : model.accuracy;
  return {
    model,
    modelBasis: modelInfo.text,
    tokenRateYuanPerMillion: modelInfo.tokenRate,
    serviceTier: tier,
    webSearch: search,
    minimumToken,
    total: { yuan: totalYuan, accuracy: totalAccuracy },
  };
}
