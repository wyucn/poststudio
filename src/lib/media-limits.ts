import { HttpError } from "@/lib/http-error";
import { videoCompressionAdvice } from "@/lib/reference-media-guidance";

export const DEFAULT_MEDIA_BRIDGE_MAX_BYTES = 50 * 1024 * 1024;

export function mediaBridgeMaxBytes(
  configured = process.env.MEDIA_BRIDGE_MAX_BYTES
): number {
  const parsed = Number(configured);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MEDIA_BRIDGE_MAX_BYTES;
}

export function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function assertBridgeMediaSize(
  bytes: number,
  mime: string,
  maxBytes = mediaBridgeMaxBytes()
): void {
  if (bytes <= maxBytes) return;
  if (mime.startsWith("video/")) {
    throw new HttpError(
      413,
      videoCompressionAdvice({ bytes, maxBytes }),
      "MEDIA_BRIDGE_TOO_LARGE"
    );
  }
  const mediaName = mime.startsWith("audio/")
    ? "参考音频"
    : "参考素材";
  const advice = mime.startsWith("audio/")
    ? "请裁剪时长或降低音频码率后重新上传。"
    : "请压缩后重新上传。";
  throw new HttpError(
    413,
    `${mediaName}大小为 ${formatMiB(bytes)}，超过中转服务 ${formatMiB(maxBytes)} 上限。${advice}`,
    "MEDIA_BRIDGE_TOO_LARGE"
  );
}
