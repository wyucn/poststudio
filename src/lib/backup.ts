/**
 * 数据备份（服务器容器无持久化保障，定期备份到 Supabase Storage 私有桶）。
 * - 数据库：每日在线快照，保留最近 7 份；每份都有 SHA-256 清单。
 * - 媒体：对象不可变，首次备份后写校验清单；删除后按墓碑额外保留 30 天。
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import Database from "better-sqlite3";
import { and, count, eq, isNull, lte } from "drizzle-orm";
import { assets, backupMediaTombstones, DATA_DIR, db } from "@/db";
import {
  createDatabaseBackupManifest,
  createMediaBackupManifest,
  databaseManifestKey,
  legacyMediaManifestKey,
  mediaDeletionKeys,
  parseMediaBackupManifest,
  sha256FileRange,
} from "@/lib/backup-artifacts";
import { mediaBackupPlan } from "@/lib/backup-plan";
import { collectSingleNodeCapacity } from "@/lib/backup-policy";
import {
  backupRemoteConfigured,
  backupRemoteWriteEnabled,
  deleteBackupObjects,
  downloadBackupJson,
  ensureBackupBucket,
  listBackupObjects,
  uploadBackupFile,
  uploadBackupFileRange,
  uploadBackupJson,
} from "@/lib/backup-remote";
import {
  createLegacyBackupTombstone,
  planBackupDeletionReconciliation,
} from "@/lib/backup-retention";
import { errorDiagnostic } from "@/lib/error-safety";
import {
  recordOperationFailure,
  recordOperationSkipped,
  recordOperationSuccess,
} from "@/lib/operations/health";

const DB_KEEP = 7;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 5 * 60 * 1000;

interface DatabaseBackupMetrics {
  snapshotsUploaded: number;
  checksumManifestsWritten: number;
  expiredSnapshotsDeleted: number;
}

async function backupDatabase(now = new Date()): Promise<DatabaseBackupMetrics> {
  const dbPath = path.join(DATA_DIR, "haitun-post-studio.db");
  const stamp = now.toISOString().slice(0, 10);
  const snapshotKey = `db/haitun-${stamp}.db`;
  const tmp = path.join(DATA_DIR, `.backup-${stamp}.db`);
  const source = new Database(dbPath, { readonly: true });
  try {
    await source.backup(tmp);
  } finally {
    source.close();
  }
  try {
    const stat = await fs.stat(tmp);
    const sha256 = await sha256FileRange(tmp);
    await uploadBackupFile(snapshotKey, tmp);
    await uploadBackupJson(
      databaseManifestKey(snapshotKey),
      createDatabaseBackupManifest({
        snapshotKey,
        bytes: stat.size,
        sha256,
        createdAt: now,
      })
    );
  } finally {
    await fs.rm(tmp, { force: true });
  }

  const snapshots = (await listBackupObjects("db/"))
    .map((row) => row.name)
    .filter((name) => /^haitun-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort();
  const expired = snapshots.slice(
    0,
    Math.max(0, snapshots.length - DB_KEEP)
  );
  for (const name of expired) {
    await deleteBackupObjects([
      `db/${name}`,
      databaseManifestKey(`db/${name}`),
    ]);
  }
  return {
    snapshotsUploaded: 1,
    checksumManifestsWritten: 1,
    expiredSnapshotsDeleted: expired.length,
  };
}

interface MediaBackupMetrics {
  uploaded: number;
  reused: number;
  checksumManifestsWritten: number;
  largeFilesUploaded: number;
  chunkObjectsUploaded: number;
}

async function chunkObjectsMatch(
  name: string,
  manifest: NonNullable<ReturnType<typeof parseMediaBackupManifest>>
): Promise<boolean> {
  if (manifest.mode !== "chunked") return false;
  const rows = await listBackupObjects(`media-chunks/${name}/`);
  const remote = new Map(rows.map((row) => [row.name, row.bytes]));
  return manifest.objects.every((object) => {
    const partName = object.key.slice(`media-chunks/${name}/`.length);
    return remote.get(partName) === object.bytes;
  });
}

async function backupMedia(now = new Date()): Promise<MediaBackupMetrics> {
  const mediaDir = path.join(DATA_DIR, "media");
  const local = [
    ...new Set(
      db
        .select({ objectKey: assets.objectKey })
        .from(assets)
        .all()
        .flatMap((row) => (row.objectKey ? [row.objectKey] : []))
    ),
  ];
  if (!local.length) {
    return {
      uploaded: 0,
      reused: 0,
      checksumManifestsWritten: 0,
      largeFilesUploaded: 0,
      chunkObjectsUploaded: 0,
    };
  }

  const [directRows, checksumRows, tombstoneRows] = await Promise.all([
    listBackupObjects("media/"),
    listBackupObjects("media-checksums/"),
    Promise.resolve(
      db
        .select({ objectKey: backupMediaTombstones.objectKey })
        .from(backupMediaTombstones)
        .all()
    ),
  ]);
  const direct = new Map(directRows.map((row) => [row.name, row]));
  const checksums = new Set(checksumRows.map((row) => row.name));
  const tombstones = new Set(tombstoneRows.map((row) => row.objectKey));
  let uploaded = 0;
  let reused = 0;
  let checksumManifestsWritten = 0;
  let largeFilesUploaded = 0;
  let chunkObjectsUploaded = 0;

  for (const name of local.sort()) {
    if (tombstones.has(name)) {
      throw new Error("活动素材与备份删除墓碑冲突");
    }
    const filePath = path.join(mediaDir, name);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;
    const plan = mediaBackupPlan(name, stat.size);
    if (checksums.has(`${name}.json`)) {
      if (
        plan.mode === "direct" &&
        direct.get(name)?.bytes === plan.bytes
      ) {
        reused++;
        continue;
      }
      if (plan.mode === "chunked") {
        const existing = parseMediaBackupManifest(
          await downloadBackupJson(plan.manifestKey),
          name
        );
        if (
          existing?.version === 2 &&
          existing.bytes === plan.bytes &&
          (await chunkObjectsMatch(name, existing))
        ) {
          reused++;
          continue;
        }
      }
    }

    const manifest = await createMediaBackupManifest({
      name,
      plan,
      filePath,
      createdAt: now,
    });
    if (plan.mode === "direct") {
      const remote = direct.get(name);
      if (!remote || remote.bytes !== plan.bytes) {
        await uploadBackupFile(plan.key, filePath);
        uploaded++;
      }
    } else {
      for (const chunk of plan.chunks) {
        await uploadBackupFileRange(
          chunk.key,
          filePath,
          chunk.offset,
          chunk.bytes
        );
        chunkObjectsUploaded++;
      }
      uploaded++;
      largeFilesUploaded++;
    }
    await uploadBackupJson(plan.manifestKey, manifest);
    checksumManifestsWritten++;
  }
  return {
    uploaded,
    reused,
    checksumManifestsWritten,
    largeFilesUploaded,
    chunkObjectsUploaded,
  };
}

interface MediaPurgeMetrics {
  pending: number;
  purged: number;
  objectsDeleted: number;
}

async function purgeExpiredMediaBackups(
  now = new Date()
): Promise<MediaPurgeMetrics> {
  const [checksumRows, legacyRows] = await Promise.all([
    listBackupObjects("media-checksums/"),
    listBackupObjects("media-manifests/"),
  ]);
  const checksums = new Set(checksumRows.map((row) => row.name));
  const legacy = new Set(legacyRows.map((row) => row.name));
  const due = db
    .select({
      objectKey: backupMediaTombstones.objectKey,
    })
    .from(backupMediaTombstones)
    .leftJoin(assets, eq(assets.objectKey, backupMediaTombstones.objectKey))
    .where(
      and(
        isNull(backupMediaTombstones.remotePurgedAt),
        lte(backupMediaTombstones.purgeAfter, now),
        isNull(assets.id)
      )
    )
    .all();
  let purged = 0;
  let objectsDeleted = 0;

  for (const row of due) {
    const name = row.objectKey;
    let manifest = null;
    if (checksums.has(`${name}.json`)) {
      manifest = parseMediaBackupManifest(
        await downloadBackupJson(`media-checksums/${name}.json`),
        name
      );
      if (!manifest || manifest.version !== 2) {
        throw new Error("媒体校验清单无效，已停止远端清理");
      }
    } else if (legacy.has(`${name}.json`)) {
      manifest = parseMediaBackupManifest(
        await downloadBackupJson(legacyMediaManifestKey(name)),
        name
      );
      if (!manifest) {
        throw new Error("旧版媒体清单无效，已停止远端清理");
      }
    }
    const keys = mediaDeletionKeys(name, manifest);
    if (!manifest) {
      const chunks = await listBackupObjects(`media-chunks/${name}/`);
      for (const chunk of chunks) {
        if (/^part-\d{5}$/.test(chunk.name)) {
          keys.splice(keys.length - 2, 0, `media-chunks/${name}/${chunk.name}`);
        }
      }
    }
    objectsDeleted += (await deleteBackupObjects(keys)).size;
    db.update(backupMediaTombstones)
      .set({ assetJson: null, remotePurgedAt: now })
      .where(eq(backupMediaTombstones.objectKey, name))
      .run();
    purged++;
  }

  const pending = db
    .select({ value: count() })
    .from(backupMediaTombstones)
    .where(isNull(backupMediaTombstones.remotePurgedAt))
    .get()?.value;
  return { pending: Number(pending ?? 0), purged, objectsDeleted };
}

export interface BackupMetrics {
  configured: boolean;
  writeEnabled: boolean;
  databaseSnapshots: number;
  databaseChecksumManifests: number;
  expiredDatabaseSnapshotsDeleted: number;
  mediaUploaded: number;
  mediaReused: number;
  mediaChecksumManifests: number;
  largeFilesUploaded: number;
  chunkObjectsUploaded: number;
  mediaTombstonesPending: number;
  mediaPurged: number;
  mediaBackupObjectsDeleted: number;
  capacityStatus: "healthy" | "warning" | "critical";
  capacityReasons: string[];
  databaseBytes: number;
  walBytes: number;
  mediaBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskUsage: number;
  taskRows: number;
  assetRows: number;
  workerConcurrency: number;
  durationMs: number;
}

export async function runBackup(now = new Date()): Promise<BackupMetrics> {
  const startedAt = Date.now();
  const capacity = await collectSingleNodeCapacity();
  const configured = backupRemoteConfigured();
  const writeEnabled = backupRemoteWriteEnabled();
  if (!configured || !writeEnabled) {
    console.log(
      configured
        ? "[backup] 远端备份写入未启用，跳过备份"
        : "[backup] 未配置 Supabase，跳过备份"
    );
    return {
      configured,
      writeEnabled,
      databaseSnapshots: 0,
      databaseChecksumManifests: 0,
      expiredDatabaseSnapshotsDeleted: 0,
      mediaUploaded: 0,
      mediaReused: 0,
      mediaChecksumManifests: 0,
      largeFilesUploaded: 0,
      chunkObjectsUploaded: 0,
      mediaTombstonesPending: 0,
      mediaPurged: 0,
      mediaBackupObjectsDeleted: 0,
      capacityStatus: capacity.status,
      capacityReasons: capacity.reasons,
      databaseBytes: capacity.databaseBytes,
      walBytes: capacity.walBytes,
      mediaBytes: capacity.mediaBytes,
      diskTotalBytes: capacity.diskTotalBytes,
      diskFreeBytes: capacity.diskFreeBytes,
      diskUsage: capacity.diskUsage,
      taskRows: capacity.taskRows,
      assetRows: capacity.assetRows,
      workerConcurrency: capacity.workerConcurrency,
      durationMs: Date.now() - startedAt,
    };
  }
  await ensureBackupBucket();
  const database = await backupDatabase(now);
  const media = await backupMedia(now);
  const purge = await purgeExpiredMediaBackups(now);
  console.log("[backup] 完成", {
    databaseSnapshots: database.snapshotsUploaded,
    mediaUploaded: media.uploaded,
    mediaChecksumManifests: media.checksumManifestsWritten,
    mediaPurged: purge.purged,
  });
  return {
    configured: true,
    writeEnabled: true,
    databaseSnapshots: database.snapshotsUploaded,
    databaseChecksumManifests: database.checksumManifestsWritten,
    expiredDatabaseSnapshotsDeleted: database.expiredSnapshotsDeleted,
    mediaUploaded: media.uploaded,
    mediaReused: media.reused,
    mediaChecksumManifests: media.checksumManifestsWritten,
    largeFilesUploaded: media.largeFilesUploaded,
    chunkObjectsUploaded: media.chunkObjectsUploaded,
    mediaTombstonesPending: purge.pending,
    mediaPurged: purge.purged,
    mediaBackupObjectsDeleted: purge.objectsDeleted,
    capacityStatus: capacity.status,
    capacityReasons: capacity.reasons,
    databaseBytes: capacity.databaseBytes,
    walBytes: capacity.walBytes,
    mediaBytes: capacity.mediaBytes,
    diskTotalBytes: capacity.diskTotalBytes,
    diskFreeBytes: capacity.diskFreeBytes,
    diskUsage: capacity.diskUsage,
    taskRows: capacity.taskRows,
    assetRows: capacity.assetRows,
    workerConcurrency: capacity.workerConcurrency,
    durationMs: Date.now() - startedAt,
  };
}

export interface BackupDeletionReconciliation {
  remoteLogicalFiles: number;
  activeMediaAssets: number;
  missingRemoteBackups: number;
  untrackedRemoteBackups: number;
  recordedTombstones: number;
}

export async function reconcileBackupDeletions(options: {
  record?: boolean;
  now?: Date;
} = {}): Promise<BackupDeletionReconciliation> {
  if (!backupRemoteConfigured()) {
    throw new Error("未配置 Supabase 备份连接");
  }
  const [direct, checksums, legacy] = await Promise.all([
    listBackupObjects("media/"),
    listBackupObjects("media-checksums/"),
    listBackupObjects("media-manifests/"),
  ]);
  const remote = new Set(direct.map((row) => row.name));
  for (const row of legacy) {
    const name = row.name.replace(/\.json$/, "");
    const manifest = parseMediaBackupManifest(
      await downloadBackupJson(legacyMediaManifestKey(name)),
      name
    );
    if (manifest && (await chunkObjectsMatch(name, manifest))) {
      remote.add(name);
    }
  }
  for (const row of checksums) {
    const name = row.name.replace(/\.json$/, "");
    if (remote.has(name)) continue;
    const manifest = parseMediaBackupManifest(
      await downloadBackupJson(`media-checksums/${row.name}`),
      name
    );
    if (
      manifest?.version === 2 &&
      manifest.mode === "chunked" &&
      (await chunkObjectsMatch(name, manifest))
    ) {
      remote.add(name);
    }
  }
  const active = new Set(
    db
      .select({ objectKey: assets.objectKey })
      .from(assets)
      .all()
      .flatMap((row) => (row.objectKey ? [row.objectKey] : []))
  );
  const tombstones = new Set(
    db
      .select({ objectKey: backupMediaTombstones.objectKey })
      .from(backupMediaTombstones)
      .all()
      .map((row) => row.objectKey)
  );
  const plan = planBackupDeletionReconciliation({
    remoteNames: remote,
    activeNames: active,
    tombstoneNames: tombstones,
  });
  if (options.record && plan.missingRemoteBackups.length) {
    throw new Error("仍有活动素材缺少远端备份，拒绝记录删除墓碑");
  }
  let recordedTombstones = 0;
  if (options.record && plan.untrackedRemoteBackups.length) {
    const now = options.now ?? new Date();
    db.transaction((transaction) => {
      for (const name of plan.untrackedRemoteBackups) {
        recordedTombstones += transaction
          .insert(backupMediaTombstones)
          .values(createLegacyBackupTombstone(name, now))
          .onConflictDoNothing()
          .run().changes;
      }
    });
  }
  return {
    remoteLogicalFiles: remote.size,
    activeMediaAssets: active.size,
    missingRemoteBackups: plan.missingRemoteBackups.length,
    untrackedRemoteBackups: plan.untrackedRemoteBackups.length,
    recordedTombstones,
  };
}

export type BackupCycleStatus = "ok" | "skipped" | "failed";

export async function runBackupCycle(): Promise<BackupCycleStatus> {
  const startedAt = Date.now();
  try {
    const metrics = await runBackup();
    if (metrics.configured && metrics.writeEnabled) {
      await recordOperationSuccess("backup", metrics);
      return "ok";
    }
    recordOperationSkipped("backup", metrics);
    return "skipped";
  } catch (error) {
    const requestId = randomUUID();
    console.error(`[backup][${requestId}] 失败:`, errorDiagnostic(error));
    await recordOperationFailure({
      key: "backup",
      requestId,
      metrics: { durationMs: Date.now() - startedAt },
      action: "请尽快检查备份桶、校验清单、服务密钥和服务器磁盘状态",
    });
    return "failed";
  }
}

export function startBackupScheduler(): void {
  const globalState = globalThis as unknown as {
    __haitunBackup?: NodeJS.Timeout;
  };
  if (globalState.__haitunBackup) return;
  const run = () => void runBackupCycle();
  setTimeout(run, BOOT_DELAY_MS);
  globalState.__haitunBackup = setInterval(run, INTERVAL_MS);
  console.log("[haitun-post-studio] 每日备份调度器已启动");
}
