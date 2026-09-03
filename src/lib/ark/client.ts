import { isValidVideoFrames } from "./capabilities";

/**
 * 火山方舟统一适配层。
 * - chat：同步 /chat/completions
 * - image：同步 /images/generations
 * - video：异步 /contents/generations/tasks（提交 + 轮询）
 * API Key 仅存在服务端环境变量，绝不下发前端。
 */

const ARK_BASE_URL =
  process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";

function apiKey(envName = "ARK_API_KEY"): string {
  const key = process.env[envName];
  if (!key) throw new Error(`缺少环境变量 ${envName}`);
  return key;
}

export class ArkError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    /** 明确收到供应商的瞬时拒绝，尚未拿到可用结果时才允许自动重试。 */
    public retrySafe = false
  ) {
    super(message);
    this.name = "ArkError";
  }
}

/** 单次方舟 HTTP 调用的超时（毫秒）。防止挂起连接吃光 worker 并发槽。
 * 图片生成是后台任务，不走公司网关，可给足耐心；高分辨率单图（如 Seedream 5.0 Pro
 * 非流式）常超 1 分钟，故默认 5 分钟。仍保留超时以避免僵死连接永久占满并发槽。 */
const ARK_FETCH_TIMEOUT_MS = Number(process.env.ARK_FETCH_TIMEOUT_MS) || 300_000;

async function arkFetch<T>(
  path: string,
  init?: RequestInit,
  apiKeyEnv?: string
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ARK_BASE_URL}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(ARK_FETCH_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey(apiKeyEnv)}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new ArkError(`方舟请求超时（${ARK_FETCH_TIMEOUT_MS}ms）`, 504);
    }
    throw e;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? body;
    throw new ArkError(
      err?.message || `方舟请求失败 (${res.status})`,
      res.status,
      err?.code,
      [408, 425, 429, 500, 502, 503, 504].includes(res.status)
    );
  }
  return body as T;
}

// ---------------- Image ----------------

export interface ImageGenOptions {
  endpointId: string;
  /** 独立 API Key 对应的环境变量名；缺省使用 ARK_API_KEY */
  apiKeyEnv?: string;
  prompt: string;
  /** 推荐传 '2848x1600' 等具体像素值；也兼容 '1K'/'2K'/'3K'/'4K' 档位 */
  size?: string;
  /** 参考图（data URI 或公网 URL），用于图生图 */
  refImages?: string[];
  watermark?: boolean;
  /** 仅 Seedream 5.0 Lite / 4.5 / 4.0 支持 */
  stream?: boolean;
  /** 组图：'auto' 开启连续生成，配合 maxImages（仅 Lite / 4.5 / 4.0） */
  sequential?: boolean;
  /** 组图最多生成张数（1~15，与参考图数量之和 ≤ 15） */
  maxImages?: number;
  /** 提示词优化模式（仅 Pro / 4.0 支持 fast） */
  optimizeMode?: "standard" | "fast";
  /** 输出文件格式（仅 Pro / Lite 可自定义） */
  outputFormat?: "png" | "jpeg";
  /** 联网搜索（仅 Lite 支持） */
  webSearch?: boolean;
}

export interface ImageGenerationResult {
  url: string;
  size?: string;
}

export interface ImageGenerationUsage {
  generatedImages?: number;
  inputImages?: number;
  outputTokens?: number;
  totalTokens?: number;
  webSearchCalls?: number;
}

export interface ImageGenerationResponse {
  images: ImageGenerationResult[];
  usage?: ImageGenerationUsage;
  tools?: string[];
}

interface ArkImageUsage {
  generated_images?: number;
  input_images?: number;
  output_tokens?: number;
  total_tokens?: number;
  tool_usage?: { web_search?: number };
}

interface ImageStreamEvent {
  type?: string;
  image_index?: number;
  url?: string;
  size?: string;
  tools?: { type?: string }[];
  usage?: ArkImageUsage;
  error?: { code?: string; message?: string };
}

function imageUsage(usage?: ArkImageUsage): ImageGenerationUsage | undefined {
  if (!usage) return undefined;
  return {
    generatedImages: usage.generated_images,
    inputImages: usage.input_images,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    webSearchCalls: usage.tool_usage?.web_search,
  };
}

/** 逐块解析方舟图片生成 SSE，成功图片按 image_index 排序，并保留完成事件用量。 */
async function parseImageStream(res: Response): Promise<ImageGenerationResponse> {
  if (!res.body) throw new ArkError("方舟流式响应为空");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const results: { index: number; result: ImageGenerationResult }[] = [];
  const failures: { code?: string; message?: string }[] = [];
  const tools = new Set<string>();
  let usage: ImageGenerationUsage | undefined;
  let pending = "";

  const consume = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""))
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;

    let event: ImageStreamEvent;
    try {
      event = JSON.parse(data) as ImageStreamEvent;
    } catch {
      return;
    }
    if (event.type === "image_generation.completed") {
      usage = imageUsage(event.usage);
      event.tools?.forEach((tool) => {
        if (tool.type) tools.add(tool.type);
      });
    } else if (event.type === "image_generation.partial_succeeded" && event.url) {
      results.push({
        index: event.image_index ?? results.length,
        result: { url: event.url, size: event.size?.replace("×", "x") },
      });
    } else if (event.type === "image_generation.partial_failed" && event.error) {
      failures.push(event.error);
    } else if (event.error) {
      throw new ArkError(
        event.error.message || "方舟图片生成失败",
        undefined,
        event.error.code
      );
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? "";
    for (const block of blocks) consume(block);
    if (done) break;
  }
  if (pending.trim()) consume(pending);

  if (!results.length) {
    const failure = failures[0];
    throw new ArkError(
      failure?.message || "图像生成无返回结果",
      undefined,
      failure?.code
    );
  }
  return {
    images: results.sort((a, b) => a.index - b.index).map((item) => item.result),
    usage,
    tools: tools.size ? [...tools] : undefined,
  };
}

/** 方舟图像接口 size 支持 'WIDTHxHEIGHT' 像素值或 '2k'/'3k'/'4k' 档位（小写） */
function normalizeImageSize(size: string): string {
  const s = size.trim().toLowerCase();
  if (/^\d+x\d+$/.test(s)) return s;
  if (s === "1k") return "1024x1024"; // 1K 档位部分模型不识别，回退为像素值
  return s;
}

export async function generateImageWithUsage(
  opts: ImageGenOptions
): Promise<ImageGenerationResponse> {
  const body: Record<string, unknown> = {
    model: opts.endpointId,
    prompt: opts.prompt,
    size: normalizeImageSize(opts.size || "2048x2048"),
    response_format: "url",
    watermark: opts.watermark ?? false,
  };
  if (opts.refImages?.length) {
    body.image = opts.refImages.length === 1 ? opts.refImages[0] : opts.refImages;
  }
  if (opts.outputFormat) body.output_format = opts.outputFormat;
  if (opts.optimizeMode) {
    body.optimize_prompt_options = { mode: opts.optimizeMode };
  }
  if (opts.webSearch) {
    body.tools = [{ type: "web_search" }];
  }
  if (opts.sequential) {
    body.sequential_image_generation = "auto";
    body.sequential_image_generation_options = {
      max_images: Math.max(1, Math.min(15, opts.maxImages ?? 4)),
    };
  }

  if (opts.stream) {
    body.stream = true;
    let res: Response;
    try {
      res = await fetch(`${ARK_BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey(opts.apiKeyEnv)}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ARK_FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw new ArkError(`方舟图片请求超时（${ARK_FETCH_TIMEOUT_MS}ms）`, 504);
      }
      throw e;
    }
    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      const err = errorBody?.error ?? errorBody;
      throw new ArkError(
        err?.message || `方舟请求失败 (${res.status})`,
        res.status,
        err?.code,
        [408, 425, 429, 500, 502, 503, 504].includes(res.status)
      );
    }
    return parseImageStream(res);
  }

  const data = await arkFetch<{
    data: { url?: string; size?: string; error?: { code?: string; message?: string } }[];
    tools?: { type?: string }[];
    usage?: ArkImageUsage;
  }>(
    "/images/generations",
    { method: "POST", body: JSON.stringify(body) },
    opts.apiKeyEnv
  );

  const results = (data.data ?? [])
    .filter((item): item is { url: string; size?: string } => !!item.url)
    .map((item) => ({ url: item.url, size: item.size?.replace("×", "x") }));
  if (!results.length) {
    const failure = data.data?.find((item) => item.error)?.error;
    throw new ArkError(
      failure?.message || "图像生成无返回结果",
      undefined,
      failure?.code
    );
  }
  const tools = data.tools?.map((tool) => tool.type).filter((type): type is string => !!type);
  return {
    images: results,
    usage: imageUsage(data.usage),
    tools: tools?.length ? tools : undefined,
  };
}

/** 保留旧调用契约；需要成本/联网用量时使用 generateImageWithUsage。 */
export async function generateImage(
  opts: ImageGenOptions
): Promise<ImageGenerationResult[]> {
  return (await generateImageWithUsage(opts)).images;
}

// ---------------- Video（异步任务） ----------------

export interface VideoGenOptions {
  endpointId: string;
  prompt: string;
  /** 480p / 720p / 1080p */
  resolution?: string;
  /** 秒；-1 表示由模型智能决定（仅 Seedance 1.5/2.0 支持） */
  duration?: number;
  /** 精确帧数（仅 Seedance 1.0 系列；与 duration 互斥，固定 24fps） */
  frames?: number;
  /** 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / adaptive */
  ratio?: string;
  /** 首帧图（data URI 或公网 URL） */
  firstFrame?: string;
  /** 尾帧图（需与 firstFrame 同时使用） */
  lastFrame?: string;
  /** 全能参考图（1~9 张，仅 Seedance 2.0 系列；与首尾帧互斥） */
  refImages?: string[];
  /** 全能参考视频（1~3 段，≤15s，公网 URL，仅 Seedance 2.0 系列） */
  refVideos?: string[];
  /** 全能参考音频（1~3 段，≤15s，公网 URL，仅 Seedance 2.0 系列） */
  refAudios?: string[];
  /** 是否生成同步音频（仅 Seedance 2.0 系列 / 1.5 pro） */
  generateAudio?: boolean;
  watermark?: boolean;
  cameraFixed?: boolean;
  /** 任务完成时返回无水印尾帧 URL（Seedance 2.0 系列） */
  returnLastFrame?: boolean;
  /** 联网搜索（Seedance 2.0 系列） */
  webSearch?: boolean;
  /** 队列优先级 0-9（Seedance 2.0 系列） */
  priority?: number;
  /** 服务等级；flex 更便宜但排队更久 */
  serviceTier?: "default" | "flex";
  /** 方舟侧任务执行超时，单位秒，范围 1-72 小时 */
  executionExpiresAfter?: number;
  /** 终端用户稳定匿名标识 */
  safetyIdentifier?: string;
  /** 随机种子，-1 表示随机（Seedance 1.5 Pro） */
  seed?: number;
  /** 生成 480p 低成本样片（Seedance 1.5 Pro） */
  draft?: boolean;
  /** 基于已完成的 Draft 任务生成正式视频 */
  draftTaskId?: string;
}

export type ArkVideoStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export interface ArkVideoTask {
  id: string;
  status: ArkVideoStatus;
  videoUrl?: string;
  lastFrameUrl?: string;
  error?: string;
  /** 实际生成的分辨率 / 比例 / 时长（任务成功后返回） */
  resolution?: string;
  ratio?: string;
  duration?: number;
  frames?: number;
  framesPerSecond?: number;
  generateAudio?: boolean;
  seed?: number;
  priority?: number;
  serviceTier?: string;
  executionExpiresAfter?: number;
  draft?: boolean;
  draftTaskId?: string;
  tools?: string[];
  /** 真实用量 token 数（usage.completion_tokens），用于精确成本核算 */
  completionTokens?: number;
  totalTokens?: number;
  webSearchUsage?: number;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role?: string }
  | { type: "video_url"; video_url: { url: string }; role?: string }
  | { type: "audio_url"; audio_url: { url: string }; role?: string }
  | { type: "draft_task"; draft_task: { id: string } };

export async function submitVideoTask(opts: VideoGenOptions): Promise<string> {
  const content: ContentPart[] = opts.draftTaskId
    ? [{ type: "draft_task", draft_task: { id: opts.draftTaskId } }]
    : [{ type: "text", text: opts.prompt.trim() }];
  const hasRefs =
    opts.refImages?.length || opts.refVideos?.length || opts.refAudios?.length;

  if (!opts.draftTaskId && hasRefs) {
    // 全能参考：图 / 视频 / 音频混合，与首尾帧互斥
    for (const url of opts.refImages ?? []) {
      content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    }
    for (const url of opts.refVideos ?? []) {
      content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
    }
    for (const url of opts.refAudios ?? []) {
      content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
    }
  } else if (!opts.draftTaskId) {
    if (opts.firstFrame) {
      content.push({
        type: "image_url",
        image_url: { url: opts.firstFrame },
        role: "first_frame",
      });
    }
    if (opts.lastFrame) {
      content.push({
        type: "image_url",
        image_url: { url: opts.lastFrame },
        role: "last_frame",
      });
    }
  }

  // 新版参数直接放 request body，方舟做强校验
  const body: Record<string, unknown> = {
    model: opts.endpointId,
    content,
    watermark: opts.watermark ?? false,
  };
  if (opts.resolution) body.resolution = opts.resolution;
  if (opts.ratio) body.ratio = opts.ratio;
  if (opts.frames !== undefined && opts.duration !== undefined) {
    throw new ArkError("视频时长与帧数只能选择一个", 400, "VIDEO_LENGTH_MODE_CONFLICT");
  }
  if (opts.frames !== undefined) {
    if (!isValidVideoFrames(opts.frames)) {
      throw new ArkError(
        "视频帧数必须为 29–289 且按 4 帧递增",
        400,
        "VIDEO_FRAMES_INVALID"
      );
    }
    body.frames = opts.frames;
  } else if (opts.duration !== undefined) {
    body.duration = opts.duration;
  }
  if (opts.generateAudio !== undefined) body.generate_audio = opts.generateAudio;
  if (opts.cameraFixed !== undefined) body.camera_fixed = opts.cameraFixed;
  if (opts.returnLastFrame !== undefined) body.return_last_frame = opts.returnLastFrame;
  if (opts.webSearch) body.tools = [{ type: "web_search" }];
  if (opts.priority !== undefined) body.priority = opts.priority;
  if (opts.serviceTier && opts.serviceTier !== "default") {
    body.service_tier = opts.serviceTier;
  }
  if (opts.executionExpiresAfter !== undefined) {
    body.execution_expires_after = opts.executionExpiresAfter;
  }
  if (opts.safetyIdentifier) body.safety_identifier = opts.safetyIdentifier;
  if (opts.seed !== undefined) body.seed = opts.seed;
  if (opts.draft !== undefined) body.draft = opts.draft;

  const data = await arkFetch<{ id: string }>("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!data.id) throw new ArkError("视频任务提交失败：无任务 ID");
  return data.id;
}

export async function getVideoTask(arkTaskId: string): Promise<ArkVideoTask> {
  const data = await arkFetch<{
    id: string;
    status: ArkVideoStatus;
    content?: { video_url?: string; last_frame_url?: string };
    error?: { code?: string; message?: string };
    resolution?: string;
    ratio?: string;
    duration?: number;
    frames?: number;
    framespersecond?: number;
    frames_per_second?: number;
    framesPerSecond?: number;
    generate_audio?: boolean;
    seed?: number;
    priority?: number;
    service_tier?: string;
    execution_expires_after?: number;
    draft?: boolean;
    draft_task_id?: string;
    tools?: { type?: string }[];
    usage?: {
      completion_tokens?: number;
      total_tokens?: number;
      tool_usage?: { web_search?: number };
    };
  }>(`/contents/generations/tasks/${arkTaskId}`, { method: "GET" });

  return {
    id: data.id,
    status: data.status,
    videoUrl: data.content?.video_url,
    lastFrameUrl: data.content?.last_frame_url,
    error: data.error ? `${data.error.code ?? ""} ${data.error.message ?? ""}`.trim() : undefined,
    resolution: data.resolution,
    ratio: data.ratio,
    duration: data.duration,
    frames: data.frames,
    framesPerSecond:
      data.framespersecond ?? data.frames_per_second ?? data.framesPerSecond,
    generateAudio: data.generate_audio,
    seed: data.seed,
    priority: data.priority,
    serviceTier: data.service_tier,
    executionExpiresAfter: data.execution_expires_after,
    draft: data.draft,
    draftTaskId: data.draft_task_id,
    tools: data.tools?.map((tool) => tool.type).filter((type): type is string => !!type),
    completionTokens: data.usage?.completion_tokens,
    totalTokens: data.usage?.total_tokens,
    webSearchUsage: data.usage?.tool_usage?.web_search,
  };
}

/** 取消方舟排队任务，或删除方舟侧已结束的 7 天临时任务记录。 */
export async function deleteVideoTask(
  arkTaskId: string,
  timeoutMs = 8_000
): Promise<void> {
  await arkFetch<unknown>(`/contents/generations/tasks/${arkTaskId}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(timeoutMs),
  });
}
