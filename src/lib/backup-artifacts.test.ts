import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDatabaseBackupManifest,
  createMediaBackupManifest,
  databaseManifestKey,
  mediaDeletionKeys,
  parseDatabaseBackupManifest,
  parseMediaBackupManifest,
  sha256Buffer,
} from "./backup-artifacts";
import { mediaBackupPlan } from "./backup-plan";

test("media checksum manifests cover direct and chunked objects", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "haitun-manifest-"));
  const filePath = path.join(directory, "asset.bin");
  const body = Buffer.from("abcdefghij");
  await writeFile(filePath, body);
  try {
    const direct = await createMediaBackupManifest({
      name: "asset.bin",
      plan: mediaBackupPlan("asset.bin", body.length, 45),
      filePath,
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    assert.equal(direct.mode, "direct");
    assert.equal(direct.sha256, sha256Buffer(body));
    assert.equal(direct.objects[0]?.sha256, direct.sha256);
    const parsedDirect = parseMediaBackupManifest(direct, "asset.bin");
    assert.equal(parsedDirect?.version, 2);
    assert.equal(parsedDirect?.mode, "direct");
    assert.equal(parsedDirect?.sha256, direct.sha256);
    assert.deepEqual(parsedDirect?.objects, direct.objects);

    const chunked = await createMediaBackupManifest({
      name: "asset.bin",
      plan: mediaBackupPlan("asset.bin", body.length, 4),
      filePath,
    });
    assert.equal(chunked.mode, "chunked");
    assert.deepEqual(
      chunked.objects.map((object) => object.bytes),
      [4, 4, 2]
    );
    assert.equal(chunked.objects[0]?.sha256, sha256Buffer(body.subarray(0, 4)));
    const parsedChunked = parseMediaBackupManifest(chunked, "asset.bin");
    assert.equal(parsedChunked?.version, 2);
    assert.equal(parsedChunked?.mode, "chunked");
    assert.equal(parsedChunked?.sha256, chunked.sha256);
    assert.deepEqual(parsedChunked?.objects, chunked.objects);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("media manifests reject traversal and cross-object deletion keys", () => {
  const legacy = {
    version: 1,
    name: "asset.mp4",
    bytes: 10,
    chunkBytes: 5,
    chunks: [
      { key: "media-chunks/asset.mp4/part-00000", bytes: 5 },
      { key: "media-chunks/asset.mp4/part-00001", bytes: 5 },
    ],
  };
  const parsed = parseMediaBackupManifest(legacy, "asset.mp4");
  assert.equal(parsed?.version, 1);
  assert.deepEqual(mediaDeletionKeys("asset.mp4", parsed), [
    "media/asset.mp4",
    "media-chunks/asset.mp4/part-00000",
    "media-chunks/asset.mp4/part-00001",
    "media-checksums/asset.mp4.json",
    "media-manifests/asset.mp4.json",
  ]);

  assert.equal(
    parseMediaBackupManifest(
      {
        ...legacy,
        chunks: [{ key: "db/haitun-2026-08-05.db", bytes: 10 }],
      },
      "asset.mp4"
    ),
    null
  );
  assert.throws(() => mediaDeletionKeys("../asset.mp4", null));
});

test("database checksum manifests bind the exact dated snapshot", () => {
  const body = Buffer.from("sqlite-backup");
  const manifest = createDatabaseBackupManifest({
    snapshotKey: "db/haitun-2026-08-05.db",
    bytes: body.length,
    sha256: sha256Buffer(body),
    createdAt: new Date("2026-08-05T00:00:00.000Z"),
  });
  assert.equal(
    databaseManifestKey(manifest.snapshotKey),
    "db-manifests/haitun-2026-08-05.db.json"
  );
  assert.deepEqual(
    parseDatabaseBackupManifest(manifest, manifest.snapshotKey),
    manifest
  );
  assert.equal(
    parseDatabaseBackupManifest(manifest, "db/haitun-2026-08-04.db"),
    null
  );
});
