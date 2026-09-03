import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_RPO_ALERT_MS,
  BACKUP_RPO_TARGET_MS,
  BACKUP_RTO_TARGET_MS,
  estimateFullRestore,
  evaluateBackupFreshness,
  evaluateSingleNodeCapacity,
  SQLITE_CAPACITY_THRESHOLDS,
} from "./backup-policy";

const healthy = {
  databaseBytes: 10 * 1024 ** 2,
  walBytes: 4 * 1024 ** 2,
  mediaBytes: 10 * 1024 ** 3,
  diskTotalBytes: 100 * 1024 ** 3,
  diskFreeBytes: 70 * 1024 ** 3,
  taskRows: 10_000,
  assetRows: 10_000,
  workerConcurrency: 2,
};

test("single-node capacity exposes healthy, warning, and critical boundaries", () => {
  assert.equal(evaluateSingleNodeCapacity(healthy).status, "healthy");
  const warning = evaluateSingleNodeCapacity({
    ...healthy,
    databaseBytes: SQLITE_CAPACITY_THRESHOLDS.databaseWarningBytes,
  });
  assert.equal(warning.status, "warning");
  assert.ok(warning.reasons.includes("SQLITE_DATABASE_WARNING"));
  const critical = evaluateSingleNodeCapacity({
    ...healthy,
    diskFreeBytes: SQLITE_CAPACITY_THRESHOLDS.diskFreeCriticalBytes,
  });
  assert.equal(critical.status, "critical");
  assert.ok(critical.reasons.includes("SINGLE_NODE_DISK_CRITICAL"));
});

test("backup freshness separates the 24-hour objective from the 30-hour alert", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");
  assert.deepEqual(
    evaluateBackupFreshness(
      new Date(now.getTime() - BACKUP_RPO_TARGET_MS),
      now
    ),
    { ageMs: BACKUP_RPO_TARGET_MS, withinTarget: true, overdue: false }
  );
  assert.deepEqual(
    evaluateBackupFreshness(
      new Date(now.getTime() - BACKUP_RPO_ALERT_MS - 1),
      now
    ),
    { ageMs: BACKUP_RPO_ALERT_MS + 1, withinTarget: false, overdue: true }
  );
  assert.equal(evaluateBackupFreshness(null, now).overdue, true);
});

test("restore throughput estimates whether the current backup fits the four-hour RTO", () => {
  const estimate = estimateFullRestore({
    sampledBytes: 100 * 1024 ** 2,
    sampleDurationMs: 20_000,
    logicalBackupBytes: 10 * 1024 ** 3,
  });
  assert.equal(Math.round(estimate.bytesPerSecond ?? 0), 5 * 1024 ** 2);
  assert.ok((estimate.estimatedFullRestoreMs ?? Infinity) < BACKUP_RTO_TARGET_MS);
  assert.equal(estimate.withinTarget, true);
  assert.equal(
    estimateFullRestore({
      sampledBytes: 0,
      sampleDurationMs: 0,
      logicalBackupBytes: 1,
    }).withinTarget,
    null
  );
});
