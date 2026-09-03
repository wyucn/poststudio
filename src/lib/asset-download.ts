/**
 * 素材下载文件名与 Content-Disposition 构造（鉴权下载与公开下载接口共用）。
 */
import { type Asset } from "@/db";
import { extForMime } from "@/lib/storage";
import { modelDisplayName } from "@/lib/ark/models";

/** 去掉文件名里的非法/换行字符 */
function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** 下载文件名：时间_模型_提示词片段.ext（用户上传素材保留原名） */
export function downloadName(asset: Asset): string {
  let meta: {
    modelKey?: string;
    modelName?: string;
    prompt?: string;
    filename?: string;
    presetName?: string;
  } = {};
  try {
    meta = JSON.parse(asset.metaJson);
  } catch {}
  if (meta.filename) return sanitize(meta.filename);

  const d = new Date(asset.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const model = meta.modelKey ? modelDisplayName(meta.modelKey) : (meta.modelName ?? "");
  const brief = (meta.presetName || meta.prompt || "").slice(0, 20);
  const ext = asset.kind === "text" ? "txt" : extForMime(asset.mime || "");
  const base = [stamp, model, brief].filter(Boolean).join("_");
  return `${sanitize(base) || asset.id.slice(0, 8)}.${ext}`;
}

/** 生成 Content-Disposition（RFC5987，支持中文文件名 + ASCII 兜底） */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
