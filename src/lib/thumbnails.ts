import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { DATA_DIR, assets, db, type Asset } from "@/db";
import { errorDiagnostic } from "@/lib/error-safety";
import { renderVideoThumbnail } from "@/lib/video-thumbnail";

const MEDIA_DIR = path.join(DATA_DIR, "media");
const THUMB_DIR = path.join(DATA_DIR, "thumbnails");
const pending = new Map<string, Promise<string>>();
const videoFailures = new Map<string, number>();
const VIDEO_FAILURE_TTL_MS = 10 * 60 * 1000;
const VIDEO_THUMBNAIL_CONCURRENCY = 2;
const videoQueue: Array<() => Promise<void>> = [];
let activeVideoJobs = 0;

function drainVideoQueue() {
  while (activeVideoJobs < VIDEO_THUMBNAIL_CONCURRENCY && videoQueue.length) {
    const job = videoQueue.shift()!;
    activeVideoJobs++;
    void job().finally(() => {
      activeVideoJobs--;
      drainVideoQueue();
    });
  }
}

function enqueueVideoThumbnail<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    videoQueue.push(async () => {
      try {
        resolve(await work());
      } catch (error) {
        reject(error);
      }
    });
    drainVideoQueue();
  });
}

async function buildThumbnail(assetId: string, objectKey: string): Promise<string> {
  const target = path.join(THUMB_DIR, `${path.basename(assetId)}.webp`);
  try {
    await fs.access(target);
    return target;
  } catch {}
  await fs.mkdir(THUMB_DIR, { recursive: true });
  const source = path.join(MEDIA_DIR, path.basename(objectKey));
  const temp = `${target}.${process.pid}.partial`;
  await sharp(source)
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(temp);
  await fs.rename(temp, target).catch(async (error: NodeJS.ErrnoException) => {
    await fs.rm(temp, { force: true });
    if (error.code !== "EEXIST") throw error;
  });
  return target;
}

export async function ensureImageThumbnail(
  assetId: string,
  objectKey: string
): Promise<string> {
  const existing = pending.get(assetId);
  if (existing) return existing;
  const promise = buildThumbnail(assetId, objectKey).finally(() => pending.delete(assetId));
  pending.set(assetId, promise);
  return promise;
}

async function ensureVideoThumbnail(
  assetId: string,
  objectKey: string
): Promise<string> {
  const target = path.join(THUMB_DIR, `${path.basename(assetId)}.webp`);
  try {
    await fs.access(target);
    return target;
  } catch {}

  const existing = pending.get(assetId);
  if (existing) return existing;
  const source = path.join(MEDIA_DIR, path.basename(objectKey));
  const promise = enqueueVideoThumbnail(async () => {
    // Another queued request may have completed while this item was waiting.
    try {
      await fs.access(target);
      return target;
    } catch {}
    await renderVideoThumbnail(source, target);
    return target;
  }).finally(() => pending.delete(assetId));
  pending.set(assetId, promise);
  return promise;
}

function isLastFrame(asset: Asset): boolean {
  try {
    return (JSON.parse(asset.metaJson) as { role?: string }).role === "last_frame";
  } catch {
    return false;
  }
}

/**
 * Resolve the best persisted preview for an asset. Generated Seedance videos
 * reuse the watermark-free last frame saved under the same source task, so
 * list views do not have to mount and seek the full video.
 */
export async function ensureAssetThumbnail(asset: Asset): Promise<string | null> {
  if (!asset.objectKey) return null;
  if (asset.kind === "image") {
    return ensureImageThumbnail(asset.id, asset.objectKey);
  }
  if (asset.kind !== "video") return null;

  const lastFrame = asset.sourceTaskId
    ? db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.sourceTaskId, asset.sourceTaskId),
            eq(assets.projectId, asset.projectId),
            eq(assets.kind, "image")
          )
        )
        .all()
        .find((candidate) => candidate.objectKey && isLastFrame(candidate))
    : undefined;

  return lastFrame?.objectKey
    ? ensureImageThumbnail(asset.id, lastFrame.objectKey)
    : (() => {
        const failedUntil = videoFailures.get(asset.id) ?? 0;
        if (failedUntil > Date.now()) return null;
        return ensureVideoThumbnail(asset.id, asset.objectKey!).catch((error) => {
          videoFailures.set(asset.id, Date.now() + VIDEO_FAILURE_TTL_MS);
          console.error(
            `[thumbnail] 视频 ${asset.id} 缩略图生成失败:`,
            errorDiagnostic(error)
          );
          return null;
        });
      })();
}

export async function deleteImageThumbnail(assetId: string): Promise<void> {
  videoFailures.delete(assetId);
  await fs.rm(path.join(THUMB_DIR, `${path.basename(assetId)}.webp`), { force: true });
}
