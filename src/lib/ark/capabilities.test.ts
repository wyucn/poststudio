import assert from "node:assert/strict";
import test from "node:test";
import {
  VIDEO_FRAMES,
  isValidVideoFrames,
  videoCap,
  videoDurationFromFrames,
  videoPx,
} from "./capabilities";
import { getModel } from "./models";

test("Seedance 1.0 exposes the official frames capability", () => {
  const cap = videoCap("seedance-1.0-pro");

  assert.deepEqual(cap.frames, VIDEO_FRAMES);
  assert.equal(cap.duration.min, 2);
  assert.equal(cap.duration.max, 12);
  assert.equal(cap.smartDuration, false);
  assert.equal(getModel("seedance-1.0-pro").endpointId, "doubao-seedance-1-0-pro-250528");
});

test("Seedance 1.0 Fast only exposes the first-frame mode", () => {
  const cap = videoCap("seedance-1.0-pro-fast");

  assert.deepEqual(cap.modes, ["t2v", "first_frame"]);
  assert.deepEqual(cap.frames, VIDEO_FRAMES);
});

test("video frame values follow the 29-289, step-4 contract", () => {
  for (const value of [29, 33, 57, 289]) {
    assert.equal(isValidVideoFrames(value), true, `${value} should be valid`);
  }
  for (const value of [28, 30, 58, 290, 57.5]) {
    assert.equal(isValidVideoFrames(value), false, `${value} should be invalid`);
  }
  assert.equal(videoDurationFromFrames(57), 2.375);
  assert.equal(
    isValidVideoFrames(25, { min: 25, max: 101, step: 4, fps: 24 }),
    true
  );
  assert.equal(
    isValidVideoFrames(29, { min: 25, max: 101, step: 4, fps: 24 }),
    true
  );
  assert.equal(
    isValidVideoFrames(30, { min: 25, max: 101, step: 4, fps: 24 }),
    false
  );
});

test("Seedance 1.0 uses its model-specific output pixel table", () => {
  assert.equal(videoPx("720p", "16:9", "seedance-1.0-pro"), "1248x704");
  assert.equal(videoPx("720p", "16:9", "seedance-1.5-pro"), "1280x720");
});
