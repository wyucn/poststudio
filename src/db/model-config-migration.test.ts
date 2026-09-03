import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("model configuration migration is additive and stores no credentials", () => {
  const sqlite = new Database(":memory:");
  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    const columns = sqlite
      .prepare("PRAGMA table_info(model_configs)")
      .all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    assert.deepEqual(names, [
      "key",
      "enabled",
      "endpoint_override",
      "capabilities_json",
      "health_status",
      "health_message",
      "failure_streak",
      "health_checked_at",
      "updated_by",
      "created_at",
      "updated_at",
    ]);
    assert.ok(!names.some((name) => /token|secret|api_key/i.test(name)));
    const indexes = sqlite
      .prepare("PRAGMA index_list(model_configs)")
      .all() as Array<{ name: string }>;
    assert.ok(
      indexes.some((index) => index.name === "model_configs_health_updated_idx")
    );
  } finally {
    sqlite.close();
  }
});
