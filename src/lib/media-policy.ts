export type UploadMediaKind = "image" | "video" | "audio";

export const ASSET_UPLOAD_MAX_BYTES: Record<UploadMediaKind, number> = {
  image: 20 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  video: 500 * 1024 * 1024,
};

export const UPLOAD_ACCEPT_BY_KIND: Record<UploadMediaKind, string> = {
  image: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
  video: "video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv",
  audio:
    "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/x-m4a,audio/mp4,audio/flac,audio/ogg,.mp3,.wav,.m4a,.flac,.ogg",
};

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
]);
const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/flac",
  "audio/ogg",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/x-m4a",
  flac: "audio/flac",
  ogg: "audio/ogg",
};

const KIND_NAME: Record<UploadMediaKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

export function uploadKindForMime(mime: string): UploadMediaKind | null {
  const normalized = mime.split(";")[0].trim().toLowerCase();
  if (IMAGE_MIMES.has(normalized)) return "image";
  if (VIDEO_MIMES.has(normalized)) return "video";
  if (AUDIO_MIMES.has(normalized)) return "audio";
  return null;
}

export function inferUploadMime(name: string, declaredMime?: string): string {
  const declared = declaredMime?.split(";")[0].trim().toLowerCase() ?? "";
  if (uploadKindForMime(declared)) return declared;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return (MIME_BY_EXTENSION[extension] ?? declared) || "application/octet-stream";
}

export interface UploadCandidate {
  name: string;
  size: number;
  type?: string;
}

export interface ValidatedUpload {
  kind: UploadMediaKind;
  mime: string;
  maxBytes: number;
}

export function validateUploadCandidate(
  file: UploadCandidate,
  allowedKinds: UploadMediaKind[] = ["image", "video", "audio"],
  maxFileSizeMb?: number
): ValidatedUpload {
  const mime = inferUploadMime(file.name, file.type);
  const kind = uploadKindForMime(mime);
  if (!kind || !allowedKinds.includes(kind)) {
    throw new Error(`不支持“${file.name}”的文件类型`);
  }
  const maxBytes = maxFileSizeMb
    ? maxFileSizeMb * 1024 * 1024
    : ASSET_UPLOAD_MAX_BYTES[kind];
  if (file.size > maxBytes) {
    const actual = (file.size / 1024 / 1024).toFixed(file.size < 10 * 1024 * 1024 ? 1 : 0);
    const limit = Math.round(maxBytes / 1024 / 1024);
    throw new Error(`${KIND_NAME[kind]}为 ${actual} MB，超过 ${limit} MB 上限`);
  }
  return { kind, mime, maxBytes };
}
