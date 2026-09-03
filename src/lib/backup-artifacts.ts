import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { MediaBackupPlan } from "@/lib/backup-plan";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface BackupObjectDigest {
  key: string;
  offset: number;
  bytes: number;
  sha256: string;
}

export interface MediaBackupManifest {
  version: 2;
  kind: "media";
  name: string;
  mode: "direct" | "chunked";
  bytes: number;
  sha256: string;
  createdAt: string;
  objects: BackupObjectDigest[];
}

export interface DatabaseBackupManifest {
  version: 1;
  kind: "database";
  snapshotKey: string;
  bytes: number;
  sha256: string;
  createdAt: string;
}

export interface ParsedMediaBackup {
  version: 1 | 2;
  name: string;
  mode: "direct" | "chunked";
  bytes: number;
  sha256: string | null;
  objects: Array<{
    key: string;
    offset: number;
    bytes: number;
    sha256: string | null;
  }>;
}

function validBytes(value: unknown, allowZero = true): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (allowZero ? value >= 0 : value > 0)
  );
}

function validMediaName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function validateObjects(
  name: string,
  mode: "direct" | "chunked",
  bytes: number,
  objects: ParsedMediaBackup["objects"]
): boolean {
  if (!objects.length) return false;
  if (mode === "direct") {
    return (
      objects.length === 1 &&
      objects[0].key === `media/${name}` &&
      objects[0].offset === 0 &&
      objects[0].bytes === bytes
    );
  }
  let offset = 0;
  for (const [index, object] of objects.entries()) {
    if (
      object.key !==
        `media-chunks/${name}/part-${String(index).padStart(5, "0")}` ||
      object.offset !== offset ||
      !validBytes(object.bytes, false)
    ) {
      return false;
    }
    offset += object.bytes;
  }
  return offset === bytes;
}

export function mediaManifestKey(name: string): string {
  if (!validMediaName(name)) throw new Error("媒体对象名无效");
  return `media-checksums/${name}.json`;
}

export function legacyMediaManifestKey(name: string): string {
  if (!validMediaName(name)) throw new Error("媒体对象名无效");
  return `media-manifests/${name}.json`;
}

export function databaseManifestKey(snapshotKey: string): string {
  if (!/^db\/haitun-\d{4}-\d{2}-\d{2}\.db$/.test(snapshotKey)) {
    throw new Error("数据库快照名无效");
  }
  return `db-manifests/${snapshotKey.slice("db/".length)}.json`;
}

export async function sha256FileRange(
  filePath: string,
  offset = 0,
  bytes?: number
): Promise<string> {
  const hash = createHash("sha256");
  if (bytes === 0) return hash.digest("hex");
  const stream = createReadStream(filePath, {
    start: offset,
    ...(bytes === undefined ? {} : { end: offset + bytes - 1 }),
  });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export function sha256Buffer(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createMediaBackupManifest(input: {
  name: string;
  plan: MediaBackupPlan;
  filePath: string;
  createdAt?: Date;
}): Promise<MediaBackupManifest> {
  const sha256 = await sha256FileRange(input.filePath);
  const objects: BackupObjectDigest[] = [];
  if (input.plan.mode === "direct") {
    objects.push({
      key: input.plan.key,
      offset: 0,
      bytes: input.plan.bytes,
      sha256,
    });
  } else {
    for (const chunk of input.plan.chunks) {
      objects.push({
        ...chunk,
        sha256: await sha256FileRange(
          input.filePath,
          chunk.offset,
          chunk.bytes
        ),
      });
    }
  }
  return {
    version: 2,
    kind: "media",
    name: input.name,
    mode: input.plan.mode,
    bytes: input.plan.bytes,
    sha256,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    objects,
  };
}

export function createDatabaseBackupManifest(input: {
  snapshotKey: string;
  bytes: number;
  sha256: string;
  createdAt?: Date;
}): DatabaseBackupManifest {
  databaseManifestKey(input.snapshotKey);
  if (!validBytes(input.bytes) || !SHA256_PATTERN.test(input.sha256)) {
    throw new Error("数据库校验清单无效");
  }
  return {
    version: 1,
    kind: "database",
    snapshotKey: input.snapshotKey,
    bytes: input.bytes,
    sha256: input.sha256,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
}

export function parseDatabaseBackupManifest(
  value: unknown,
  expectedSnapshotKey?: string
): DatabaseBackupManifest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DatabaseBackupManifest>;
  if (
    candidate.version !== 1 ||
    candidate.kind !== "database" ||
    typeof candidate.snapshotKey !== "string" ||
    !validBytes(candidate.bytes) ||
    typeof candidate.sha256 !== "string" ||
    !SHA256_PATTERN.test(candidate.sha256) ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    (expectedSnapshotKey !== undefined &&
      candidate.snapshotKey !== expectedSnapshotKey)
  ) {
    return null;
  }
  try {
    databaseManifestKey(candidate.snapshotKey);
  } catch {
    return null;
  }
  return candidate as DatabaseBackupManifest;
}

export function parseMediaBackupManifest(
  value: unknown,
  expectedName?: string
): ParsedMediaBackup | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const name = candidate.name;
  if (!validMediaName(name) || (expectedName && name !== expectedName)) {
    return null;
  }
  if (candidate.version === 1) {
    const chunks = candidate.chunks;
    if (!validBytes(candidate.bytes) || !Array.isArray(chunks)) return null;
    let offset = 0;
    const objects = chunks.map((item) => {
      const chunk = item as Record<string, unknown>;
      const object = {
        key: chunk.key,
        offset,
        bytes: chunk.bytes,
        sha256: null,
      };
      if (typeof object.key !== "string" || !validBytes(object.bytes, false)) {
        return null;
      }
      offset += object.bytes;
      return object;
    });
    if (objects.some((item) => item === null)) return null;
    const parsed = {
      version: 1 as const,
      name,
      mode: "chunked" as const,
      bytes: candidate.bytes,
      sha256: null,
      objects: objects as ParsedMediaBackup["objects"],
    };
    return validateObjects(name, parsed.mode, parsed.bytes, parsed.objects)
      ? parsed
      : null;
  }
  if (
    candidate.version !== 2 ||
    candidate.kind !== "media" ||
    (candidate.mode !== "direct" && candidate.mode !== "chunked") ||
    !validBytes(candidate.bytes) ||
    typeof candidate.sha256 !== "string" ||
    !SHA256_PATTERN.test(candidate.sha256) ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    !Array.isArray(candidate.objects)
  ) {
    return null;
  }
  const mode: "direct" | "chunked" =
    candidate.mode === "direct" ? "direct" : "chunked";
  const objects = candidate.objects.map((item) => {
    const object = item as Record<string, unknown>;
    if (
      typeof object.key !== "string" ||
      !validBytes(object.offset) ||
      !validBytes(object.bytes) ||
      typeof object.sha256 !== "string" ||
      !SHA256_PATTERN.test(object.sha256)
    ) {
      return null;
    }
    return {
      key: object.key,
      offset: object.offset,
      bytes: object.bytes,
      sha256: object.sha256,
    };
  });
  if (objects.some((item) => item === null)) return null;
  const parsed = {
    version: 2 as const,
    name,
    mode,
    bytes: candidate.bytes,
    sha256: candidate.sha256,
    objects: objects as ParsedMediaBackup["objects"],
  };
  return validateObjects(name, parsed.mode, parsed.bytes, parsed.objects)
    ? parsed
    : null;
}

export function mediaDeletionKeys(
  name: string,
  manifest: ParsedMediaBackup | null
): string[] {
  if (!validMediaName(name)) throw new Error("媒体对象名无效");
  return [
    `media/${name}`,
    ...(manifest?.objects.map((object) => object.key) ?? []),
    mediaManifestKey(name),
    legacyMediaManifestKey(name),
  ].filter((key, index, values) => values.indexOf(key) === index);
}
