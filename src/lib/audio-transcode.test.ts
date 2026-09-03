import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import { transcodeReferenceAudioToMp3 } from "./audio-transcode";

function silentWav(durationSeconds = 1, sampleRate = 8_000): Buffer {
  const samples = Math.floor(durationSeconds * sampleRate);
  const dataBytes = samples * 2;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataBytes, 40);
  return output;
}

test("FFmpeg converts a WAV reference to bounded MP3 output", async (t) => {
  if (!ffmpegPath) return t.skip("FFmpeg is unavailable on this platform");
  const output = await transcodeReferenceAudioToMp3(
    Readable.from(silentWav()),
    2 * 1024 * 1024
  );
  assert.ok(output.length > 0);
  assert.ok(
    output.subarray(0, 3).toString("ascii") === "ID3" ||
      (output[0] === 0xff && (output[1] & 0xe0) === 0xe0)
  );
});
