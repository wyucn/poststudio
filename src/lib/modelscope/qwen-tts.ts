import { Client, handle_file, type Config } from "@gradio/client";
import {
  effectiveQwenTtsDefaultInstance,
  effectiveQwenTtsInstanceConfig,
  type EffectiveQwenTtsInstanceConfig,
} from "@/lib/models/runtime";
import type { QwenTtsInstanceKey } from "./types";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MODEL_LOAD_RETRY_DELAYS_MS = [2_000, 5_000] as const;

// 每个实例各自串行，避免同一 GPU 同时装载大模型；公共与自建实例仍可并行。
const qwenRequestTails = new Map<QwenTtsInstanceKey, Promise<void>>();

export interface QwenVoiceCloneInput {
  referenceAudio: Buffer;
  referenceText?: string;
  targetText: string;
  language: string;
  useXVectorOnly: boolean;
  modelSize: "0.6B" | "1.7B";
  instance?: QwenTtsInstanceKey;
}

export interface QwenVoiceCloneResult {
  audio: Buffer;
  audioMime: string;
  audioUrl: string;
  status: string;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Qwen3-TTS 创空间调用超时（${Math.round(timeoutMs / 1000)} 秒）`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function serializeQwenRequest<T>(
  instance: QwenTtsInstanceKey,
  run: () => Promise<T>
): Promise<T> {
  const previous = qwenRequestTails.get(instance) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  qwenRequestTails.set(instance, current);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (qwenRequestTails.get(instance) === current) {
      qwenRequestTails.delete(instance);
    }
  }
}

function isTransientModelLoadError(error: Error): boolean {
  return /cannot copy out of meta tensor|weights? (?:are|is) on the meta device/i.test(
    error.message
  );
}

function resolveAudioUrl(value: unknown, spaceUrl: string): string {
  const candidate =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? String(
            (value as Record<string, unknown>).url ??
              (value as Record<string, unknown>).path ??
              ""
          )
        : "";

  if (!candidate) throw new Error("Qwen3-TTS 创空间未返回音频文件");
  if (/^https?:\/\//i.test(candidate)) {
    const outputUrl = new URL(candidate);
    const apiUrl = new URL(spaceUrl);
    if (
      outputUrl.origin !== apiUrl.origin &&
      outputUrl.hostname.endsWith(".ms.show")
    ) {
      return new URL(
        `${outputUrl.pathname}${outputUrl.search}${outputUrl.hash}`,
        apiUrl
      ).toString();
    }
    return candidate;
  }
  if (candidate.startsWith("/")) return new URL(candidate, spaceUrl).toString();

  // 新版 Gradio 通常会直接返回 url；旧版只有服务器临时路径时使用文件接口兜底。
  return new URL(
    `/gradio_api/file=${encodeURIComponent(candidate)}`,
    spaceUrl
  ).toString();
}

function normalizeGradioError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const detail = String(value.message ?? value.code ?? value.stage ?? "未知错误");
    return new Error(`Qwen3-TTS 创空间请求失败：${detail}`);
  }
  return new Error(`Qwen3-TTS 创空间请求失败：${String(error)}`);
}

async function connectModelScopeClient(
  spaceUrl: string,
  accessToken: string | null,
  timeoutMs: number
): Promise<Client> {
  const client = new Client(spaceUrl, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  const postData = client.post_data.bind(client);
  client.post_data = async (url, body, additionalHeaders) => {
    const result = await postData(url, body, additionalHeaders);
    const responseBody = result[0] as Record<string, unknown> | undefined;
    const errors = responseBody?.errors as Record<string, unknown> | undefined;
    if (responseBody && errors?.message && !responseBody.error) {
      responseBody.error = String(errors.message);
    }
    return result;
  };
  const response = await withTimeout(
    client.fetch(`${spaceUrl}/config`),
    timeoutMs
  );
  if (!response.ok) {
    throw new Error(`Qwen3-TTS 创空间配置读取失败（HTTP ${response.status}）`);
  }
  const sourceConfig = (await response.json()) as Config;

  // ModelScope 的 API 专用域名返回的 Gradio config.root 仍指向浏览器页面域名。
  // SDK Token 在 ms.show 会被拒绝，因此后续上传、队列和下载必须固定到专用域名。
  const config: Config = { ...sourceConfig, root: spaceUrl, root_url: spaceUrl };
  await client._resolve_heartbeat(config);
  client.api_info = await withTimeout(client.view_api(), timeoutMs);
  client.api_map = Object.fromEntries(
    config.dependencies
      .filter((dependency) => dependency.api_name)
      .map((dependency) => [dependency.api_name!, dependency.id])
  );
  return client;
}

/**
 * 调用 ModelScope 公共 Qwen3-TTS Gradio 创空间的声音克隆接口。
 * 公共创空间只作为实验性后端，地址可通过环境变量替换成自建实例。
 */
async function generateQwenVoiceCloneAttempt(
  input: QwenVoiceCloneInput,
  instance: EffectiveQwenTtsInstanceConfig
): Promise<QwenVoiceCloneResult> {
  if (!instance.configured || !instance.url) {
    const reason =
      instance.key === "public"
        ? "尚未配置 MODELSCOPE_ACCESS_TOKEN"
        : "尚未配置 MODELSCOPE_QWEN_TTS_SELF_HOSTED_URL";
    throw new Error(`Qwen3-TTS ${instance.label}${reason}`);
  }
  const spaceUrl = instance.url;
  const timeoutMs = positiveNumber(
    process.env.MODELSCOPE_QWEN_TTS_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const startedAt = Date.now();
  const client = await withTimeout(
    connectModelScopeClient(spaceUrl, instance.accessToken, timeoutMs),
    timeoutMs
  );

  try {
    const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
    let result;
    try {
      result = await withTimeout(
        client.predict<unknown[]>("/generate_voice_clone", {
          ref_audio: handle_file(input.referenceAudio),
          ref_text: input.referenceText?.trim() || "",
          target_text: input.targetText.trim(),
          language: input.language,
          use_xvector_only: input.useXVectorOnly,
          model_size: input.modelSize,
        }),
        remaining
      );
    } catch (error) {
      throw normalizeGradioError(error);
    }
    const data = Array.isArray(result.data) ? result.data : [];
    const status = String(data[1] ?? "");
    if (/^error:/i.test(status)) {
      throw new Error(`Qwen3-TTS 生成失败：${status.replace(/^error:\s*/i, "")}`);
    }
    const audioUrl = resolveAudioUrl(data[0], spaceUrl);
    const downloadRemaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
    const audioResponse = await withTimeout(client.fetch(audioUrl), downloadRemaining);
    if (!audioResponse.ok) {
      throw new Error(`Qwen3-TTS 结果音频下载失败（HTTP ${audioResponse.status}）`);
    }
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    if (!audio.length) throw new Error("Qwen3-TTS 返回了空音频文件");
    return {
      audio,
      audioMime: audioResponse.headers.get("content-type") || "audio/wav",
      audioUrl,
      status,
    };
  } finally {
    client.close();
  }
}

/**
 * 串行调用公共创空间；其共享 GPU 在并发装载模型时偶发产生 meta tensor，
 * 对这个明确可恢复的错误重新连接并退避重试，其他业务错误仍立即返回。
 */
export async function generateQwenVoiceClone(
  input: QwenVoiceCloneInput
): Promise<QwenVoiceCloneResult> {
  const instance = effectiveQwenTtsInstanceConfig(
    input.instance ?? effectiveQwenTtsDefaultInstance()
  );
  return serializeQwenRequest(instance.key, async () => {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MODEL_LOAD_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await generateQwenVoiceCloneAttempt(input, instance);
      } catch (error) {
        lastError = normalizeGradioError(error);
        const retryDelay = MODEL_LOAD_RETRY_DELAYS_MS[attempt];
        if (!isTransientModelLoadError(lastError) || retryDelay === undefined) {
          break;
        }
        console.warn(
          `[qwen-tts] 创空间模型加载状态异常，${retryDelay / 1000} 秒后进行第 ${attempt + 2} 次尝试`
        );
        await delay(retryDelay);
      }
    }

    if (lastError && isTransientModelLoadError(lastError)) {
      throw new Error(
        `Qwen3-TTS ${instance.label}加载模型失败，已自动重试 ${MODEL_LOAD_RETRY_DELAYS_MS.length} 次；请稍后重试任务，或临时选择 0.6B。原始错误：${lastError.message}`
      );
    }
    throw lastError ?? new Error("Qwen3-TTS 创空间请求失败");
  });
}
