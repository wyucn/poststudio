import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";
import {
  assets,
  operationHealth,
  productEvents,
  projectMembers,
  projects,
  tasks,
  users,
} from "@/db/schema";
import {
  loadDashboardStatsRankings,
  loadDashboardStatsSnapshot,
} from "./dashboard";

const NOW = Date.UTC(2026, 7, 4, 4, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function date(offsetMs: number): Date {
  return new Date(NOW + offsetMs);
}

function createFixture() {
  const sqlite = new Database(":memory:");
  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  database
    .insert(users)
    .values([
      {
        id: "admin",
        email: "admin@example.com",
        name: "Admin",
        passwordHash: "test",
        role: "admin",
        lastSeenAt: date(-2_000),
        createdAt: date(-10 * DAY),
      },
      {
        id: "member-a",
        email: "a@example.com",
        name: "Alice",
        passwordHash: "test",
        role: "member",
        lastSeenAt: date(-5_000),
        createdAt: date(-10 * DAY),
      },
      {
        id: "member-b",
        email: "b@example.com",
        name: "Bob",
        passwordHash: "test",
        role: "member",
        lastSeenAt: date(-40 * DAY),
        createdAt: date(-50 * DAY),
      },
    ])
    .run();

  database
    .insert(projects)
    .values([
      {
        id: "project-a",
        name: "Alpha",
        createdBy: "admin",
        visibility: "private",
        createdAt: date(-10 * DAY),
        updatedAt: date(-DAY),
      },
      {
        id: "project-b",
        name: "Beta",
        createdBy: "admin",
        visibility: "private",
        createdAt: date(-10 * DAY),
        updatedAt: date(-DAY),
      },
      {
        id: "project-deleted",
        name: "Deleted",
        createdBy: "admin",
        visibility: "private",
        deletedAt: date(-DAY),
        createdAt: date(-20 * DAY),
        updatedAt: date(-DAY),
      },
    ])
    .run();

  database
    .insert(projectMembers)
    .values([
      {
        projectId: "project-a",
        userId: "admin",
        role: "owner",
        addedAt: date(-10 * DAY),
      },
      {
        projectId: "project-a",
        userId: "member-a",
        role: "editor",
        addedAt: date(-10 * DAY),
      },
      {
        projectId: "project-b",
        userId: "admin",
        role: "owner",
        addedAt: date(-10 * DAY),
      },
      {
        projectId: "project-b",
        userId: "member-b",
        role: "editor",
        addedAt: date(-10 * DAY),
      },
    ])
    .run();

  database
    .insert(assets)
    .values([
      {
        id: "asset-image",
        projectId: "project-a",
        userId: "member-a",
        kind: "image",
        metaJson: JSON.stringify({ params: { size: "2048x2048" } }),
        reviewStatus: "approved",
        createdAt: date(-5_000),
      },
      {
        id: "asset-video",
        projectId: "project-b",
        userId: "member-b",
        kind: "video",
        metaJson: JSON.stringify({
          params: { actualResolution: "720p", actualDuration: 6 },
        }),
        createdAt: date(-4_000),
      },
      {
        id: "asset-upload",
        projectId: "project-a",
        userId: "member-a",
        kind: "image",
        metaJson: "{}",
        reviewStatus: "rejected",
        createdAt: date(-3_000),
      },
      {
        id: "asset-deleted-project",
        projectId: "project-deleted",
        userId: "admin",
        kind: "image",
        metaJson: "{}",
        createdAt: date(-2_000),
      },
    ])
    .run();

  database
    .insert(tasks)
    .values([
      {
        id: "task-image",
        projectId: "project-a",
        userId: "member-a",
        kind: "image",
        status: "succeeded",
        modelKey: "seedream-5.0",
        inputJson: JSON.stringify({ count: 2 }),
        usageJson: JSON.stringify({ source: "actual", images: 2 }),
        outputAssetId: "asset-image",
        attemptCount: 1,
        startedAt: date(-7_000),
        completedAt: date(-6_000),
        createdAt: date(-8_000),
        updatedAt: date(-6_000),
      },
      {
        id: "task-failed",
        projectId: "project-a",
        userId: "member-a",
        kind: "video",
        status: "failed",
        modelKey: "seedance-2.0",
        inputJson: "{}",
        errorCode: "ARK_RATE_LIMITED",
        attemptCount: 2,
        startedAt: date(-7_000),
        completedAt: date(-4_000),
        createdAt: date(-8_000),
        updatedAt: date(-4_000),
      },
      {
        id: "task-video",
        projectId: "project-b",
        userId: "member-b",
        kind: "video",
        status: "succeeded",
        modelKey: "seedance-2.0",
        inputJson: JSON.stringify({ resolution: "720p", duration: 5 }),
        outputAssetId: "asset-video",
        attemptCount: 1,
        startedAt: date(-10_000),
        completedAt: date(-4_000),
        createdAt: date(-11_000),
        updatedAt: date(-4_000),
      },
      {
        id: "task-music",
        projectId: "project-b",
        userId: "member-b",
        kind: "music",
        status: "succeeded",
        modelKey: "coze-music",
        inputJson: "{}",
        attemptCount: 1,
        startedAt: date(-6_000),
        completedAt: date(-4_000),
        createdAt: date(-7_000),
        updatedAt: date(-4_000),
      },
      {
        id: "task-deleted-project",
        projectId: "project-deleted",
        userId: "admin",
        kind: "image",
        status: "succeeded",
        modelKey: "seedream-5.0",
        inputJson: "{}",
        attemptCount: 1,
        createdAt: date(-2_000),
        updatedAt: date(-1_000),
      },
      {
        id: "task-old",
        projectId: "project-a",
        userId: "member-a",
        kind: "image",
        status: "succeeded",
        modelKey: "seedream-5.0",
        inputJson: "{}",
        attemptCount: 1,
        createdAt: date(-40 * DAY),
        updatedAt: date(-40 * DAY + 1_000),
      },
    ])
    .run();

  database
    .insert(operationHealth)
    .values([
      {
        key: "backup",
        status: "ok",
        metricsJson: JSON.stringify({ databaseSnapshots: 1 }),
        alertActive: false,
        lastRunAt: date(-60_000),
        lastSuccessAt: date(-60_000),
        updatedAt: date(-60_000),
      },
      {
        key: "data-integrity",
        status: "ok",
        metricsJson: JSON.stringify({
          checkedRelations: 45,
          blockingIssueCount: 0,
        }),
        alertActive: false,
        lastRunAt: date(-30_000),
        lastSuccessAt: date(-30_000),
        updatedAt: date(-30_000),
      },
    ])
    .run();

  database
    .insert(productEvents)
    .values([
      {
        id: "event-download-image",
        action: "download",
        projectId: "project-a",
        userId: "member-a",
        taskId: "task-image",
        assetId: "asset-image",
        modelKey: "seedream-5.0",
        createdAt: date(-1_500),
      },
      {
        id: "event-download-image-duplicate",
        action: "download",
        projectId: "project-a",
        userId: "member-a",
        taskId: "task-image",
        assetId: "asset-image",
        modelKey: "seedream-5.0",
        createdAt: date(-1_400),
      },
      {
        id: "event-reuse-image",
        action: "reuse",
        projectId: "project-a",
        userId: "member-a",
        taskId: "task-image",
        assetId: "asset-image",
        modelKey: "seedream-5.0",
        createdAt: date(-1_300),
      },
      {
        id: "event-regenerate-image",
        action: "regenerate",
        projectId: "project-a",
        userId: "member-a",
        taskId: "task-image",
        assetId: "asset-image",
        modelKey: "seedream-5.0",
        createdAt: date(-1_200),
      },
      {
        id: "event-download-video",
        action: "download",
        projectId: "project-b",
        userId: "member-b",
        taskId: "task-video",
        assetId: "asset-video",
        modelKey: "seedance-2.0",
        createdAt: date(-1_100),
      },
    ])
    .run();

  return { sqlite, database };
}

test("dashboard statistics aggregate in SQL and paginate project/user ranks", () => {
  const { sqlite, database } = createFixture();
  try {
    const snapshot = loadDashboardStatsSnapshot(database, {
      scope: "all",
      userId: "admin",
      days: 30,
      nowMs: NOW,
    });
    assert.deepEqual(snapshot.data.summary, {
      total: 4,
      succeeded: 3,
      failed: 1,
      successRate: 75,
      assetCount: 3,
      activeUsers: 2,
      estimatedCost: 6.38,
    });
    assert.deepEqual(snapshot.data.engagement, {
      resultCount: 2,
      downloadedCount: 2,
      downloadRate: 100,
      reusedCount: 1,
      reuseRate: 50,
      regeneratedCount: 1,
      regenerateRate: 50,
    });
    assert.equal(snapshot.data.quality.summary.retryCount, 1);
    assert.deepEqual(snapshot.data.byKind, [
      { kind: "video", count: 2 },
      { kind: "image", count: 1 },
      { kind: "music", count: 1 },
    ]);
    assert.equal(snapshot.data.operations.length, 2);
    assert.ok(
      snapshot.data.operations.some((row) => row.key === "data-integrity")
    );
    assert.equal(snapshot.data.byModel.length, 3);
    assert.deepEqual(snapshot.data.quality.summary.timing, {
      terminalCount: 4,
      sampleCount: 4,
      queueP50DurationMs: 1_000,
      queueP95DurationMs: 1_000,
      executionAverageDurationMs: 3_000,
      executionP50DurationMs: 2_000,
      executionP95DurationMs: 6_000,
    });
    assert.deepEqual(snapshot.data.quality.byProvider[0]?.timing, {
      terminalCount: 3,
      sampleCount: 3,
      queueP50DurationMs: 1_000,
      queueP95DurationMs: 1_000,
      executionAverageDurationMs: 3_333,
      executionP50DurationMs: 3_000,
      executionP95DurationMs: 6_000,
    });
    const seedance = snapshot.data.byModel.find(
      (row) => row.modelKey === "seedance-2.0"
    );
    assert.ok(seedance);
    assert.equal(seedance.succeeded, 1);
    assert.equal(seedance.failed, 1);
    assert.deepEqual(seedance.timing, {
      terminalCount: 2,
      sampleCount: 2,
      queueP50DurationMs: 1_000,
      queueP95DurationMs: 1_000,
      executionAverageDurationMs: 4_500,
      executionP50DurationMs: 3_000,
      executionP95DurationMs: 6_000,
    });
    assert.equal(seedance.estimatedCost, 5.94);
    assert.deepEqual(seedance.errors, [
      { code: "ARK_RATE_LIMITED", count: 1 },
    ]);
    assert.deepEqual(seedance.distribution.projects, {
      total: 2,
      items: [
        {
          id: "project-b",
          name: "Beta",
          total: 1,
          succeeded: 1,
          failed: 0,
          estimatedCost: 5.94,
        },
        {
          id: "project-a",
          name: "Alpha",
          total: 1,
          succeeded: 0,
          failed: 1,
          estimatedCost: null,
        },
      ],
    });
    assert.deepEqual(seedance.distribution.users, {
      total: 2,
      items: [
        {
          id: "member-b",
          name: "Bob",
          total: 1,
          succeeded: 1,
          failed: 0,
          estimatedCost: 5.94,
        },
        {
          id: "member-a",
          name: "Alice",
          total: 1,
          succeeded: 0,
          failed: 1,
          estimatedCost: null,
        },
      ],
    });
    assert.equal(
      snapshot.data.quality.byError[0]?.code,
      "ARK_RATE_LIMITED"
    );

    const firstPage = loadDashboardStatsRankings(database, snapshot, {
      projectPage: 1,
      userPage: 1,
      pageSize: 1,
    });
    assert.equal(firstPage.pagination.projects.total, 2);
    assert.equal(firstPage.pagination.projects.totalPages, 2);
    assert.deepEqual(firstPage.byProject[0], {
      id: "project-a",
      name: "Alpha",
      total: 2,
      failed: 1,
      byKind: { image: 1 },
      estimatedCost: 0.44,
    });
    assert.equal(firstPage.pagination.users.total, 2);
    assert.equal(firstPage.byUser[0]?.name, "Alice");

    const secondPage = loadDashboardStatsRankings(database, snapshot, {
      projectPage: 2,
      userPage: 2,
      pageSize: 1,
    });
    assert.equal(secondPage.byProject[0]?.name, "Beta");
    assert.equal(secondPage.byProject[0]?.estimatedCost, 5.94);
    assert.equal(secondPage.byUser[0]?.name, "Bob");
  } finally {
    sqlite.close();
  }
});

test("dashboard timing excludes legacy fallbacks and exposes exact coverage", () => {
  const { sqlite, database } = createFixture();
  try {
    sqlite
      .prepare(
        "UPDATE tasks SET started_at = NULL, completed_at = NULL WHERE id IN ('task-video', 'task-music')"
      )
      .run();

    const snapshot = loadDashboardStatsSnapshot(database, {
      scope: "all",
      userId: "admin",
      days: 30,
      nowMs: NOW,
    });
    assert.deepEqual(snapshot.data.quality.summary.timing, {
      terminalCount: 4,
      sampleCount: 2,
      queueP50DurationMs: 1_000,
      queueP95DurationMs: 1_000,
      executionAverageDurationMs: 2_000,
      executionP50DurationMs: 1_000,
      executionP95DurationMs: 3_000,
    });

    const seedance = snapshot.data.byModel.find(
      (row) => row.modelKey === "seedance-2.0"
    );
    assert.ok(seedance);
    assert.deepEqual(seedance.timing, {
      terminalCount: 2,
      sampleCount: 1,
      queueP50DurationMs: 1_000,
      queueP95DurationMs: 1_000,
      executionAverageDurationMs: 3_000,
      executionP50DurationMs: 3_000,
      executionP95DurationMs: 3_000,
    });

    const music = snapshot.data.byModel.find(
      (row) => row.modelKey === "coze-music"
    );
    assert.ok(music);
    assert.deepEqual(music.timing, {
      terminalCount: 1,
      sampleCount: 0,
      queueP50DurationMs: null,
      queueP95DurationMs: null,
      executionAverageDurationMs: null,
      executionP50DurationMs: null,
      executionP95DurationMs: null,
    });
  } finally {
    sqlite.close();
  }
});

test("model distributions retain contributor totals while capping the visible list", () => {
  const { sqlite, database } = createFixture();
  try {
    const extraIds = Array.from({ length: 6 }, (_, index) => index + 1);
    database
      .insert(users)
      .values(
        extraIds.map((index) => ({
          id: `extra-user-${index}`,
          email: `extra-${index}@example.com`,
          name: `Extra User ${index}`,
          passwordHash: "test",
          role: "member" as const,
          lastSeenAt: date(-1_000 - index),
          createdAt: date(-10 * DAY),
        }))
      )
      .run();
    database
      .insert(projects)
      .values(
        extraIds.map((index) => ({
          id: `extra-project-${index}`,
          name: `Extra Project ${index}`,
          createdBy: "admin",
          visibility: "private" as const,
          createdAt: date(-10 * DAY),
          updatedAt: date(-DAY),
        }))
      )
      .run();
    database
      .insert(projectMembers)
      .values(
        extraIds.flatMap((index) => [
          {
            projectId: `extra-project-${index}`,
            userId: "admin",
            role: "owner" as const,
            addedAt: date(-10 * DAY),
          },
          {
            projectId: `extra-project-${index}`,
            userId: `extra-user-${index}`,
            role: "editor" as const,
            addedAt: date(-10 * DAY),
          },
        ])
      )
      .run();
    database
      .insert(tasks)
      .values(
        extraIds.map((index) => ({
          id: `extra-task-${index}`,
          projectId: `extra-project-${index}`,
          userId: `extra-user-${index}`,
          kind: "video" as const,
          status: "succeeded" as const,
          modelKey: "seedance-2.0",
          inputJson: JSON.stringify({ resolution: "720p", duration: 5 }),
          attemptCount: 1,
          startedAt: date(-3_000 - index),
          completedAt: date(-2_000 - index),
          createdAt: date(-4_000 - index),
          updatedAt: date(-2_000 - index),
        }))
      )
      .run();

    const snapshot = loadDashboardStatsSnapshot(database, {
      scope: "all",
      userId: "admin",
      days: 30,
      nowMs: NOW,
    });
    const seedance = snapshot.data.byModel.find(
      (row) => row.modelKey === "seedance-2.0"
    );
    assert.ok(seedance);
    assert.equal(seedance.distribution.projects.total, 8);
    assert.equal(seedance.distribution.projects.items.length, 5);
    assert.equal(seedance.distribution.users.total, 8);
    assert.equal(seedance.distribution.users.items.length, 5);
    assert.ok(
      seedance.distribution.projects.items.every(
        (row) => row.estimatedCost !== null
      )
    );
    assert.ok(
      seedance.distribution.users.items.every(
        (row) => row.estimatedCost !== null
      )
    );
    assert.ok(
      seedance.distribution.projects.items.every(
        (row) => row.id !== "project-a"
      )
    );
  } finally {
    sqlite.close();
  }
});

test("member statistics stay scoped to joined project memberships", () => {
  const { sqlite, database } = createFixture();
  try {
    const snapshot = loadDashboardStatsSnapshot(database, {
      scope: "mine",
      userId: "member-a",
      days: 30,
      nowMs: NOW,
    });
    assert.equal(snapshot.data.summary.total, 2);
    assert.equal(snapshot.data.summary.assetCount, 2);
    assert.deepEqual(snapshot.data.engagement, {
      resultCount: 1,
      downloadedCount: 1,
      downloadRate: 100,
      reusedCount: 1,
      reuseRate: 100,
      regeneratedCount: 1,
      regenerateRate: 100,
    });
    assert.equal(snapshot.data.summary.activeUsers, 0);
    assert.equal(snapshot.data.operations.length, 0);
    const seedance = snapshot.data.byModel.find(
      (row) => row.modelKey === "seedance-2.0"
    );
    assert.ok(seedance);
    assert.deepEqual(seedance.distribution.projects, {
      total: 1,
      items: [
        {
          id: "project-a",
          name: "Alpha",
          total: 1,
          succeeded: 0,
          failed: 1,
          estimatedCost: null,
        },
      ],
    });
    assert.deepEqual(seedance.distribution.users, { total: 0, items: [] });
    const rankings = loadDashboardStatsRankings(database, snapshot, {
      projectPage: 1,
      userPage: 1,
      pageSize: 10,
    });
    assert.deepEqual(rankings.byProject.map((row) => row.name), ["Alpha"]);
    assert.deepEqual(rankings.byUser, []);
    assert.equal(rankings.pagination.users.total, 0);
  } finally {
    sqlite.close();
  }
});
