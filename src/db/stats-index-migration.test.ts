import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("stats migration adds range and membership indexes without changing data", () => {
  const sqlite = new Database(":memory:");
  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    const indexes = (table: string) =>
      (sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map(
        (row) => row.name
      );

    assert.ok(indexes("tasks").includes("tasks_created_idx"));
    assert.ok(indexes("tasks").includes("tasks_status_created_idx"));
    assert.ok(indexes("assets").includes("assets_created_idx"));
    assert.ok(
      indexes("project_members").includes("project_members_user_project_idx")
    );
    assert.ok(indexes("users").includes("users_last_seen_idx"));
  } finally {
    sqlite.close();
  }
});
