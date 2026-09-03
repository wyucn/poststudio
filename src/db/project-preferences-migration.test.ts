import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("project preference migration is additive and indexed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "haitun-project-pref-"));
  const sqlite = new Database(path.join(directory, "test.db"));

  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });

    const columns = sqlite
      .prepare("PRAGMA table_info(project_preferences)")
      .all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    assert.deepEqual(
      columns.map((column) => column.name),
      ["user_id", "project_id", "favorite", "last_opened_at", "updated_at"]
    );
    assert.equal(columns.find((column) => column.name === "user_id")?.pk, 1);
    assert.equal(columns.find((column) => column.name === "project_id")?.pk, 2);
    assert.equal(columns.find((column) => column.name === "favorite")?.notnull, 1);
    assert.match(
      columns.find((column) => column.name === "favorite")?.dflt_value ?? "",
      /false|0/i
    );
    assert.equal(
      columns.find((column) => column.name === "last_opened_at")?.notnull,
      0
    );

    const indexes = sqlite
      .prepare("PRAGMA index_list(project_preferences)")
      .all() as Array<{ name: string }>;
    assert.ok(
      indexes.some(
        (index) => index.name === "project_preferences_user_favorite_idx"
      )
    );
    assert.ok(
      indexes.some(
        (index) => index.name === "project_preferences_user_opened_idx"
      )
    );
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});
