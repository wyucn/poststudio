import type { Readable } from "node:stream";
import { bridgeUpload, bridgeUploadObject, type BridgedMedia } from "@/lib/coze/media-bridge";
import { HttpError } from "@/lib/http-error";
import {
  REFERENCE_AUDIO_PROVIDER_MAX_BYTES,
  REFERENCE_AUDIO_SOURCE_MAX_BYTES,
  referenceAudioNeedsTranscode,
} from "@/lib/reference-media-guidance";
import { createObjectReadStream, getObjectSize } from "@/lib/storage";
import { transcodeReferenceAudioToMp3 } from "@/lib/audio-transcode";

export interface ReferenceAudioDependencies {
  getObjectSize: (objectKey: string) => Promise<number>;
  createObjectReadStream: (objectKey: string) => Readable;
  transcodeReferenceAudioToMp3: (
    input: Readable,
    maxOutputBytes: number
  ) => Promise<Buffer>;
  bridgeUpload: (
    buffer: Buffer,
    mime: string,
    ext?: string
  ) => Promise<BridgedMedia>;
  bridgeUploadObject: (objectKey: string, mime: string) => Promise<BridgedMedia>;
}

const DEFAULT_DEPENDENCIES: ReferenceAudioDependencies = {
  getObjectSize,
  createObjectReadStream,
  transcodeReferenceAudioToMp3,
  bridgeUpload,
  bridgeUploadObject,
};

export async function bridgeReferenceAudio(
  objectKey: string,
  mime: string | null | undefined,
  dependencies: ReferenceAudioDependencies = DEFAULT_DEPENDENCIES
): Promise<BridgedMedia> {
  const bytes = await dependencies.getObjectSize(objectKey);
  if (bytes > REFERENCE_AUDIO_SOURCE_MAX_BYTES) {
    throw new HttpError(
      413,
      "参考音频超过 100 MB，请先裁剪或转换为较短的语音片段。",
      "REFERENCE_AUDIO_SOURCE_TOO_LARGE"
    );
  }
  const normalizedMime = mime?.split(";")[0].trim().toLowerCase() || null;
  if (normalizedMime && !referenceAudioNeedsTranscode(bytes, normalizedMime)) {
    return dependencies.bridgeUploadObject(objectKey, normalizedMime);
  }
  let output: Buffer;
  try {
    output = await dependencies.transcodeReferenceAudioToMp3(
      dependencies.createObjectReadStream(objectKey),
      REFERENCE_AUDIO_PROVIDER_MAX_BYTES
    );
  } catch {
    throw new HttpError(
      422,
      "参考音频自动转码失败，请先裁剪为 2-15 秒的 MP3 或 WAV 后重试。",
      "REFERENCE_AUDIO_TRANSCODE_FAILED"
    );
  }
  return dependencies.bridgeUpload(output, "audio/mpeg", "mp3");
}
