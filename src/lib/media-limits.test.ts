import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./http-error";
import {
  DEFAULT_MEDIA_BRIDGE_MAX_BYTES,
  assertBridgeMediaSize,
  mediaBridgeMaxBytes,
} from "./media-limits";

test("bridge limit falls back when configuration is invalid", () => {
  assert.equal(mediaBridgeMaxBytes(""), DEFAULT_MEDIA_BRIDGE_MAX_BYTES);
  assert.equal(mediaBridgeMaxBytes("not-a-number"), DEFAULT_MEDIA_BRIDGE_MAX_BYTES);
  assert.equal(mediaBridgeMaxBytes("1048576"), 1048576);
});

test("oversized media is rejected before bridge upload", () => {
  assert.throws(
    () => assertBridgeMediaSize(51 * 1024 * 1024, "video/mp4", 50 * 1024 * 1024),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      assert.equal(error.code, "MEDIA_BRIDGE_TOO_LARGE");
      assert.match(error.message, /参考视频/);
      assert.match(error.message, /50 MB/);
      return true;
    }
  );

  assert.throws(
    () => assertBridgeMediaSize(41 * 1024 * 1024, "video/mp4", 40 * 1024 * 1024),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, /超过 40 MB/);
      assert.doesNotMatch(error.message, /超过 50 MB/);
      return true;
    }
  );
});
