import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

const DEFAULT_TIMEOUT_MS = 20_000;

function thumbnailTimeoutMs(): number {
  const configured = Number(process.env.VIDEO_THUMBNAIL_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured >= 1_000
    ? configured
    : DEFAULT_TIMEOUT_MS;
}

function runFfmpeg(args: string[]): Promise<void> {
  const executable = ffmpegPath;
  if (!executable) {
    return Promise.reject(new Error("当前平台没有可用的 FFmpeg 运行时"));
  }
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`视频缩略图生成超过 ${thumbnailTimeoutMs() / 1000} 秒`));
    }, thumbnailTimeoutMs());

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    child.once("error", (error: Error) => finish(error));
    child.once("close", (code: number | null) => {
      if (code === 0) finish();
      else finish(new Error(`FFmpeg 退出码 ${code}: ${stderr.trim().slice(-1_000)}`));
    });
  });
}

/** Generate an atomic 640px WebP poster from a local video file. */
export async function renderVideoThumbnail(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const nonce = `${process.pid}-${randomUUID()}`;
  const framePath = `${targetPath}.${nonce}.png`;
  const tempPath = `${targetPath}.${nonce}.partial.webp`;
  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0.1",
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-an",
      "-y",
      framePath,
    ]);
    await sharp(framePath)
      .rotate()
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(tempPath);
    await fs.rename(tempPath, targetPath).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  } finally {
    await Promise.all([
      fs.rm(framePath, { force: true }),
      fs.rm(tempPath, { force: true }),
    ]);
  }
}
