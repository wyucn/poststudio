export const REFERENCE_AUDIO_PROVIDER_MAX_BYTES = 15 * 1024 * 1024;
export const REFERENCE_AUDIO_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
export const REFERENCE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function referenceAudioNeedsTranscode(
  bytes: number,
  mime: string | null | undefined
): boolean {
  const normalized = mime?.split(";")[0].trim().toLowerCase();
  return (
    bytes > REFERENCE_AUDIO_PROVIDER_MAX_BYTES ||
    (normalized !== "audio/mpeg" && normalized !== "audio/mp3")
  );
}

export function referenceAudioTranscodeNotice(
  bytes: number | null | undefined,
  count = 1
): string {
  if (count > 1) {
    return `${count} 段参考音频提交时会自动转为单声道 44.1kHz、128kbps MP3；原素材不会修改。`;
  }
  const size = typeof bytes === "number" && bytes > 0 ? ` ${formatMiB(bytes)}` : "";
  return `参考音频${size}，提交时会自动转为单声道 44.1kHz、128kbps MP3；原素材不会修改。`;
}

export function videoCompressionAdvice(input: {
  bytes: number;
  durationSeconds?: number;
  maxBytes?: number;
}): string {
  const duration = input.durationSeconds;
  const maxBytes = input.maxBytes ?? REFERENCE_VIDEO_MAX_BYTES;
  const effectiveDuration =
    duration && Number.isFinite(duration) && duration > 0
      ? Math.min(duration, 15)
      : 15;
  const containerBudgetMbps =
    (maxBytes * 8 * 0.9) / effectiveDuration / 1_000_000;
  const recommendedMbps = Math.max(1, Math.min(6, Math.floor(containerBudgetMbps)));
  const durationAdvice =
    duration && duration > 15
      ? `素材时长 ${duration.toFixed(1)} 秒，请先裁剪到 15 秒以内；`
      : "时长无需裁剪时，";
  return `参考视频大小为 ${formatMiB(input.bytes)}，超过 ${formatMiB(maxBytes)}。${durationAdvice}建议导出 H.264/AAC MP4、720p，视频码率不高于约 ${recommendedMbps} Mbps。`;
}
