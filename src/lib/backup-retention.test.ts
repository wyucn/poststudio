import assert from "node:assert/strict";
import test from "node:test";
import type { Asset } from "@/db/schema";
import {
  createAssetBackupTombstone,
  createLegacyBackupTombstone,
  isBackupTombstoneDue,
  MEDIA_BACKUP_RETENTION_MS,
  planBackupDeletionReconciliation,
} from "./backup-retention";

const asset: Asset = {
  id: "asset",
  projectId: "project",
  userId: "user",
  kind: "image",
  objectKey: "asset.png",
  mime: "image/png",
  bytes: 12,
  textContent: null,
  metaJson: "{}",
  sourceTaskId: null,
  reviewStatus: null,
  favorite: false,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
};

test("asset deletion tombstones retain the recoverable snapshot for 30 days", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");
  const tombstone = createAssetBackupTombstone(asset, now);
  assert.equal(tombstone.objectKey, "asset.png");
  assert.equal(tombstone.assetId, "asset");
  assert.equal(JSON.parse(tombstone.assetJson ?? "{}").id, "asset");
  assert.equal(
    tombstone.purgeAfter.getTime() - tombstone.deletedAt.getTime(),
    MEDIA_BACKUP_RETENTION_MS
  );
  assert.equal(
    isBackupTombstoneDue(
      tombstone,
      new Date(tombstone.purgeAfter.getTime() - 1)
    ),
    false
  );
  assert.equal(isBackupTombstoneDue(tombstone, tombstone.purgeAfter), true);
});

test("legacy reconciliation starts a fresh retention window and rejects paths", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");
  const tombstone = createLegacyBackupTombstone("legacy.mp4", now);
  assert.equal(tombstone.assetId, null);
  assert.equal(tombstone.assetJson, null);
  assert.equal(tombstone.purgeAfter.getTime(), now.getTime() + MEDIA_BACKUP_RETENTION_MS);
  assert.throws(() => createLegacyBackupTombstone("../legacy.mp4", now));
});

test("deletion reconciliation never confuses missing active backups with deletions", () => {
  const plan = planBackupDeletionReconciliation({
    remoteNames: ["active.png", "deleted.mp4", "known-tombstone.wav"],
    activeNames: ["active.png", "missing.jpg"],
    tombstoneNames: ["known-tombstone.wav"],
  });
  assert.deepEqual(plan.missingRemoteBackups, ["missing.jpg"]);
  assert.deepEqual(plan.untrackedRemoteBackups, ["deleted.mp4"]);
});
