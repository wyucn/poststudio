import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("asset transcript migration is additive and keeps editable recognition cache", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "haitun-transcript-"));
  const sqlite = new Database(path.join(directory, "test.db"));

  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });

    const columns = sqlite
      .prepare("PRAGMA table_info(asset_transcripts)")
      .all() as Array<{
      name: string;
      notnull: number;
      pk: number;
    }>;
    assert.deepEqual(
      columns.map((column) => column.name),
      [
        "asset_id",
        "project_id",
        "task_id",
        "source_text",
        "corrected_text",
        "subtitle_srt",
        "updated_by",
        "created_at",
        "updated_at",
      ]
    );
    assert.equal(columns.find((column) => column.name === "asset_id")?.pk, 1);
    assert.equal(
      columns.find((column) => column.name === "project_id")?.notnull,
      1
    );
    assert.equal(columns.find((column) => column.name === "source_text")?.notnull, 0);
    assert.equal(
      columns.find((column) => column.name === "corrected_text")?.notnull,
      0
    );

    const indexes = sqlite
      .prepare("PRAGMA index_list(asset_transcripts)")
      .all() as Array<{ name: string }>;
    assert.ok(
      indexes.some(
        (index) => index.name === "asset_transcripts_project_updated_idx"
      )
    );
    assert.ok(
      indexes.some((index) => index.name === "asset_transcripts_task_idx")
    );
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});
