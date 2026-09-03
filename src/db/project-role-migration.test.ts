import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

test("project role migration preserves editors, backfills owners, and defaults new members to viewer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "haitun-project-roles-"));
  const sqlite = new Database(path.join(directory, "test.db"));

  try {
    sqlite.exec(`
      CREATE TABLE projects (
        id text PRIMARY KEY NOT NULL,
        created_by text NOT NULL
      );
      CREATE TABLE project_members (
        project_id text NOT NULL,
        user_id text NOT NULL,
        added_at integer NOT NULL,
        PRIMARY KEY (project_id, user_id)
      );
      INSERT INTO projects (id, created_by) VALUES ('project-1', 'owner-1');
      INSERT INTO project_members (project_id, user_id, added_at)
      VALUES ('project-1', 'owner-1', 1), ('project-1', 'editor-1', 1);
    `);

    const migration = await readFile(
      path.join(process.cwd(), "drizzle", "0017_goofy_next_avengers.sql"),
      "utf8"
    );
    sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
    sqlite
      .prepare(
        "INSERT INTO project_members (project_id, user_id, added_at) VALUES (?, ?, ?)"
      )
      .run("project-1", "viewer-1", 2);

    const roles = sqlite
      .prepare(
        "SELECT user_id AS userId, role FROM project_members ORDER BY user_id"
      )
      .all() as Array<{ userId: string; role: string }>;
    assert.deepEqual(roles, [
      { userId: "editor-1", role: "editor" },
      { userId: "owner-1", role: "owner" },
      { userId: "viewer-1", role: "viewer" },
    ]);

    const roleColumn = (
      sqlite.prepare("PRAGMA table_info(project_members)").all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>
    ).find((column) => column.name === "role");
    assert.equal(roleColumn?.notnull, 1);
    assert.equal(roleColumn?.dflt_value, "'viewer'");
  } finally {
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});
