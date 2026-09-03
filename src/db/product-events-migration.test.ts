import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("product event migration is additive and indexed for cohort metrics", () => {
  const sqlite = new Database(":memory:");
  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    const columns = sqlite
      .prepare("PRAGMA table_info(product_events)")
      .all() as Array<{ name: string; notnull: number; pk: number }>;
    assert.deepEqual(
      columns.map((column) => column.name),
      [
        "id",
        "action",
        "project_id",
        "user_id",
        "task_id",
        "asset_id",
        "model_key",
        "created_at",
      ]
    );
    assert.equal(columns.find((column) => column.name === "id")?.pk, 1);
    assert.equal(columns.find((column) => column.name === "action")?.notnull, 1);
    assert.equal(
      columns.find((column) => column.name === "project_id")?.notnull,
      1
    );
    const indexes = sqlite
      .prepare("PRAGMA index_list(product_events)")
      .all() as Array<{ name: string }>;
    assert.ok(
      indexes.some(
        (index) => index.name === "product_events_project_created_idx"
      )
    );
    assert.ok(
      indexes.some(
        (index) => index.name === "product_events_task_action_idx"
      )
    );
  } finally {
    sqlite.close();
  }
});
