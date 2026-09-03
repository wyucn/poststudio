export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = unknown>(
  url: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && process.env.NEXT_PUBLIC_AUTH_MODE === "cas") {
    const loginUrl = process.env.NEXT_PUBLIC_CAS_LOGIN_URL;
    if (!loginUrl) throw new ApiError("CAS 登录地址未配置", 500, "CAS_LOGIN_NOT_CONFIGURED");
    const separator = loginUrl.includes("?") ? "&" : "?";
    window.location.href = `${loginUrl}${separator}service=${encodeURIComponent(window.location.href)}`;
    return new Promise<T>(() => {}); // 阻断后续执行
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      data?.error || `请求失败 (${res.status})`,
      res.status,
      data?.code || `HTTP_${res.status}`,
      data?.requestId
    );
  }
  return data as T;
}
