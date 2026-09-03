import assert from "node:assert/strict";
import test from "node:test";
import {
  referenceAudioNeedsTranscode,
  referenceAudioTranscodeNotice,
  videoCompressionAdvice,
} from "./reference-media-guidance";

test("reference audio transcodes non-MP3 and oversized MP3 sources", () => {
  assert.equal(referenceAudioNeedsTranscode(1_000, "audio/wav"), true);
  assert.equal(referenceAudioNeedsTranscode(1_000, "audio/mpeg"), false);
  assert.equal(referenceAudioNeedsTranscode(16 * 1024 * 1024, "audio/mpeg"), true);
  assert.match(referenceAudioTranscodeNotice(16 * 1024 * 1024), /128kbps MP3/);
  assert.match(referenceAudioTranscodeNotice(null, 2), /2 段参考音频/);
});

test("video compression advice includes duration-aware executable settings", () => {
  const long = videoCompressionAdvice({
    bytes: 80 * 1024 * 1024,
    durationSeconds: 24.5,
  });
  assert.match(long, /24\.5 秒/);
  assert.match(long, /裁剪到 15 秒以内/);
  assert.match(long, /H\.264\/AAC MP4、720p/);
  assert.match(long, /Mbps/);

  const short = videoCompressionAdvice({
    bytes: 60 * 1024 * 1024,
    durationSeconds: 10,
  });
  assert.match(short, /时长无需裁剪/);

  const customLimit = videoCompressionAdvice({
    bytes: 45 * 1024 * 1024,
    durationSeconds: 10,
    maxBytes: 40 * 1024 * 1024,
  });
  assert.match(customLimit, /超过 40 MB/);
});
