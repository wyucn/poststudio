import type { MusicMode } from "./plugins";

/**
 * Coze 音乐插件的文本边界。
 *
 * gen_song / gen_bgm 的官方 schema 写的是“小于 500 个字符”，所以本站
 * 按可安全提交的 499 个字符处理；lyrics_gen_song 明确允许 5–700 个字符。
 */
export const MUSIC_TEXT_LIMITS: Record<
  MusicMode,
  { min: number; max: number; label: string }
> = {
  song: { min: 5, max: 499, label: "灵感提示词" },
  lyrics_song: { min: 5, max: 700, label: "歌词" },
  bgm: { min: 5, max: 499, label: "背景音乐描述" },
};

/** Count Unicode code points rather than UTF-16 code units. */
export function musicTextLength(value: string): number {
  return Array.from(value).length;
}

export function musicTextLimitMessage(mode: MusicMode): string {
  const limit = MUSIC_TEXT_LIMITS[mode];
  if (mode === "lyrics_song") {
    return `${limit.label}最多 ${limit.max} 字。`;
  }
  return `${limit.label}最多 ${limit.max} 字（音乐服务要求少于 500 个字符）。`;
}

export function musicTextMinimumMessage(mode: MusicMode): string {
  const limit = MUSIC_TEXT_LIMITS[mode];
  return `${limit.label}至少填写 ${limit.min} 字。`;
}

/** Return a user-safe validation message, or null when the value is valid. */
export function musicTextValidationMessage(
  mode: MusicMode,
  value: string
): string | null {
  const length = musicTextLength(value);
  const limit = MUSIC_TEXT_LIMITS[mode];
  if (length < limit.min) return musicTextMinimumMessage(mode);
  if (length > limit.max) return musicTextLimitMessage(mode);
  return null;
}

/**
 * Coze sometimes reports parameter validation as a tool error instead of a
 * structured FailureReason. Keep those errors actionable for music tasks.
 */
export function isMusicTextLimitErrorMessage(message: string): boolean {
  const value = message.normalize("NFKC").toLowerCase();
  if (!value) return false;

  // Do not confuse service rate/credit limits with an input-length limit.
  if (/(rate\s*limit|quota|限流|额度|频繁|繁忙)/i.test(value)) return false;

  const hasLengthSignal =
    /(character|characters|chars?\b|length|too\s+long|exceed|maximum|max(?:imum)?|超过|上限|字数|字符|长度|过长|限制)/i.test(
      value
    );
  if (!hasLengthSignal) return false;

  return (
    /(prompt|lyrics|text|music|song|bgm|歌词|提示词|音乐|文本|参数)/i.test(value) ||
    /\b(?:499|500|700)\b/.test(value)
  );
}
