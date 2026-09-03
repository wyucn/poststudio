import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("backup media tombstone migration is additive and indexed", () => {
  const sqlite = new Database(":memory:");
  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    const columns = sqlite
      .prepare("PRAGMA table_info(backup_media_tombstones)")
      .all() as Array<{ name: string; notnull: number; pk: number }>;
    assert.deepEqual(
      columns.map((column) => column.name),
      [
        "object_key",
        "asset_id",
        "asset_json",
        "deleted_at",
        "purge_after",
        "remote_purged_at",
      ]
    );
    assert.equal(columns.find((column) => column.name === "object_key")?.pk, 1);
    assert.equal(columns.find((column) => column.name === "deleted_at")?.notnull, 1);
    assert.equal(columns.find((column) => column.name === "purge_after")?.notnull, 1);
    const indexes = sqlite
      .prepare("PRAGMA index_list(backup_media_tombstones)")
      .all() as Array<{ name: string }>;
    assert.ok(
      indexes.some(
        (index) => index.name === "backup_media_tombstones_purge_idx"
      )
    );
  } finally {
    sqlite.close();
  }
});
