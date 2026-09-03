import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("project lifecycle migration adds nullable archive and delete timestamps", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "haitun-project-lifecycle-"));
  const sqlite = new Database(path.join(directory, "test.db"));

  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });

    const columns = sqlite
      .prepare("PRAGMA table_info(projects)")
      .all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const byName = new Map(columns.map((column) => [column.name, column]));
    assert.equal(byName.get("archived_at")?.notnull, 0);
    assert.equal(byName.get("archived_at")?.dflt_value, null);
    assert.equal(byName.get("deleted_at")?.notnull, 0);
    assert.equal(byName.get("deleted_at")?.dflt_value, null);
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});
