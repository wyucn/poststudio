import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";
import {
  databaseManifestKey,
  legacyMediaManifestKey,
  parseDatabaseBackupManifest,
  parseMediaBackupManifest,
  sha256Buffer,
  type ParsedMediaBackup,
} from "@/lib/backup-artifacts";
import {
  BACKUP_RPO_ALERT_MS,
  BACKUP_RPO_TARGET_MS,
  BACKUP_RTO_TARGET_MS,
  estimateFullRestore,
  evaluateBackupFreshness,
} from "@/lib/backup-policy";
import {
  downloadBackupJson,
  downloadBackupObject,
  listBackupObjects,
  type BackupObjectInfo,
} from "@/lib/backup-remote";

export interface BackupReadStore {
  list(prefix: string): Promise<BackupObjectInfo[]>;
  download(key: string): Promise<Buffer>;
  downloadJson(key: string): Promise<unknown>;
}

const defaultStore: BackupReadStore = {
  list: listBackupObjects,
  download: downloadBackupObject,
  downloadJson: downloadBackupJson,
};

interface MediaRestoreCandidate {
  name: string;
  manifest: ParsedMediaBackup | null;
  directInfo: BackupObjectInfo | null;
}

async function logicalMediaBackupBytes(
  store: BackupReadStore
): Promise<number> {
  const [directRows, checksumRows, legacyRows] = await Promise.all([
    store.list("media/"),
    store.list("media-checksums/"),
    store.list("media-manifests/"),
  ]);
  const checksumNames = new Set(checksumRows.map((row) => row.name));
  const counted = new Set<string>();
  let bytes = 0;
  for (const row of directRows) {
    const name = safeMediaName(row.name);
    if (row.bytes === null) continue;
    counted.add(name);
    bytes += row.bytes;
  }
  for (const row of legacyRows) {
    const name = safeMediaName(row.name.replace(/\.json$/, ""));
    if (counted.has(name)) continue;
    const key = checksumNames.has(`${name}.json`)
      ? `media-checksums/${name}.json`
      : legacyMediaManifestKey(name);
    const manifest = parseMediaBackupManifest(
      await store.downloadJson(key),
      name
    );
    if (!manifest) throw new Error("无法统计分片媒体备份大小");
    counted.add(name);
    bytes += manifest.bytes;
  }
  for (const row of checksumRows) {
    const name = safeMediaName(row.name.replace(/\.json$/, ""));
    if (counted.has(name)) continue;
    const manifest = parseMediaBackupManifest(
      await store.downloadJson(`media-checksums/${row.name}`),
      name
    );
    if (!manifest || manifest.mode !== "chunked") continue;
    counted.add(name);
    bytes += manifest.bytes;
  }
  return bytes;
}

function safeMediaName(name: string): string {
  if (!name || path.basename(name) !== name) {
    throw new Error("备份媒体对象名无效");
  }
  return name;
}

async function mediaCandidates(
  store: BackupReadStore,
  sampleCount: number
): Promise<MediaRestoreCandidate[]> {
  if (sampleCount <= 0) return [];
  const [checksumRows, legacyRows, directRows] = await Promise.all([
    store.list("media-checksums/"),
    store.list("media-manifests/"),
    store.list("media/"),
  ]);
  const checksums = new Set(checksumRows.map((row) => row.name));
  const selected = new Set<string>();
  const candidates: MediaRestoreCandidate[] = [];

  // 优先覆盖一个分片对象；若已生成新版校验清单，则使用新版清单验证。
  for (const row of legacyRows.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = safeMediaName(row.name.replace(/\.json$/, ""));
    const key = checksums.has(`${name}.json`)
      ? `media-checksums/${name}.json`
      : legacyMediaManifestKey(name);
    const manifest = parseMediaBackupManifest(
      await store.downloadJson(key),
      name
    );
    if (!manifest) throw new Error("备份媒体清单无法用于恢复");
    candidates.push({ name, manifest, directInfo: null });
    selected.add(name);
    break;
  }

  for (const row of checksumRows.sort((a, b) => a.name.localeCompare(b.name))) {
    if (candidates.length >= sampleCount) break;
    const name = safeMediaName(row.name.replace(/\.json$/, ""));
    if (selected.has(name)) continue;
    const manifest = parseMediaBackupManifest(
      await store.downloadJson(`media-checksums/${row.name}`),
      name
    );
    if (!manifest || manifest.version !== 2) {
      throw new Error("媒体校验清单无法用于恢复");
    }
    candidates.push({ name, manifest, directInfo: null });
    selected.add(name);
  }

  for (const row of directRows.sort((a, b) => a.name.localeCompare(b.name))) {
    if (candidates.length >= sampleCount) break;
    const name = safeMediaName(row.name);
    if (selected.has(name) || checksums.has(`${name}.json`)) continue;
    candidates.push({ name, manifest: null, directInfo: row });
    selected.add(name);
  }
  return candidates.slice(0, sampleCount);
}

async function restoreMediaCandidate(input: {
  candidate: MediaRestoreCandidate;
  targetPath: string;
  store: BackupReadStore;
}): Promise<{
  bytes: number;
  mode: "direct" | "chunked";
  checksumVerified: boolean;
}> {
  const manifest = input.candidate.manifest;
  const fullHash = createHash("sha256");
  let restoredBytes = 0;
  await fs.writeFile(input.targetPath, new Uint8Array(), { flag: "wx" });
  if (manifest) {
    for (const object of manifest.objects) {
      const body = await input.store.download(object.key);
      if (body.length !== object.bytes) {
        throw new Error("恢复媒体分片大小不一致");
      }
      if (object.sha256 && sha256Buffer(body) !== object.sha256) {
        throw new Error("恢复媒体分片校验失败");
      }
      await fs.appendFile(input.targetPath, body);
      fullHash.update(body);
      restoredBytes += body.length;
    }
  } else {
    const body = await input.store.download(`media/${input.candidate.name}`);
    const expectedBytes = input.candidate.directInfo?.bytes;
    if (
      expectedBytes !== null &&
      expectedBytes !== undefined &&
      expectedBytes !== body.length
    ) {
      throw new Error("恢复媒体对象大小不一致");
    }
    await fs.appendFile(input.targetPath, body);
    fullHash.update(body);
    restoredBytes = body.length;
  }
  if (manifest && restoredBytes !== manifest.bytes) {
    throw new Error("恢复媒体总大小不一致");
  }
  if (manifest?.sha256 && fullHash.digest("hex") !== manifest.sha256) {
    throw new Error("恢复媒体总校验失败");
  }
  return {
    bytes: restoredBytes,
    mode: manifest?.mode ?? "direct",
    checksumVerified: manifest?.version === 2,
  };
}

export interface BackupRestoreDrillMetrics {
  objectives: {
    rpoTargetMs: number;
    rpoAlertMs: number;
    rtoTargetMs: number;
    snapshotAgeMs: number | null;
    withinRpo: boolean;
    rpoOverdue: boolean;
    logicalBackupBytes: number;
    bytesPerSecond: number | null;
    estimatedFullRestoreMs: number | null;
    withinRto: boolean | null;
  };
  database: {
    bytes: number;
    checksumVerified: boolean;
    quickCheckFailures: number;
    foreignKeyViolations: number;
    migrationsApplied: boolean;
  };
  media: {
    requested: number;
    restored: number;
    direct: number;
    chunked: number;
    bytes: number;
    checksumVerified: number;
    legacySizeVerified: number;
  };
  durationMs: number;
}

export async function runBackupRestoreDrill(options: {
  targetDir: string;
  mediaSamples?: number;
  store?: BackupReadStore;
  now?: Date;
}): Promise<BackupRestoreDrillMetrics> {
  const startedAt = Date.now();
  const store = options.store ?? defaultStore;
  const sampleCount = Math.max(0, Math.min(10, options.mediaSamples ?? 2));
  await fs.mkdir(options.targetDir, { recursive: false });

  const snapshots = (await store.list("db/"))
    .filter((row) => /^haitun-\d{4}-\d{2}-\d{2}\.db$/.test(row.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const latest = snapshots.at(-1);
  if (!latest) throw new Error("备份桶中没有数据库快照");
  const snapshotKey = `db/${latest.name}`;
  const databaseBody = await store.download(snapshotKey);
  if (latest.bytes !== null && latest.bytes !== databaseBody.length) {
    throw new Error("恢复数据库快照大小不一致");
  }
  const manifests = new Set(
    (await store.list("db-manifests/")).map((row) => row.name)
  );
  let databaseChecksumVerified = false;
  let snapshotCreatedAt = latest.createdAt ?? latest.updatedAt;
  if (manifests.has(`${latest.name}.json`)) {
    const manifest = parseDatabaseBackupManifest(
      await store.downloadJson(databaseManifestKey(snapshotKey)),
      snapshotKey
    );
    if (!manifest) throw new Error("数据库校验清单无法用于恢复");
    if (
      manifest.bytes !== databaseBody.length ||
      manifest.sha256 !== sha256Buffer(databaseBody)
    ) {
      throw new Error("恢复数据库快照校验失败");
    }
    databaseChecksumVerified = true;
    snapshotCreatedAt = manifest.createdAt;
  }

  const databasePath = path.join(options.targetDir, "restored.db");
  await fs.writeFile(databasePath, databaseBody, { flag: "wx" });
  const sqlite = new Database(databasePath);
  let quickCheckFailures = 0;
  let foreignKeyViolations = 0;
  try {
    quickCheckFailures = (
      sqlite.prepare("PRAGMA quick_check(1)").all() as Array<
        Record<string, unknown>
      >
    ).filter((row) => String(Object.values(row)[0] ?? "") !== "ok").length;
    if (quickCheckFailures) throw new Error("恢复数据库 quick_check 失败");
    migrate(drizzle(sqlite, { schema }), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    foreignKeyViolations = (
      sqlite.prepare("PRAGMA foreign_key_check").all() as unknown[]
    ).length;
    if (foreignKeyViolations) {
      throw new Error("恢复数据库外键检查失败");
    }
  } finally {
    sqlite.close();
  }

  const mediaDir = path.join(options.targetDir, "media");
  await fs.mkdir(mediaDir);
  const candidates = await mediaCandidates(store, sampleCount);
  if (candidates.length < sampleCount) {
    throw new Error("备份桶中的可恢复媒体样本不足");
  }
  let restored = 0;
  let direct = 0;
  let chunked = 0;
  let mediaBytes = 0;
  let checksumVerified = 0;
  for (const [index, candidate] of candidates.entries()) {
    const result = await restoreMediaCandidate({
      candidate,
      targetPath: path.join(mediaDir, `sample-${index + 1}.bin`),
      store,
    });
    restored++;
    mediaBytes += result.bytes;
    if (result.mode === "direct") direct++;
    else chunked++;
    if (result.checksumVerified) checksumVerified++;
  }

  const logicalBackupBytes =
    databaseBody.length + (await logicalMediaBackupBytes(store));
  const freshness = evaluateBackupFreshness(
    snapshotCreatedAt ? new Date(snapshotCreatedAt) : null,
    options.now
  );
  const restoreEstimate = estimateFullRestore({
    sampledBytes: databaseBody.length + mediaBytes,
    sampleDurationMs: Date.now() - startedAt,
    logicalBackupBytes,
  });

  return {
    objectives: {
      rpoTargetMs: BACKUP_RPO_TARGET_MS,
      rpoAlertMs: BACKUP_RPO_ALERT_MS,
      rtoTargetMs: BACKUP_RTO_TARGET_MS,
      snapshotAgeMs: freshness.ageMs,
      withinRpo: freshness.withinTarget,
      rpoOverdue: freshness.overdue,
      logicalBackupBytes,
      bytesPerSecond: restoreEstimate.bytesPerSecond,
      estimatedFullRestoreMs: restoreEstimate.estimatedFullRestoreMs,
      withinRto: restoreEstimate.withinTarget,
    },
    database: {
      bytes: databaseBody.length,
      checksumVerified: databaseChecksumVerified,
      quickCheckFailures,
      foreignKeyViolations,
      migrationsApplied: true,
    },
    media: {
      requested: sampleCount,
      restored,
      direct,
      chunked,
      bytes: mediaBytes,
      checksumVerified,
      legacySizeVerified: restored - checksumVerified,
    },
    durationMs: Date.now() - startedAt,
  };
}
