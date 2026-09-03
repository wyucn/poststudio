import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSET_UPLOAD_MAX_BYTES,
  inferUploadMime,
  validateUploadCandidate,
} from "./media-policy";

test("upload MIME falls back to the file extension when browsers omit it", () => {
  assert.equal(inferUploadMime("voice.M4A"), "audio/x-m4a");
  assert.equal(inferUploadMime("shot.mov", "application/octet-stream"), "video/quicktime");
});

test("default upload limits are enforced before a request starts", () => {
  assert.throws(
    () =>
      validateUploadCandidate({
        name: "large.png",
        type: "image/png",
        size: ASSET_UPLOAD_MAX_BYTES.image + 1,
      }),
    /超过 20 MB 上限/
  );
});

test("scenario-specific limits and allowed media kinds are enforced", () => {
  assert.throws(
    () =>
      validateUploadCandidate(
        { name: "reference.wav", type: "audio/wav", size: 21 * 1024 * 1024 },
        ["audio"],
        20
      ),
    /超过 20 MB 上限/
  );
  assert.throws(
    () =>
      validateUploadCandidate(
        { name: "clip.mp4", type: "video/mp4", size: 1024 },
        ["audio"]
      ),
    /不支持/
  );
});
