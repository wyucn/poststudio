/** 临时调研脚本：列出 Coze 插件的全部 MCP 工具及参数 schema */
import { config } from "dotenv";
config();

const MCP_BASE = process.env.COZE_MCP_BASE_URL || "https://mcp.coze.cn/v1/plugins";
const PLUGINS: Record<string, string> = {
  videoEdit: process.env.COZE_VIDEO_EDIT_PLUGIN_ID || "",
  music: process.env.COZE_MUSIC_PLUGIN_ID || "",
  tts: process.env.COZE_TTS_PLUGIN_ID || "",
};

function parseSse(text: string) {
  const out: unknown[] = [];
  for (const chunk of text.split("\n\n")) {
    const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
    if (!dataLine) continue;
    try {
      out.push(JSON.parse(dataLine.replace(/^data:\s*/, "")));
    } catch {}
  }
  return out as { id?: number; result?: Record<string, unknown> }[];
}

async function rpc(url: string, body: Record<string, unknown>, sessionId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${process.env.COZE_API_TOKEN}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  const responses = res.headers.get("content-type")?.includes("event-stream")
    ? parseSse(text)
    : [JSON.parse(text)];
  return {
    sessionId: res.headers.get("mcp-session-id"),
    response: responses.find((r) => r.id === body.id) ?? responses[0],
  };
}

async function listTools(name: string, pluginId: string) {
  const url = `${MCP_BASE}/${pluginId}`;
  const init = await rpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "haitun-probe", version: "1.0" },
    },
  });
  const list = await rpc(
    url,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    init.sessionId ?? undefined
  );
  const tools = (list.response.result?.tools ?? []) as {
    name: string;
    description?: string;
    inputSchema?: unknown;
  }[];
  console.log(`\n========== ${name} (${pluginId}) — ${tools.length} tools ==========`);
  for (const t of tools) {
    console.log(`\n--- ${t.name}`);
    console.log(`desc: ${(t.description ?? "").slice(0, 400)}`);
    console.log(`schema: ${JSON.stringify(t.inputSchema).slice(0, 1500)}`);
  }
}

async function main() {
  for (const [name, id] of Object.entries(PLUGINS)) {
    await listTools(name, id);
  }
}
void main();
