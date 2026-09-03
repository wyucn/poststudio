import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";
import {
  createDatabaseBackupManifest,
  sha256Buffer,
  type MediaBackupManifest,
} from "./backup-artifacts";
import {
  runBackupRestoreDrill,
  type BackupReadStore,
} from "./backup-restore";
import type { BackupObjectInfo } from "./backup-remote";

function row(name: string, bytes: number | null): BackupObjectInfo {
  return { name, bytes, createdAt: null, updatedAt: null };
}

test("restore drill rebuilds a migrated database and verifies direct and chunked media", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "haitun-restore-test-"));
  const sourcePath = path.join(root, "source.db");
  const source = new Database(sourcePath);
  migrate(drizzle(source, { schema }), {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  source.close();
  const databaseBody = await readFile(sourcePath);

  const directBody = Buffer.from("direct-media");
  const chunkOne = Buffer.from("chunk-one");
  const chunkTwo = Buffer.from("chunk-two");
  const chunkedBody = Buffer.concat([chunkOne, chunkTwo]);
  const chunkedManifest: MediaBackupManifest = {
    version: 2,
    kind: "media",
    name: "chunked.bin",
    mode: "chunked",
    bytes: chunkedBody.length,
    sha256: sha256Buffer(chunkedBody),
    createdAt: "2026-08-05T00:00:00.000Z",
    objects: [
      {
        key: "media-chunks/chunked.bin/part-00000",
        offset: 0,
        bytes: chunkOne.length,
        sha256: sha256Buffer(chunkOne),
      },
      {
        key: "media-chunks/chunked.bin/part-00001",
        offset: chunkOne.length,
        bytes: chunkTwo.length,
        sha256: sha256Buffer(chunkTwo),
      },
    ],
  };
  const directManifest: MediaBackupManifest = {
    version: 2,
    kind: "media",
    name: "direct.bin",
    mode: "direct",
    bytes: directBody.length,
    sha256: sha256Buffer(directBody),
    createdAt: "2026-08-05T00:00:00.000Z",
    objects: [
      {
        key: "media/direct.bin",
        offset: 0,
        bytes: directBody.length,
        sha256: sha256Buffer(directBody),
      },
    ],
  };
  const databaseManifest = createDatabaseBackupManifest({
    snapshotKey: "db/haitun-2026-08-05.db",
    bytes: databaseBody.length,
    sha256: sha256Buffer(databaseBody),
  });
  const bodies = new Map<string, Buffer>([
    ["db/haitun-2026-08-05.db", databaseBody],
    ["media/direct.bin", directBody],
    ["media-chunks/chunked.bin/part-00000", chunkOne],
    ["media-chunks/chunked.bin/part-00001", chunkTwo],
  ]);
  const json = new Map<string, unknown>([
    ["db-manifests/haitun-2026-08-05.db.json", databaseManifest],
    ["media-checksums/chunked.bin.json", chunkedManifest],
    ["media-checksums/direct.bin.json", directManifest],
  ]);
  const listings = new Map<string, BackupObjectInfo[]>([
    ["db/", [row("haitun-2026-08-05.db", databaseBody.length)]],
    ["db-manifests/", [row("haitun-2026-08-05.db.json", null)]],
    ["media/", [row("direct.bin", directBody.length)]],
    [
      "media-checksums/",
      [row("chunked.bin.json", null), row("direct.bin.json", null)],
    ],
    ["media-manifests/", [row("chunked.bin.json", null)]],
  ]);
  const store: BackupReadStore = {
    async list(prefix) {
      return listings.get(prefix) ?? [];
    },
    async download(key) {
      const value = bodies.get(key);
      if (!value) throw new Error("missing fixture object");
      return value;
    },
    async downloadJson(key) {
      const value = json.get(key);
      if (!value) throw new Error("missing fixture manifest");
      return value;
    },
  };

  try {
    const metrics = await runBackupRestoreDrill({
      targetDir: path.join(root, "restored"),
      mediaSamples: 2,
      store,
      now: new Date(databaseManifest.createdAt),
    });
    assert.equal(metrics.objectives.withinRpo, true);
    assert.equal(metrics.objectives.rpoOverdue, false);
    assert.equal(
      metrics.objectives.logicalBackupBytes,
      databaseBody.length + directBody.length + chunkedBody.length
    );
    assert.equal(metrics.database.checksumVerified, true);
    assert.equal(metrics.database.quickCheckFailures, 0);
    assert.equal(metrics.database.foreignKeyViolations, 0);
    assert.equal(metrics.media.restored, 2);
    assert.equal(metrics.media.direct, 1);
    assert.equal(metrics.media.chunked, 1);
    assert.equal(metrics.media.checksumVerified, 2);
    assert.equal(metrics.media.legacySizeVerified, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
