const RETRYABLE_BRIDGE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableBridgeStatus(status: number): boolean {
  return RETRYABLE_BRIDGE_STATUSES.has(status);
}

type Sleep = (milliseconds: number) => Promise<void>;

const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * 中转服务的有限重试：仅重试网络错误与明确的瞬时 HTTP 状态。
 * 调用方必须让 request 每次都创建新的请求体，流不能跨重试复用。
 */
export async function fetchBridgeWithRetry(
  request: () => Promise<Response>,
  options: { attempts?: number; sleep?: Sleep } = {}
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request();
      if (
        response.ok ||
        !isRetryableBridgeStatus(response.status) ||
        attempt === attempts
      ) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    await sleep(250 * 2 ** (attempt - 1));
  }

  throw new Error("中转上传重试异常结束");
}
