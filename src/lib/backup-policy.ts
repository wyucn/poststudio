import path from "node:path";
import fs from "node:fs/promises";
import { count, eq } from "drizzle-orm";
import { assets, DATA_DIR, db, operationHealth, tasks } from "@/db";

const HOUR_MS = 60 * 60 * 1000;
const GIB = 1024 ** 3;

export const BACKUP_RPO_TARGET_MS = 24 * HOUR_MS;
export const BACKUP_RPO_ALERT_MS = 30 * HOUR_MS;
export const BACKUP_RTO_TARGET_MS = 4 * HOUR_MS;

export const SQLITE_CAPACITY_THRESHOLDS = {
  databaseWarningBytes: 1 * GIB,
  databaseCriticalBytes: 2 * GIB,
  walWarningBytes: 512 * 1024 ** 2,
  walCriticalBytes: 2 * GIB,
  taskRowsWarning: 500_000,
  taskRowsCritical: 1_000_000,
  assetRowsWarning: 250_000,
  assetRowsCritical: 500_000,
  diskUsageWarning: 0.7,
  diskUsageCritical: 0.85,
  diskFreeWarningBytes: 15 * GIB,
  diskFreeCriticalBytes: 5 * GIB,
} as const;

export type CapacityStatus = "healthy" | "warning" | "critical";

export interface SingleNodeCapacityInput {
  databaseBytes: number;
  walBytes: number;
  mediaBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  taskRows: number;
  assetRows: number;
  workerConcurrency: number;
}

export interface SingleNodeCapacityEvaluation extends SingleNodeCapacityInput {
  status: CapacityStatus;
  reasons: string[];
  diskUsage: number;
}

function severity(status: CapacityStatus): number {
  return status === "critical" ? 2 : status === "warning" ? 1 : 0;
}

export function evaluateSingleNodeCapacity(
  input: SingleNodeCapacityInput
): SingleNodeCapacityEvaluation {
  let status: CapacityStatus = "healthy";
  const reasons: string[] = [];
  const raise = (next: CapacityStatus, reason: string) => {
    if (severity(next) > severity(status)) status = next;
    reasons.push(reason);
  };
  const diskUsage =
    input.diskTotalBytes > 0
      ? 1 - input.diskFreeBytes / input.diskTotalBytes
      : 0;

  if (
    input.databaseBytes >= SQLITE_CAPACITY_THRESHOLDS.databaseCriticalBytes
  ) {
    raise("critical", "SQLITE_DATABASE_CRITICAL");
  } else if (
    input.databaseBytes >= SQLITE_CAPACITY_THRESHOLDS.databaseWarningBytes
  ) {
    raise("warning", "SQLITE_DATABASE_WARNING");
  }
  if (input.walBytes >= SQLITE_CAPACITY_THRESHOLDS.walCriticalBytes) {
    raise("critical", "SQLITE_WAL_CRITICAL");
  } else if (input.walBytes >= SQLITE_CAPACITY_THRESHOLDS.walWarningBytes) {
    raise("warning", "SQLITE_WAL_WARNING");
  }
  if (input.taskRows >= SQLITE_CAPACITY_THRESHOLDS.taskRowsCritical) {
    raise("critical", "SQLITE_TASK_ROWS_CRITICAL");
  } else if (input.taskRows >= SQLITE_CAPACITY_THRESHOLDS.taskRowsWarning) {
    raise("warning", "SQLITE_TASK_ROWS_WARNING");
  }
  if (input.assetRows >= SQLITE_CAPACITY_THRESHOLDS.assetRowsCritical) {
    raise("critical", "SQLITE_ASSET_ROWS_CRITICAL");
  } else if (input.assetRows >= SQLITE_CAPACITY_THRESHOLDS.assetRowsWarning) {
    raise("warning", "SQLITE_ASSET_ROWS_WARNING");
  }
  if (
    diskUsage >= SQLITE_CAPACITY_THRESHOLDS.diskUsageCritical ||
    (input.diskTotalBytes > 0 &&
      input.diskFreeBytes <=
        SQLITE_CAPACITY_THRESHOLDS.diskFreeCriticalBytes)
  ) {
    raise("critical", "SINGLE_NODE_DISK_CRITICAL");
  } else if (
    diskUsage >= SQLITE_CAPACITY_THRESHOLDS.diskUsageWarning ||
    (input.diskTotalBytes > 0 &&
      input.diskFreeBytes <= SQLITE_CAPACITY_THRESHOLDS.diskFreeWarningBytes)
  ) {
    raise("warning", "SINGLE_NODE_DISK_WARNING");
  }
  return { ...input, status, reasons, diskUsage };
}

async function fileSize(filePath: string): Promise<number> {
  return fs.stat(filePath).then((stat) => stat.size).catch(() => 0);
}

export async function collectSingleNodeCapacity(): Promise<SingleNodeCapacityEvaluation> {
  const databasePath = path.join(DATA_DIR, "haitun-post-studio.db");
  const [databaseBytes, walBytes, fileSystem] = await Promise.all([
    fileSize(databasePath),
    fileSize(`${databasePath}-wal`),
    fs.statfs(DATA_DIR).catch(() => null),
  ]);
  const mediaDir = path.join(DATA_DIR, "media");
  const names = await fs.readdir(mediaDir).catch(() => [] as string[]);
  let mediaBytes = 0;
  for (const name of names) {
    const stat = await fs.stat(path.join(mediaDir, name)).catch(() => null);
    if (stat?.isFile()) mediaBytes += stat.size;
  }
  const taskRows = Number(
    db.select({ value: count() }).from(tasks).get()?.value ?? 0
  );
  const assetRows = Number(
    db.select({ value: count() }).from(assets).get()?.value ?? 0
  );
  const configuredConcurrency = Number(
    process.env.TASK_WORKER_CONCURRENCY ?? 2
  );
  return evaluateSingleNodeCapacity({
    databaseBytes,
    walBytes,
    mediaBytes,
    diskTotalBytes: fileSystem
      ? Number(fileSystem.blocks) * Number(fileSystem.bsize)
      : 0,
    diskFreeBytes: fileSystem
      ? Number(fileSystem.bavail) * Number(fileSystem.bsize)
      : 0,
    taskRows,
    assetRows,
    workerConcurrency:
      Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
        ? Math.min(configuredConcurrency, 8)
        : 2,
  });
}

export function evaluateBackupFreshness(
  lastSuccessAt: Date | null,
  now = new Date()
): {
  ageMs: number | null;
  withinTarget: boolean;
  overdue: boolean;
} {
  const ageMs = lastSuccessAt
    ? Math.max(0, now.getTime() - lastSuccessAt.getTime())
    : null;
  return {
    ageMs,
    withinTarget: ageMs !== null && ageMs <= BACKUP_RPO_TARGET_MS,
    overdue: ageMs === null || ageMs > BACKUP_RPO_ALERT_MS,
  };
}

export function estimateFullRestore(input: {
  sampledBytes: number;
  sampleDurationMs: number;
  logicalBackupBytes: number;
}): {
  bytesPerSecond: number | null;
  estimatedFullRestoreMs: number | null;
  withinTarget: boolean | null;
} {
  if (input.sampledBytes <= 0 || input.sampleDurationMs <= 0) {
    return {
      bytesPerSecond: null,
      estimatedFullRestoreMs: null,
      withinTarget: null,
    };
  }
  const bytesPerSecond = input.sampledBytes / (input.sampleDurationMs / 1000);
  const estimatedFullRestoreMs =
    (input.logicalBackupBytes / bytesPerSecond) * 1000;
  return {
    bytesPerSecond,
    estimatedFullRestoreMs,
    withinTarget: estimatedFullRestoreMs <= BACKUP_RTO_TARGET_MS,
  };
}

export async function collectBackupReadiness(now = new Date()) {
  const backup = db
    .select({ lastSuccessAt: operationHealth.lastSuccessAt })
    .from(operationHealth)
    .where(eq(operationHealth.key, "backup"))
    .get();
  return {
    objectives: {
      rpoTargetMs: BACKUP_RPO_TARGET_MS,
      rpoAlertMs: BACKUP_RPO_ALERT_MS,
      rtoTargetMs: BACKUP_RTO_TARGET_MS,
    },
    freshness: evaluateBackupFreshness(backup?.lastSuccessAt ?? null, now),
    capacity: await collectSingleNodeCapacity(),
  };
}
