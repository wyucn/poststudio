import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";

export const REFERENCE_AUDIO_TRANSCODE_TIMEOUT_MS = 45_000;

export async function transcodeReferenceAudioToMp3(
  input: Readable,
  maxOutputBytes: number,
  timeoutMs = REFERENCE_AUDIO_TRANSCODE_TIMEOUT_MS
): Promise<Buffer> {
  const executable = ffmpegPath;
  if (!executable) throw new Error("FFmpeg 不可用");
  return new Promise<Buffer>((resolve, reject) => {
    const child: ChildProcess = spawn(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-b:a",
        "128k",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, output?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.destroy();
      if (error) reject(error);
      else resolve(output ?? Buffer.alloc(0));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("参考音频转码超时"));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        finish(new Error("参考音频转码后仍超过模型限制"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.stdin?.on("error", () => {
      // FFmpeg 提前退出或超限终止时，输入流可能收到 EPIPE。
    });
    child.on("error", (error: Error) => finish(error));
    child.on("close", (code: number | null) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error(`参考音频转码失败（${code}）：${stderr || "未知错误"}`));
        return;
      }
      const output = Buffer.concat(chunks);
      if (!output.length) {
        finish(new Error("参考音频转码未产生输出"));
        return;
      }
      finish(undefined, output);
    });
    input.on("error", (error) => {
      child.kill("SIGKILL");
      finish(error);
    });
    if (!child.stdin) {
      finish(new Error("FFmpeg 输入流不可用"));
      return;
    }
    input.pipe(child.stdin);
  });
}
