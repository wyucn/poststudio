import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import type { Asset } from "@/db";

function createFixture(target: string): Promise<void> {
  const executable = ffmpegPath;
  if (!executable) return Promise.reject(new Error("FFmpeg unavailable"));
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x84cc16:s=160x90:d=0.4",
        "-pix_fmt",
        "yuv420p",
        "-y",
        target,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.once("error", reject);
    child.once("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `FFmpeg fixture exited ${code}`));
    });
  });
}

test("uploaded videos without a source task get a persisted poster", async (t) => {
  if (!ffmpegPath) return t.skip("FFmpeg is unavailable on this platform");
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "haitun-upload-thumb-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const assetId = "uploaded-video";
  const objectKey = "uploaded.mp4";
  const video = path.join(dataDir, "media", objectKey);
  let closeDb: (() => void) | undefined;

  try {
    await fs.mkdir(path.dirname(video), { recursive: true });
    await createFixture(video);
    const { ensureAssetThumbnail } = await import("./thumbnails");
    const { db } = await import("@/db");
    closeDb = () =>
      (db as unknown as { $client: { close(): void } }).$client.close();
    const asset: Asset = {
      id: assetId,
      projectId: "project",
      userId: "user",
      kind: "video",
      objectKey,
      mime: "video/mp4",
      bytes: 1,
      textContent: null,
      metaJson: "{}",
      sourceTaskId: null,
      reviewStatus: null,
      favorite: false,
      createdAt: new Date(),
    };

    const poster = await ensureAssetThumbnail(asset);
    assert.equal(poster, path.join(dataDir, "thumbnails", `${assetId}.webp`));
    const metadata = await sharp(await fs.readFile(poster!)).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 160);
    assert.equal(metadata.height, 90);
  } finally {
    closeDb?.();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
