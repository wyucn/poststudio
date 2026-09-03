/**
 * 媒体存储层：默认本地磁盘（DATA_DIR/media）。
 * 接口刻意保持 S3 形状，后续迁移 MinIO/S3 时只需替换实现。
 */
import path from "node:path";
import {
  createReadStream,
  createWriteStream,
  type ReadStream,
} from "node:fs";
import fs from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DATA_DIR } from "@/db";

const MEDIA_DIR = path.join(DATA_DIR, "media");

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
};

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.split(";")[0].trim()] ?? "bin";
}

/** 保存 buffer，返回 objectKey */
export async function putObject(
  id: string,
  buffer: Buffer,
  mime: string
): Promise<{ objectKey: string; bytes: number }> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const objectKey = `${id}.${extForMime(mime)}`;
  await fs.writeFile(path.join(MEDIA_DIR, objectKey), buffer);
  return { objectKey, bytes: buffer.length };
}

export class ObjectTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`媒体文件超过 ${maxBytes} 字节限制`);
  }
}

export class InvalidFileContentError extends Error {
  constructor(message = "文件内容与声明的类型不符") {
    super(message);
  }
}

/**
 * 通过文件头 magic bytes 校验真实类型，防止把任意内容伪造成白名单 MIME 上传。
 * 只做「大类」判定（图片 / 视频 / 音频容器），不追求精确到具体编码。
 */
export function sniffKind(head: Buffer): "image" | "video" | "audio" | "unknown" {
  const b = head;
  const ascii = (start: number, s: string) =>
    b.length >= start + s.length &&
    b.toString("latin1", start, start + s.length) === s;

  // 图片
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, "PNG")) return "image";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image"; // JPEG
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image";

  // 视频 / 音频容器
  if (b.length >= 12 && ascii(4, "ftyp")) {
    // ISO-BMFF：mp4 / mov / m4a 共享 ftyp，用 brand 粗分音频
    const brand = b.toString("latin1", 8, 12);
    if (brand.startsWith("M4A") || brand.startsWith("m4a")) return "audio";
    return "video";
  }
  if (ascii(0, "\x1aE\xdf\xa3")) return "video"; // Matroska/WebM (EBML)
  if (ascii(0, "RIFF") && ascii(8, "AVI ")) return "video";

  // 音频
  if (ascii(0, "ID3")) return "audio"; // MP3 with ID3
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio"; // MPEG audio frame
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio";
  if (ascii(0, "fLaC")) return "audio";
  if (ascii(0, "OggS")) return "audio";

  return "unknown";
}

/** 边读边写媒体，使用临时文件保证失败时不会留下不完整对象。 */
export async function putObjectStream(
  id: string,
  stream: ReadableStream<Uint8Array>,
  mime: string,
  maxBytes?: number,
  /** 校验文件头前 N 字节；返回 false 则中止上传（内容与声明类型不符） */
  validateHead?: (head: Buffer) => boolean
): Promise<{ objectKey: string; bytes: number }> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const objectKey = `${id}.${extForMime(mime)}`;
  const finalPath = path.join(MEDIA_DIR, objectKey);
  const tempPath = `${finalPath}.partial`;
  let bytes = 0;
  let headChecked = !validateHead;
  const headChunks: Buffer[] = [];
  let headLen = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (maxBytes !== undefined && bytes > maxBytes) {
        callback(new ObjectTooLargeError(maxBytes));
        return;
      }
      if (!headChecked) {
        headChunks.push(chunk);
        headLen += chunk.length;
        if (headLen >= 16) {
          if (!validateHead!(Buffer.concat(headChunks))) {
            callback(new InvalidFileContentError());
            return;
          }
          headChecked = true;
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      // 文件短于 16 字节时也要校验一次
      if (!headChecked && validateHead!(Buffer.concat(headChunks))) {
        headChecked = true;
      }
      if (!headChecked) {
        callback(new InvalidFileContentError());
        return;
      }
      callback();
    },
  });

  try {
    const source = Readable.fromWeb(
      stream as Parameters<typeof Readable.fromWeb>[0]
    );
    await pipeline(source, counter, createWriteStream(tempPath, { flags: "wx" }));
    await fs.rename(tempPath, finalPath);
    return { objectKey, bytes };
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/** 删除媒体文件（文件不存在时静默成功） */
export async function deleteObject(objectKey: string): Promise<void> {
  const safe = path.basename(objectKey);
  await fs.rm(path.join(MEDIA_DIR, safe), { force: true });
}

export async function getObject(objectKey: string): Promise<Buffer> {
  // 防目录穿越
  const safe = path.basename(objectKey);
  return fs.readFile(path.join(MEDIA_DIR, safe));
}

/** 获取对象大小，不把媒体读入内存。 */
export async function getObjectSize(objectKey: string): Promise<number> {
  const safe = path.basename(objectKey);
  return (await fs.stat(path.join(MEDIA_DIR, safe))).size;
}

/** 创建媒体文件流；start/end 为包含端点，用于 HTTP Range。 */
export function createObjectReadStream(
  objectKey: string,
  range?: { start: number; end: number }
): ReadStream {
  const safe = path.basename(objectKey);
  return createReadStream(path.join(MEDIA_DIR, safe), range);
}

/** Node 流转 Web 流，并在客户端取消请求时及时销毁源流，避免重复 close。 */
export function nodeReadStreamToWeb(stream: ReadStream): ReadableStream<Uint8Array> {
  let settled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        try {
          const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          controller.enqueue(new Uint8Array(buffer));
        } catch {
          settled = true;
          stream.destroy();
        }
      });
      stream.once("end", () => {
        if (settled) return;
        settled = true;
        controller.close();
      });
      stream.once("error", (error) => {
        if (settled) return;
        settled = true;
        controller.error(error);
      });
    },
    cancel() {
      settled = true;
      stream.destroy();
    },
  });
}

/** 读取媒体为 data URI（用于把本地素材作为参考图传给方舟） */
export async function getObjectAsDataUri(
  objectKey: string,
  mime: string
): Promise<string> {
  const buf = await getObject(objectKey);
  return `data:${mime};base64,${buf.toString("base64")}`;
}
