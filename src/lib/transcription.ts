import { HttpError } from "@/lib/http-error";

export const AUDIO_TRANSCRIPTION_MODEL_KEY = "coze-audio-transcription";
export const MAX_TRANSCRIPTION_SUBTITLE_BYTES = 2 * 1024 * 1024;

const TIMESTAMP_LINE =
  /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}(?:\s+.*)?$/;

function stripSubtitleMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/** 把 SRT / WebVTT 字幕转换为适合校对的逐段纯文本。 */
export function plainTextFromSubtitle(input: string): string {
  const normalized = input
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim();
  if (!normalized) return "";

  const blocks = normalized
    .replace(/^WEBVTT(?:\s+.*)?\n+/i, "")
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (/^\d+$/.test(lines[0] ?? "")) lines.shift();
      const timestampIndex = lines.findIndex((line) => TIMESTAMP_LINE.test(line));
      if (timestampIndex >= 0) lines.splice(timestampIndex, 1);
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/i.test(lines[0] ?? "")) return "";
      return stripSubtitleMarkup(lines.join("\n")).trim();
    })
    .filter(Boolean);

  if (blocks.length) return blocks.join("\n");
  return stripSubtitleMarkup(normalized).trim();
}

/** 兼容 Coze 直接平铺或嵌套包装的字幕 URL 字段。 */
export function subtitleUrlFromResult(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of ["url", "subtitle_url", "subtitleUrl", "link"]) {
    const candidate = row[key];
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }
  for (const nested of Object.values(row)) {
    const candidate = subtitleUrlFromResult(nested);
    if (candidate) return candidate;
  }
  return null;
}

export async function downloadSubtitleText(
  url: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(
      502,
      "语音转写服务未返回有效结果，请稍后重试。",
      "TRANSCRIPTION_RESULT_INVALID"
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(
      502,
      "语音转写服务未返回有效结果，请稍后重试。",
      "TRANSCRIPTION_RESULT_INVALID"
    );
  }

  let response: Response;
  try {
    response = await fetcher(parsed, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HttpError(
      503,
      "语音转写结果暂时无法下载，请稍后重试。",
      "TRANSCRIPTION_RESULT_UNAVAILABLE"
    );
  }
  if (!response.ok) {
    throw new HttpError(
      503,
      "语音转写结果暂时无法下载，请稍后重试。",
      "TRANSCRIPTION_RESULT_UNAVAILABLE"
    );
  }
  const declaredBytes = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredBytes) &&
    declaredBytes > MAX_TRANSCRIPTION_SUBTITLE_BYTES
  ) {
    throw new HttpError(
      502,
      "语音转写结果异常，请缩短音频后重试。",
      "TRANSCRIPTION_RESULT_TOO_LARGE"
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_TRANSCRIPTION_SUBTITLE_BYTES) {
    throw new HttpError(
      502,
      "语音转写结果异常，请缩短音频后重试。",
      "TRANSCRIPTION_RESULT_TOO_LARGE"
    );
  }
  return text;
}
