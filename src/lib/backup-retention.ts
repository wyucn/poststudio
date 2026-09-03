import path from "node:path";
import type { Asset } from "@/db/schema";
import type { backupMediaTombstones } from "@/db/schema";

export const MEDIA_BACKUP_RETENTION_DAYS = 30;
export const MEDIA_BACKUP_RETENTION_MS =
  MEDIA_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type BackupMediaTombstoneInsert =
  typeof backupMediaTombstones.$inferInsert;

function safeObjectKey(objectKey: string): string {
  const safe = path.basename(objectKey);
  if (!safe || safe !== objectKey) {
    throw new Error("媒体对象名无效");
  }
  return safe;
}

export function createAssetBackupTombstone(
  asset: Asset,
  now = new Date()
): BackupMediaTombstoneInsert {
  if (!asset.objectKey) throw new Error("素材没有媒体对象");
  return {
    objectKey: safeObjectKey(asset.objectKey),
    assetId: asset.id,
    assetJson: JSON.stringify(asset),
    deletedAt: now,
    purgeAfter: new Date(now.getTime() + MEDIA_BACKUP_RETENTION_MS),
    remotePurgedAt: null,
  };
}

export function createLegacyBackupTombstone(
  objectKey: string,
  now = new Date()
): BackupMediaTombstoneInsert {
  return {
    objectKey: safeObjectKey(objectKey),
    assetId: null,
    assetJson: null,
    deletedAt: now,
    purgeAfter: new Date(now.getTime() + MEDIA_BACKUP_RETENTION_MS),
    remotePurgedAt: null,
  };
}

export function isBackupTombstoneDue(
  tombstone: Pick<
    BackupMediaTombstoneInsert,
    "purgeAfter" | "remotePurgedAt"
  >,
  now = new Date()
): boolean {
  return (
    tombstone.remotePurgedAt == null &&
    tombstone.purgeAfter.getTime() <= now.getTime()
  );
}

export function planBackupDeletionReconciliation(input: {
  remoteNames: Iterable<string>;
  activeNames: Iterable<string>;
  tombstoneNames: Iterable<string>;
}): {
  missingRemoteBackups: string[];
  untrackedRemoteBackups: string[];
} {
  const remote = new Set(input.remoteNames);
  const active = new Set(input.activeNames);
  const tombstones = new Set(input.tombstoneNames);
  return {
    missingRemoteBackups: [...active]
      .filter((name) => !remote.has(name))
      .sort(),
    untrackedRemoteBackups: [...remote]
      .filter((name) => !active.has(name) && !tombstones.has(name))
      .sort(),
  };
}
