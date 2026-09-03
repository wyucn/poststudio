export const COZE_MCP_BASE_URL = process.env.COZE_MCP_BASE_URL?.trim() || "https://mcp.coze.cn/v1/plugins";

export const COZE_PLUGIN_IDS = {
  /** Doubao-音乐生成（lyrics_gen_song / gen_song / gen_bgm） */
  music: process.env.COZE_MUSIC_PLUGIN_ID?.trim() || "",
  /** 视频剪辑工具（video_trim / concat_videos / compile_video_audio 等） */
  videoEdit: process.env.COZE_VIDEO_EDIT_PLUGIN_ID?.trim() || "",
  /** 语音合成（speech_synthesis） */
  tts: process.env.COZE_TTS_PLUGIN_ID?.trim() || "",
} as const;

export type CozePluginKey = keyof typeof COZE_PLUGIN_IDS;

/** 管理配置可保存插件 ID，也可保存完整 HTTPS MCP 地址。 */
export function cozePluginUrl(
  plugin: CozePluginKey,
  endpoint: string = COZE_PLUGIN_IDS[plugin]
): string {
  const value = endpoint.trim();
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, "");
  return `${COZE_MCP_BASE_URL}/${value}`;
}
