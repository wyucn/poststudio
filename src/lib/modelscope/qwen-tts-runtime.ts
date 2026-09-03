import type {
  QwenTtsHealthStatus,
  QwenTtsInstanceKey,
} from "./types";

export const DEFAULT_QWEN_TTS_PUBLIC_URL =
  "https://studio-qwen-qwen3-tts.api-inference.modelscope.net";

const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
const MIN_HEALTH_TIMEOUT_MS = 1_000;
const MAX_HEALTH_TIMEOUT_MS = 8_000;

type Env = Record<string, string | undefined>;

export interface QwenTtsInstanceConfig {
  key: QwenTtsInstanceKey;
  label: string;
  url: string | null;
  accessToken: string | null;
  requiresAccessToken: boolean;
  experimental: boolean;
  configured: boolean;
  capacityLimit: number;
}

export interface QwenTtsHealthCheck {
  status: QwenTtsHealthStatus;
  message: string;
  latencyMs: number | null;
}

function trimmed(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function normalizedUrl(value: string | undefined): string | null {
  const candidate = trimmed(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function boundedPositiveNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

export function isQwenTtsInstanceKey(
  value: unknown
): value is QwenTtsInstanceKey {
  return value === "public" || value === "self-hosted";
}

export function qwenTtsDefaultInstance(
  env: Env = process.env
): QwenTtsInstanceKey {
  return env.MODELSCOPE_QWEN_TTS_DEFAULT_INSTANCE === "self-hosted"
    ? "self-hosted"
    : "public";
}

export function qwenTtsInstanceConfigs(
  env: Env = process.env
): QwenTtsInstanceConfig[] {
  const publicUrl =
    normalizedUrl(env.MODELSCOPE_QWEN_TTS_PUBLIC_URL) ??
    normalizedUrl(env.MODELSCOPE_QWEN_TTS_URL) ??
    DEFAULT_QWEN_TTS_PUBLIC_URL;
  const publicToken = trimmed(env.MODELSCOPE_ACCESS_TOKEN);
  const selfHostedUrl = normalizedUrl(
    env.MODELSCOPE_QWEN_TTS_SELF_HOSTED_URL
  );
  const selfHostedToken = trimmed(
    env.MODELSCOPE_QWEN_TTS_SELF_HOSTED_TOKEN
  );

  return [
    {
      key: "public",
      label: "公共创空间",
      url: publicUrl,
      accessToken: publicToken,
      requiresAccessToken: true,
      experimental: true,
      configured: !!publicToken,
      capacityLimit: 1,
    },
    {
      key: "self-hosted",
      label: "自建实例",
      url: selfHostedUrl,
      accessToken: selfHostedToken,
      requiresAccessToken: false,
      experimental: false,
      configured: !!selfHostedUrl,
      capacityLimit: 1,
    },
  ];
}

export function qwenTtsInstanceConfig(
  key: QwenTtsInstanceKey = qwenTtsDefaultInstance(),
  env: Env = process.env
): QwenTtsInstanceConfig {
  return qwenTtsInstanceConfigs(env).find((instance) => instance.key === key)!;
}

export function qwenTtsHealthTimeoutMs(env: Env = process.env): number {
  return boundedPositiveNumber(
    env.MODELSCOPE_QWEN_TTS_HEALTH_TIMEOUT_MS,
    DEFAULT_HEALTH_TIMEOUT_MS,
    MIN_HEALTH_TIMEOUT_MS,
    MAX_HEALTH_TIMEOUT_MS
  );
}

function healthHeaders(config: QwenTtsInstanceConfig): HeadersInit | undefined {
  return config.accessToken
    ? { Authorization: `Bearer ${config.accessToken}` }
    : undefined;
}

function httpFailureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "鉴权失败，请联系管理员检查访问令牌。";
  }
  if (status === 404) {
    return "未找到 Gradio 接口，请联系管理员检查实例地址。";
  }
  if (status >= 500) {
    return `服务端暂时繁忙（HTTP ${status}），可以稍后重试。`;
  }
  return `健康检查未通过（HTTP ${status}）。`;
}

export async function checkQwenTtsInstanceHealth(
  config: QwenTtsInstanceConfig,
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {}
): Promise<QwenTtsHealthCheck> {
  if (!config.url) {
    return {
      status: "unconfigured",
      message: "管理员尚未配置自建实例地址。",
      latencyMs: null,
    };
  }
  if (config.requiresAccessToken && !config.accessToken) {
    return {
      status: "unconfigured",
      message: "管理员尚未配置 ModelScope Access Token。",
      latencyMs: null,
    };
  }

  const timeoutMs = options.timeoutMs ?? qwenTtsHealthTimeoutMs();
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const configResponse = await fetcher(`${config.url}/config`, {
      headers: healthHeaders(config),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!configResponse.ok) {
      return {
        status: "offline",
        message: httpFailureMessage(configResponse.status),
        latencyMs: Date.now() - startedAt,
      };
    }

    const infoResponse = await fetcher(`${config.url}/gradio_api/info`, {
      headers: healthHeaders(config),
      signal: controller.signal,
      cache: "no-store",
    });
    const latencyMs = Date.now() - startedAt;
    if (!infoResponse.ok) {
      return {
        status: "degraded",
        message: `${httpFailureMessage(infoResponse.status)} 配置可访问，但生成接口元数据异常。`,
        latencyMs,
      };
    }

    return {
      status: "healthy",
      message: "配置与生成接口均可访问。",
      latencyMs,
    };
  } catch (error) {
    const timedOut =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    return {
      status: "offline",
      message: timedOut
        ? `健康检查超过 ${Math.round(timeoutMs / 1000)} 秒，请稍后重试。`
        : "暂时无法连接声音克隆服务，请稍后重试。",
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function qwenTtsCapacityHint(input: {
  instance: QwenTtsInstanceKey;
  queued: number;
  running: number;
  limit: number;
}): string {
  const active = input.queued + input.running;
  if (input.instance === "public") {
    if (active > 0) {
      return `公共 GPU 当前有 ${active} 个本站任务排队或执行；0.6B 通常等待更短，繁忙时可切换自建实例。`;
    }
    return "公共创空间共享 GPU 且容量不承诺，忙时会排队；0.6B 通常更快。";
  }
  if (active > 0) {
    return `自建实例当前有 ${active} 个本站任务排队或执行；本站按实例串行调用，避免并发装载模型。`;
  }
  return "自建实例由管理员维护；本站按实例串行调用，实际容量取决于 GPU 与模型规格。";
}
