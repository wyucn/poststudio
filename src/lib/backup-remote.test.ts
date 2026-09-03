import assert from "node:assert/strict";
import test from "node:test";
import {
  backupRemoteWriteEnabled,
  deleteBackupObjects,
  ensureBackupBucket,
  uploadBackupFileRange,
  uploadBackupJson,
} from "./backup-remote";

function configureRemote(t: test.TestContext) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_KEY;
  const originalWriteEnabled = process.env.BACKUP_REMOTE_WRITE_ENABLED;
  const originalE2eMode = process.env.E2E_MODE;
  process.env.SUPABASE_URL = "https://backup.example.test/";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.BACKUP_REMOTE_WRITE_ENABLED = "1";
  delete process.env.E2E_MODE;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = originalKey;
    if (originalWriteEnabled === undefined)
      delete process.env.BACKUP_REMOTE_WRITE_ENABLED;
    else process.env.BACKUP_REMOTE_WRITE_ENABLED = originalWriteEnabled;
    if (originalE2eMode === undefined) delete process.env.E2E_MODE;
    else process.env.E2E_MODE = originalE2eMode;
  });
}

test("backup mutations require the explicit environment write gate", async (t) => {
  configureRemote(t);
  delete process.env.BACKUP_REMOTE_WRITE_ENABLED;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json([]);
  };

  assert.equal(backupRemoteWriteEnabled(), false);
  await assert.rejects(ensureBackupBucket(), /远端备份写入未启用/);
  await assert.rejects(
    uploadBackupFileRange("media/example.bin", "unused", 0, 0),
    /远端备份写入未启用/
  );
  await assert.rejects(
    uploadBackupJson("media-checksums/example.bin.json", {}),
    /远端备份写入未启用/
  );
  await assert.rejects(
    deleteBackupObjects(["db/haitun-2026-08-01.db"]),
    /远端备份写入未启用/
  );
  assert.equal(called, false);

  process.env.BACKUP_REMOTE_WRITE_ENABLED = "true";
  assert.equal(backupRemoteWriteEnabled(), false);
  process.env.BACKUP_REMOTE_WRITE_ENABLED = "1";
  assert.equal(backupRemoteWriteEnabled(), true);
  process.env.E2E_MODE = "1";
  assert.equal(backupRemoteWriteEnabled(), false);
});

test("backup deletion uses the idempotent batch endpoint", async (t) => {
  configureRemote(t);
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return Response.json([
      { name: "db/haitun-2026-08-01.db" },
      { name: "db-manifests/haitun-2026-08-01.db.json" },
    ]);
  };

  const deleted = await deleteBackupObjects([
    "db/haitun-2026-08-01.db",
    "db-manifests/haitun-2026-08-01.db.json",
    "db/haitun-2026-08-01.db",
  ]);

  assert.equal(
    request?.url,
    "https://backup.example.test/storage/v1/object/haitun-backup"
  );
  assert.equal(request?.init?.method, "DELETE");
  assert.deepEqual(
    JSON.parse(Buffer.from(request?.init?.body as Uint8Array).toString("utf8")),
    {
      prefixes: [
        "db/haitun-2026-08-01.db",
        "db-manifests/haitun-2026-08-01.db.json",
      ],
    }
  );
  assert.deepEqual([...deleted], [
    "db/haitun-2026-08-01.db",
    "db-manifests/haitun-2026-08-01.db.json",
  ]);
});

test("backup deletion treats already missing objects as a successful no-op", async (t) => {
  configureRemote(t);
  globalThis.fetch = async () => Response.json([]);
  assert.deepEqual(
    [...(await deleteBackupObjects(["db/legacy-without-manifest.db"]))],
    []
  );
});

test("backup deletion rejects unsafe keys before contacting storage", async (t) => {
  configureRemote(t);
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json([]);
  };
  await assert.rejects(deleteBackupObjects(["../haitun-backup"]), /对象名无效/);
  await assert.rejects(deleteBackupObjects([""]), /对象名无效/);
  assert.equal(called, false);
});

test("backup deletion preserves stable errors for provider failures", async (t) => {
  configureRemote(t);
  globalThis.fetch = async () =>
    Response.json({ message: "provider detail" }, { status: 500 });
  await assert.rejects(
    deleteBackupObjects(["db/haitun-2026-08-01.db"]),
    /备份对象删除失败: 500/
  );
});
