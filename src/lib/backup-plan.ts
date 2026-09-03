export const BACKUP_CHUNK_BYTES = 45 * 1024 * 1024;

export interface BackupChunk {
  key: string;
  offset: number;
  bytes: number;
}

export type MediaBackupPlan =
  | {
      mode: "direct";
      key: string;
      manifestKey: string;
      bytes: number;
    }
  | {
      mode: "chunked";
      manifestKey: string;
      chunks: BackupChunk[];
      bytes: number;
      chunkBytes: number;
    };

export function mediaBackupPlan(
  name: string,
  bytes: number,
  chunkBytes = BACKUP_CHUNK_BYTES
): MediaBackupPlan {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("媒体文件大小无效");
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error("备份分片大小无效");
  }
  if (bytes <= chunkBytes) {
    return {
      mode: "direct",
      key: `media/${name}`,
      manifestKey: `media-checksums/${name}.json`,
      bytes,
    };
  }
  const chunks: BackupChunk[] = [];
  for (let offset = 0, index = 0; offset < bytes; offset += chunkBytes, index++) {
    chunks.push({
      key: `media-chunks/${name}/part-${String(index).padStart(5, "0")}`,
      offset,
      bytes: Math.min(chunkBytes, bytes - offset),
    });
  }
  return {
    mode: "chunked",
    manifestKey: `media-checksums/${name}.json`,
    chunks,
    bytes,
    chunkBytes,
  };
}
