/**
 * Coze 媒体中转桥（服务端专用）。
 *
 * 剪辑插件在 Coze 云端运行，需要公网可达的素材 URL；而本站部署在公司内网域名下，
 * Coze 无法直接回拉。因此把素材临时上传到 Supabase Storage 公开桶（与 Coze 同在
 * 火山云，公网可达），任务结束后立即删除中转对象。
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import sharp from "sharp";
import {
  createObjectReadStream,
  extForMime,
  getObject,
  getObjectSize,
} from "@/lib/storage";
import { assertBridgeMediaSize } from "@/lib/media-limits";
import { HttpError } from "@/lib/http-error";
import { errorDiagnostic, redactSensitiveText } from "@/lib/error-safety";
import { fetchBridgeWithRetry } from "@/lib/coze/bridge-retry";
import {
  recordOperationFailure,
  recordOperationSkipped,
  recordOperationSuccess,
} from "@/lib/operations/health";

const BUCKET = "coze-bridge";
const IMAGE_MAX_EDGE = 2048;
const IMAGE_PASSTHROUGH_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

function supabaseUrl(): string {
  const u = process.env.SUPABASE_URL;
  if (!u) throw new Error("缺少 SUPABASE_URL 环境变量");
  return u.replace(/\/$/, "");
}

function serviceKey(): string {
  const k = process.env.SUPABASE_SERVICE_KEY;
  if (!k) throw new Error("缺少 SUPABASE_SERVICE_KEY 环境变量");
  return k;
}

function headers(): Record<string, string> {
  const k = serviceKey();
  return { Authorization: `Bearer ${k}`, apikey: k };
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const res = await fetchBridgeWithRetry(() =>
    fetch(`${supabaseUrl()}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    })
  );
  // 200 创建成功；409 已存在
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    if (!text.includes("already exists")) {
      throw new Error(`创建中转桶失败: ${res.status} ${text.slice(0, 200)}`);
    }
  }
  bucketReady = true;
}

export interface BridgedMedia {
  /** Coze 可拉取的公开 URL */
  url: string;
  /** 用于清理的对象 key */
  key: string;
}

/** 上传媒体到中转桶，返回公开 URL。ext 可覆盖按 mime 推断的扩展名（如 srt） */
export async function bridgeUpload(
  buffer: Buffer,
  mime: string,
  ext?: string
): Promise<BridgedMedia> {
  assertBridgeMediaSize(buffer.length, mime);
  await ensureBucket();
  const key = `bridge/${randomUUID()}.${ext || extForMime(mime)}`;
  const res = await fetchBridgeWithRetry(() =>
    fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${key}`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": mime, "x-upsert": "true" },
      body: new Uint8Array(buffer),
    })
  );
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    console.error(
      `[media-bridge] buffer upload failed: HTTP ${res.status} ${redactSensitiveText(detail)}`
    );
    if (res.status === 413) {
      throw new HttpError(
        413,
        "参考素材超过中转服务允许的文件大小，请压缩后重新上传。",
        "MEDIA_BRIDGE_TOO_LARGE"
      );
    }
    throw new HttpError(
      503,
      "中转服务暂时不可用，请稍后重试。",
      "MEDIA_BRIDGE_UNAVAILABLE"
    );
  }
  return { url: `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${key}`, key };
}

function normalizedImageMime(mime: string | null | undefined, format?: string): string {
  const declared = mime?.split(";")[0].trim().toLowerCase();
  if (declared === "image/png" || declared === "image/jpeg" || declared === "image/webp") {
    return declared;
  }
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "image/jpeg";
}

/**
 * 智能处理参考图后中转：
 * - 小于等于 2048px 且不超过 8 MiB 的图片直接上传，避免无意义的画质损失；
 * - 大尺寸或大文件才转为 WebP，长边限制为 2048px；
 * - 若无需缩放且转码结果反而更大，则保留原图。
 * 图片专用——视频/音频请用 bridgeUploadObject（流式，不压缩）。
 */
export async function bridgeUploadImage(
  objectKey: string,
  mime?: string | null
): Promise<BridgedMedia> {
  const source = await getObject(objectKey);
  const metadata = await sharp(source).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const needsResize = Math.max(width, height) > IMAGE_MAX_EDGE;
  const canPassThrough =
    !needsResize && source.length <= IMAGE_PASSTHROUGH_MAX_BYTES;

  if (canPassThrough) {
    const sourceMime = normalizedImageMime(mime, metadata.format);
    return bridgeUpload(source, sourceMime, extForMime(sourceMime));
  }

  const compressed = await sharp(source)
    .rotate() // 尊重 EXIF 方向
    .resize({
      width: IMAGE_MAX_EDGE,
      height: IMAGE_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 90 })
    .toBuffer();

  if (!needsResize && compressed.length >= source.length) {
    const sourceMime = normalizedImageMime(mime, metadata.format);
    if (source.length > IMAGE_UPLOAD_MAX_BYTES) {
      throw new HttpError(
        413,
        "参考图超过 50 MB 中转上限，请先压缩后重试",
        "MEDIA_BRIDGE_TOO_LARGE"
      );
    }
    return bridgeUpload(source, sourceMime, extForMime(sourceMime));
  }

  if (compressed.length > IMAGE_UPLOAD_MAX_BYTES) {
    throw new HttpError(
      413,
      "参考图压缩后仍超过 50 MB 中转上限",
      "MEDIA_BRIDGE_TOO_LARGE"
    );
  }
  return bridgeUpload(compressed, "image/webp", "webp");
}

/** 从本地对象流式上传中转桶，避免视频/音频整体进入内存。 */
export async function bridgeUploadObject(
  objectKey: string,
  mime: string
): Promise<BridgedMedia> {
  const size = await getObjectSize(objectKey);
  assertBridgeMediaSize(size, mime);
  await ensureBucket();
  const key = `bridge/${randomUUID()}.${extForMime(mime)}`;
  const res = await fetchBridgeWithRetry(() => {
    const body = Readable.toWeb(
      createObjectReadStream(objectKey)
    ) as ReadableStream<Uint8Array>;
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: {
        ...headers(),
        "Content-Type": mime,
        "Content-Length": String(size),
        "x-upsert": "true",
      },
      body,
      duplex: "half",
    };
    return fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${key}`, init);
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    console.error(
      `[media-bridge] object upload failed: HTTP ${res.status} ${redactSensitiveText(detail)}`
    );
    if (res.status === 413) {
      throw new HttpError(
        413,
        "参考素材超过中转服务允许的文件大小，请压缩或裁剪后重新上传。",
        "MEDIA_BRIDGE_TOO_LARGE"
      );
    }
    throw new HttpError(
      503,
      "中转服务暂时不可用，请稍后重试。",
      "MEDIA_BRIDGE_UNAVAILABLE"
    );
  }
  return { url: `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${key}`, key };
}

/** 删除中转对象（尽力而为，失败不抛错）。 */
export async function bridgeCleanup(
  keys: string[]
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      const response = await fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${key}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (response.ok || response.status === 404) deleted++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}

/** 启动中转桶孤儿对象定期清理（每 3 小时一次，开机延迟 10 分钟首跑）。 */
export function startBridgeSweeper() {
  const g = globalThis as unknown as { __haitunBridgeSweep?: NodeJS.Timeout };
  if (g.__haitunBridgeSweep) return;
  const run = () => void runBridgeSweepCycle();
  setTimeout(run, 10 * 60 * 1000);
  g.__haitunBridgeSweep = setInterval(run, 3 * 60 * 60 * 1000);
  console.log("[haitun-post-studio] 中转桶清理调度器已启动");
}

/**
 * 兜底清理：删除公开桶里超过 maxAgeMs 的残留中转对象。
 * 正常流程结束会即时删除，但进程崩溃 / DELETE 失败会留下孤儿对象永久暴露在公开桶，
 * 故需定期扫描。中转对象都在 bridge/ 前缀下、仅在单次合成期间有效，超期即可安全删除。
 */
export async function sweepBridgeOrphans(
  maxAgeMs = 6 * 60 * 60 * 1000
): Promise<BridgeSweepMetrics> {
  const startedAt = Date.now();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return {
      configured: false,
      scanned: 0,
      stale: 0,
      deleted: 0,
      deleteFailed: 0,
      durationMs: Date.now() - startedAt,
    };
  }
  const pageSize = 1000;
  const items: { name: string; created_at?: string }[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
      `${supabaseUrl()}/storage/v1/object/list/${BUCKET}`,
      {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: "bridge/",
          limit: pageSize,
          offset,
          sortBy: { column: "created_at", order: "asc" },
        }),
      }
    );
    if (!res.ok) {
      throw new Error(`列举中转桶失败: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const page = (await res.json()) as { name: string; created_at?: string }[];
    items.push(...page);
    if (page.length < pageSize) break;
  }
  const cutoff = Date.now() - maxAgeMs;
  const stale = items
    .filter((it) => {
      const t = it.created_at ? Date.parse(it.created_at) : NaN;
      return Number.isFinite(t) && t < cutoff;
    })
    .map((it) => `bridge/${it.name}`);
  const cleanup = await bridgeCleanup(stale);
  return {
    configured: true,
    scanned: items.length,
    stale: stale.length,
    deleted: cleanup.deleted,
    deleteFailed: cleanup.failed,
    durationMs: Date.now() - startedAt,
  };
}

export interface BridgeSweepMetrics {
  configured: boolean;
  scanned: number;
  stale: number;
  deleted: number;
  deleteFailed: number;
  durationMs: number;
}

export async function runBridgeSweepCycle(): Promise<void> {
  const startedAt = Date.now();
  try {
    const metrics = await sweepBridgeOrphans();
    console.log("[bridge-sweep]", metrics);
    if (!metrics.configured) {
      recordOperationSkipped("bridge-sweep", metrics);
    } else if (metrics.deleteFailed > 0) {
      const requestId = randomUUID();
      console.warn(`[bridge-sweep][${requestId}] ${metrics.deleteFailed} 个对象删除失败`);
      await recordOperationFailure({
        key: "bridge-sweep",
        requestId,
        metrics,
        action: "请检查 Supabase 中转桶删除权限和网络状态",
      });
    } else {
      await recordOperationSuccess("bridge-sweep", metrics);
    }
  } catch (error) {
    const requestId = randomUUID();
    console.error(`[bridge-sweep][${requestId}] 失败:`, errorDiagnostic(error));
    await recordOperationFailure({
      key: "bridge-sweep",
      requestId,
      metrics: { durationMs: Date.now() - startedAt },
      action: "请检查 Supabase 中转桶、服务密钥和网络状态",
    });
  }
}
