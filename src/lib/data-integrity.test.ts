import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";
import {
  assets,
  assetTranscripts,
  backupMediaTombstones,
  projectMembers,
  projects,
  tasks,
  users,
} from "@/db/schema";
import {
  inspectDataIntegrity,
  runDataIntegrityCheck,
} from "./data-integrity";

function fixture() {
  const sqlite = new Database(":memory:");
  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const now = new Date("2026-08-05T00:00:00.000Z");
  database
    .insert(users)
    .values({
      id: "owner",
      email: "owner@example.com",
      name: "Owner",
      passwordHash: "hash",
      role: "admin",
      createdAt: now,
    })
    .run();
  database
    .insert(projects)
    .values({
      id: "project",
      name: "Project",
      createdBy: "owner",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  database
    .insert(projectMembers)
    .values({
      projectId: "project",
      userId: "owner",
      role: "owner",
      addedAt: now,
    })
    .run();
  return { sqlite, database, now };
}

test("integrity check repairs only dangling task output references", () => {
  const { sqlite, database, now } = fixture();
  try {
    database
      .insert(tasks)
      .values({
        id: "task",
        projectId: "project",
        userId: "owner",
        kind: "image",
        status: "succeeded",
        modelKey: "seedream-5.0",
        inputJson: "{}",
        outputAssetId: "deleted-asset",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const before = runDataIntegrityCheck(database);
    assert.equal(before.blockingIssueCount, 0);
    assert.equal(before.advisoryIssueCount, 1);
    assert.equal(before.issues.orphanTaskOutputs, 1);

    const repaired = runDataIntegrityCheck(database, {
      repairSafe: true,
      now: new Date("2026-08-05T01:00:00.000Z"),
    });
    assert.equal(repaired.repairedDanglingTaskOutputs, 1);
    assert.equal(repaired.blockingIssueCount, 0);
    assert.equal(repaired.advisoryIssueCount, 0);
    assert.equal(repaired.issues.orphanTaskOutputs, 0);
    assert.equal(
      database.select().from(tasks).where(eq(tasks.id, "task")).get()
        ?.outputAssetId,
      null
    );
  } finally {
    sqlite.close();
  }
});

test("integrity check reports invalid JSON and authority relationships", () => {
  const { sqlite, database, now } = fixture();
  try {
    database
      .insert(projects)
      .values({
        id: "orphan-project",
        name: "Orphan",
        createdBy: "missing-user",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database
      .insert(tasks)
      .values({
        id: "invalid-json-task",
        projectId: "project",
        userId: "owner",
        kind: "image",
        status: "failed",
        modelKey: "seedream-5.0",
        inputJson: "not-json",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const report = inspectDataIntegrity(database);
    assert.equal(report.issues.orphanProjectOwners, 1);
    assert.equal(report.issues.missingOwnerMembership, 1);
    assert.equal(report.issues.invalidTaskInputJson, 1);
    assert.equal(report.quickCheckFailures, 0);
    assert.equal(report.foreignKeyViolations, 0);

    const metrics = runDataIntegrityCheck(database, { repairSafe: true });
    assert.equal(metrics.blockingIssueCount, 3);
    assert.equal(metrics.repairedDanglingTaskOutputs, 0);
  } finally {
    sqlite.close();
  }
});

test("integrity check requires the authoritative owner membership role", () => {
  const { sqlite, database } = fixture();
  try {
    database
      .update(projectMembers)
      .set({ role: "editor" })
      .where(eq(projectMembers.projectId, "project"))
      .run();

    const report = inspectDataIntegrity(database);
    assert.equal(report.issues.missingOwnerMembership, 1);
    assert.equal(report.issues.conflictingOwnerRoles, 0);
  } finally {
    sqlite.close();
  }
});

test("integrity check reports transcript tasks from another project", () => {
  const { sqlite, database, now } = fixture();
  try {
    database
      .insert(projects)
      .values({
        id: "other-project",
        name: "Other",
        createdBy: "owner",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database
      .insert(projectMembers)
      .values({
        projectId: "other-project",
        userId: "owner",
        role: "owner",
        addedAt: now,
      })
      .run();
    database
      .insert(assets)
      .values({
        id: "audio",
        projectId: "project",
        userId: "owner",
        kind: "audio",
        metaJson: "{}",
        createdAt: now,
      })
      .run();
    database
      .insert(tasks)
      .values({
        id: "transcript-task",
        projectId: "other-project",
        userId: "owner",
        kind: "audio",
        status: "succeeded",
        modelKey: "coze-transcribe",
        inputJson: "{}",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database
      .insert(assetTranscripts)
      .values({
        assetId: "audio",
        projectId: "project",
        taskId: "transcript-task",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const report = inspectDataIntegrity(database);
    assert.equal(report.issues.transcriptTaskProjectMismatch, 1);
    assert.equal(report.issues.transcriptProjectMismatch, 0);
  } finally {
    sqlite.close();
  }
});

test("integrity check protects active assets from backup tombstones", () => {
  const { sqlite, database, now } = fixture();
  try {
    database
      .insert(assets)
      .values({
        id: "asset-with-tombstone",
        projectId: "project",
        userId: "owner",
        kind: "image",
        objectKey: "active.png",
        metaJson: "{}",
        createdAt: now,
      })
      .run();
    database
      .insert(backupMediaTombstones)
      .values({
        objectKey: "active.png",
        assetId: "asset-with-tombstone",
        assetJson: "[]",
        deletedAt: now,
        purgeAfter: new Date(now.getTime() - 1),
      })
      .run();

    const report = inspectDataIntegrity(database);
    assert.equal(report.issues.activeAssetBackupTombstones, 1);
    assert.equal(report.issues.invalidBackupTombstoneAssetJson, 1);
    assert.equal(report.issues.invalidBackupTombstoneTimes, 1);
  } finally {
    sqlite.close();
  }
});
