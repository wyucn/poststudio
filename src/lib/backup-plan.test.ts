import assert from "node:assert/strict";
import test from "node:test";
import { mediaBackupPlan } from "./backup-plan";

test("small media stays as one immutable backup object", () => {
  assert.deepEqual(mediaBackupPlan("asset.mp4", 20, 45), {
    mode: "direct",
    key: "media/asset.mp4",
    manifestKey: "media-checksums/asset.mp4.json",
    bytes: 20,
  });
});

test("large media is split into stable chunks with a completion manifest", () => {
  assert.deepEqual(mediaBackupPlan("asset.mp4", 100, 45), {
    mode: "chunked",
    manifestKey: "media-checksums/asset.mp4.json",
    bytes: 100,
    chunkBytes: 45,
    chunks: [
      { key: "media-chunks/asset.mp4/part-00000", offset: 0, bytes: 45 },
      { key: "media-chunks/asset.mp4/part-00001", offset: 45, bytes: 45 },
      { key: "media-chunks/asset.mp4/part-00002", offset: 90, bytes: 10 },
    ],
  });
});

test("invalid media or chunk sizes are rejected", () => {
  assert.throws(() => mediaBackupPlan("asset.mp4", -1));
  assert.throws(() => mediaBackupPlan("asset.mp4", 100, 0));
});
