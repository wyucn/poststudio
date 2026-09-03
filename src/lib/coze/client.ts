/**
 * Coze 官方插件 MCP 客户端（服务端专用）。
 *
 * 扣子官方插件均暴露为 MCP Server（Streamable HTTP）：
 *   POST https://mcp.coze.cn/v1/plugins/{pluginId}
 *   Authorization: Bearer <COZE_API_TOKEN（SAT）>
 *
 * 调用流程：initialize -> tools/call，响应为 SSE 格式的 JSON-RPC。
 */

import {
  cozePluginUrl,
  type CozePluginKey,
} from "@/lib/coze/config";
import { managedCozeEndpoint } from "@/lib/models/runtime";

/** 单次 Coze MCP 调用的超时（毫秒）。防止挂起连接永久占用 worker 并发槽。 */
const COZE_RPC_TIMEOUT_MS = Number(process.env.COZE_RPC_TIMEOUT_MS) || 120_000;

export type CozeRpcPhase = "initialize" | "tool";

function transientHttpStatus(status: number | undefined): boolean {
  return (
    status !== undefined &&
    [408, 425, 429, 500, 502, 503, 504].includes(status)
  );
}

/** 结构化的 MCP 错误；握手阶段失败尚未调用付费工具，可安全有限重试。 */
export class CozeError extends Error {
  constructor(
    message: string,
    public phase: CozeRpcPhase,
    public status?: number,
    public providerCode?: number,
    public retrySafe = false
  ) {
    super(message);
    this.name = "CozeError";
  }
}

export { COZE_PLUGIN_IDS } from "@/lib/coze/config";
export type { CozePluginKey } from "@/lib/coze/config";

function token(): string {
  const t = process.env.COZE_API_TOKEN;
  if (!t) throw new Error("缺少 COZE_API_TOKEN 环境变量（扣子服务访问令牌）");
  return t;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function parseSseJsonRpc(text: string): JsonRpcResponse[] {
  const out: JsonRpcResponse[] = [];
  for (const chunk of text.split("\n\n")) {
    const dataLine = chunk
      .split("\n")
      .find((l) => l.startsWith("data: ") || l.startsWith("data:"));
    if (!dataLine) continue;
    try {
      out.push(JSON.parse(dataLine.replace(/^data:\s*/, "")));
    } catch {
      // 忽略非 JSON 的 SSE 行（如 ping）
    }
  }
  return out;
}

async function rpc(
  url: string,
  body: Record<string, unknown>,
  sessionId?: string,
  phase: CozeRpcPhase = "tool",
  timeoutMs = COZE_RPC_TIMEOUT_MS
): Promise<{ sessionId: string | null; response: JsonRpcResponse }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token()}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new CozeError(
        `Coze MCP ${phase === "initialize" ? "握手" : "工具调用"}请求超时（${timeoutMs}ms）`,
        phase,
        504,
        undefined,
        phase === "initialize"
      );
    }
    throw new CozeError(
      `Coze MCP ${phase === "initialize" ? "握手" : "工具调用"}网络请求失败`,
      phase,
      undefined,
      undefined,
      phase === "initialize"
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new CozeError(
      `Coze MCP HTTP ${res.status}: ${text.slice(0, 300)}`,
      phase,
      res.status,
      undefined,
      phase === "initialize" && transientHttpStatus(res.status)
    );
  }
  const responses = res.headers.get("content-type")?.includes("event-stream")
    ? parseSseJsonRpc(text)
    : [JSON.parse(text) as JsonRpcResponse];
  const response = responses.find((r) => r.id === body.id) ?? responses[0];
  if (!response) {
    throw new CozeError(
      "Coze MCP 返回为空",
      phase,
      undefined,
      undefined,
      phase === "initialize"
    );
  }
  return { sessionId: res.headers.get("mcp-session-id"), response };
}

export interface CozeToolResult {
  /** 插件返回的结构化结果（已剥掉 code/msg 包装时的 data 层会保留原样） */
  structured: Record<string, unknown>;
  /** 原始文本 content（排错用） */
  rawText: string;
}

/** 调用扣子插件工具，自动完成 MCP 握手并解析结果 */
export async function callCozeTool(
  plugin: CozePluginKey,
  toolName: string,
  args: Record<string, unknown>,
  options: { configKey?: string } = {}
): Promise<CozeToolResult> {
  const defaultConfigKey =
    plugin === "music"
      ? "coze-music"
      : plugin === "tts"
        ? "coze-tts"
        : "coze-edit";
  const endpoint = managedCozeEndpoint(
    options.configKey ?? defaultConfigKey
  );
  const url = cozePluginUrl(plugin, endpoint);

  const init = await rpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "haitun-post-studio", version: "1.0" },
    },
  }, undefined, "initialize");
  if (init.response.error) {
    throw new CozeError(
      `Coze MCP 握手失败: ${init.response.error.message}`,
      "initialize",
      undefined,
      init.response.error.code,
      /busy|overload|rate|timeout|temporar|繁忙|超时|稍后/i.test(
        init.response.error.message
      )
    );
  }

  const call = await rpc(
    url,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    },
    init.sessionId ?? undefined,
    "tool"
  );
  if (call.response.error) {
    throw new CozeError(
      `Coze 工具调用失败: ${call.response.error.message}`,
      "tool",
      undefined,
      call.response.error.code
    );
  }

  const result = call.response.result as
    | {
        isError?: boolean;
        content?: { type: string; text?: string }[];
        structuredContent?: Record<string, unknown>;
      }
    | undefined;
  const rawText = result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  if (result?.isError) {
    throw new CozeError(
      `Coze 工具 ${toolName} 执行失败: ${rawText.slice(0, 300)}`,
      "tool"
    );
  }

  let structured = result?.structuredContent ?? {};
  if (!Object.keys(structured).length && rawText) {
    // 兜底：从 "call tool success, resp={...}" 文本中提取 JSON
    const m = rawText.match(/resp=(\{[\s\S]*\})(?:, logid=|$)/);
    if (m) {
      try {
        structured = JSON.parse(m[1]);
      } catch {}
    }
  }

  // 统一处理 {code, msg, data} 包装
  const code = structured.code;
  if (typeof code === "number" && code !== 0) {
    const msg = String(structured.msg ?? "未知错误");
    throw new CozeError(
      `Coze 工具 ${toolName} 返回错误（code=${code}）: ${msg}`,
      "tool",
      undefined,
      code
    );
  }

  return { structured, rawText };
}

export interface CozePluginHealthCheck {
  status: "healthy" | "degraded" | "offline" | "unconfigured";
  message: string;
  latencyMs: number | null;
}

/** 仅执行 MCP initialize，不调用付费工具；单次检查由管理 API 限时。 */
export async function checkCozePluginHealth(
  plugin: CozePluginKey,
  configKey: string,
  timeoutMs = 5_000
): Promise<CozePluginHealthCheck> {
  const startedAt = Date.now();
  let endpoint: string;
  try {
    endpoint = managedCozeEndpoint(configKey);
  } catch (error) {
    return {
      status: "unconfigured",
      message: error instanceof Error ? error.message : "服务尚未完成配置。",
      latencyMs: null,
    };
  }
  try {
    const init = await rpc(
      cozePluginUrl(plugin, endpoint),
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "haitun-post-studio-health", version: "1.0" },
        },
      },
      undefined,
      "initialize",
      timeoutMs
    );
    if (init.response.error) {
      return {
        status: "degraded",
        message: "MCP Endpoint 可连接，但握手返回服务错误。",
        latencyMs: Date.now() - startedAt,
      };
    }
    return {
      status: "healthy",
      message: "MCP Endpoint 与握手均正常，未调用付费工具。",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const auth = error instanceof CozeError && [401, 403].includes(error.status ?? 0);
    return {
      status: "offline",
      message: auth
        ? "MCP 鉴权失败，请检查 COZE_API_TOKEN。"
        : "MCP Endpoint 暂时无法完成握手。",
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** 取出业务数据层：兼容 {code,msg,data:{...}} 与直接平铺两种返回 */
export function cozeData(result: CozeToolResult): Record<string, unknown> {
  const s = result.structured;
  if (s.data && typeof s.data === "object" && !Array.isArray(s.data)) {
    return s.data as Record<string, unknown>;
  }
  return s;
}
