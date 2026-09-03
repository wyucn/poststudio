import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { renderVideoThumbnail } from "./video-thumbnail";

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

test("renders a valid WebP poster from video", async (t) => {
  if (!ffmpegPath) return t.skip("FFmpeg is unavailable on this platform");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "haitun-video-thumb-"));
  const video = path.join(dir, "fixture.mp4");
  const poster = path.join(dir, "poster.webp");
  try {
    await createFixture(video);
    await renderVideoThumbnail(video, poster);
    const metadata = await sharp(await fs.readFile(poster)).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 160);
    assert.equal(metadata.height, 90);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
