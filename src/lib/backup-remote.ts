import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";

export const BACKUP_BUCKET = "haitun-backup";

export interface BackupObjectInfo {
  name: string;
  bytes: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function supabaseUrl(): string | null {
  return process.env.SUPABASE_URL?.replace(/\/$/, "") ?? null;
}

function headers(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  return { Authorization: `Bearer ${key}`, apikey: key };
}

export function backupRemoteConfigured(): boolean {
  return !!supabaseUrl() && !!process.env.SUPABASE_SERVICE_KEY;
}

export function backupRemoteWriteEnabled(): boolean {
  return (
    process.env.E2E_MODE !== "1" &&
    process.env.BACKUP_REMOTE_WRITE_ENABLED === "1"
  );
}

function assertBackupRemoteWriteEnabled(): void {
  if (!backupRemoteWriteEnabled()) {
    throw new Error("远端备份写入未启用");
  }
}

let bucketReady = false;

export async function ensureBackupBucket(): Promise<void> {
  assertBackupRemoteWriteEnabled();
  if (bucketReady) return;
  const response = await fetch(`${supabaseUrl()}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      id: BACKUP_BUCKET,
      name: BACKUP_BUCKET,
      public: false,
    }),
  });
  if (!response.ok && response.status !== 409) {
    const message = await response.text();
    if (!message.includes("already exists")) {
      throw new Error(`创建备份桶失败: ${response.status}`);
    }
  }
  bucketReady = true;
}

export async function uploadBackupFile(
  key: string,
  filePath: string
): Promise<void> {
  const size = (await fs.stat(filePath)).size;
  await uploadBackupFileRange(key, filePath, 0, size);
}

export async function uploadBackupFileRange(
  key: string,
  filePath: string,
  offset: number,
  size: number
): Promise<void> {
  assertBackupRemoteWriteEnabled();
  let body: BodyInit;
  let duplex: "half" | undefined;
  if (size === 0) {
    body = new Uint8Array();
  } else {
    body = Readable.toWeb(
      createReadStream(filePath, { start: offset, end: offset + size - 1 })
    ) as ReadableStream<Uint8Array>;
    duplex = "half";
  }
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "x-upsert": "true",
    },
    body,
    ...(duplex ? { duplex } : {}),
  };
  const response = await fetch(
    `${supabaseUrl()}/storage/v1/object/${BACKUP_BUCKET}/${key}`,
    init
  );
  if (!response.ok) {
    throw new Error(`备份对象上传失败: ${response.status}`);
  }
}

export async function uploadBackupJson(
  key: string,
  value: unknown
): Promise<void> {
  assertBackupRemoteWriteEnabled();
  const body = Buffer.from(JSON.stringify(value));
  const response = await fetch(
    `${supabaseUrl()}/storage/v1/object/${BACKUP_BUCKET}/${key}`,
    {
      method: "POST",
      headers: {
        ...headers(),
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
        "x-upsert": "true",
      },
      body: new Uint8Array(body),
    }
  );
  if (!response.ok) {
    throw new Error(`备份清单上传失败: ${response.status}`);
  }
}

export async function listBackupObjects(
  prefix: string
): Promise<BackupObjectInfo[]> {
  const rows: BackupObjectInfo[] = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const response = await fetch(
      `${supabaseUrl()}/storage/v1/object/list/${BACKUP_BUCKET}`,
      {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix,
          limit,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`备份对象列举失败: ${response.status}`);
    }
    const page = (await response.json()) as Array<{
      name: string;
      created_at?: string;
      updated_at?: string;
      metadata?: { size?: number };
    }>;
    rows.push(
      ...page.map((row) => ({
        name: row.name,
        bytes: Number.isFinite(Number(row.metadata?.size))
          ? Number(row.metadata?.size)
          : null,
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
      }))
    );
    if (page.length < limit) break;
  }
  return rows;
}

export async function downloadBackupObject(key: string): Promise<Buffer> {
  const response = await fetch(
    `${supabaseUrl()}/storage/v1/object/${BACKUP_BUCKET}/${key}`,
    { headers: headers() }
  );
  if (!response.ok) {
    throw new Error(`备份对象下载失败: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function downloadBackupJson(key: string): Promise<unknown> {
  const body = await downloadBackupObject(key);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("备份清单格式无效");
  }
}

function validBackupObjectKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.startsWith("/") &&
    !key.includes("\\") &&
    key
      .split("/")
      .every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

export async function deleteBackupObjects(
  keys: string[]
): Promise<Set<string>> {
  const prefixes = [...new Set(keys)];
  if (!prefixes.length) return new Set();
  assertBackupRemoteWriteEnabled();
  if (prefixes.some((key) => !validBackupObjectKey(key))) {
    throw new Error("备份对象名无效");
  }
  const body = Buffer.from(JSON.stringify({ prefixes }));
  const response = await fetch(
    `${supabaseUrl()}/storage/v1/object/${BACKUP_BUCKET}`,
    {
      method: "DELETE",
      headers: {
        ...headers(),
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
      },
      body: new Uint8Array(body),
    }
  );
  if (!response.ok) {
    throw new Error(`备份对象删除失败: ${response.status}`);
  }
  const rows = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error("备份对象删除响应无效");
  }
  const requested = new Set(prefixes);
  return new Set(
    rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const name = (row as { name?: unknown }).name;
      return typeof name === "string" && requested.has(name) ? [name] : [];
    })
  );
}
