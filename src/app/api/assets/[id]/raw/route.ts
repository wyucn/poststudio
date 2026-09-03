import { eq } from "drizzle-orm";
import { db, assets } from "@/db";
import {
  createObjectReadStream,
  getObjectSize,
  nodeReadStreamToWeb,
} from "@/lib/storage";
import { errorResponse, HttpError, requireProjectViewer } from "@/lib/services";
import { contentDisposition, downloadName } from "@/lib/asset-download";
import { recordProductEvent } from "@/lib/product-events";

type ByteRange = { start: number; end: number };

function parseRange(value: string | null, total: number): ByteRange | null | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || total <= 0) return null;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 0 || start >= total || end < start) return null;
    end = Math.min(end, total - 1);
  }
  return { start, end };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!asset) throw new HttpError(404, "资产不存在");
    const { user } = await requireProjectViewer(asset.projectId);

    // ?download=1 时附带规范文件名，触发浏览器「另存为」而非内联打开
    const wantDownload = new URL(req.url).searchParams.get("download") === "1";
    const disposition: Record<string, string> = wantDownload
      ? { "Content-Disposition": contentDisposition(downloadName(asset)) }
      : {};

    if (asset.kind === "text") {
      if (wantDownload) {
        recordProductEvent({
          action: "download",
          projectId: asset.projectId,
          userId: user.id,
          taskId: asset.sourceTaskId,
          assetId: asset.id,
        });
      }
      return new Response(asset.textContent ?? "", {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...disposition },
      });
    }
    if (!asset.objectKey) throw new HttpError(404, "媒体文件缺失");
    const total = await getObjectSize(asset.objectKey);
    const range = parseRange(req.headers.get("range"), total);
    const commonHeaders = {
      "Content-Type": asset.mime || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      ...disposition,
    };

    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: { ...commonHeaders, "Content-Range": `bytes */${total}` },
      });
    }

    if (wantDownload) {
      recordProductEvent({
        action: "download",
        projectId: asset.projectId,
        userId: user.id,
        taskId: asset.sourceTaskId,
        assetId: asset.id,
      });
    }

    const stream = nodeReadStreamToWeb(createObjectReadStream(asset.objectKey, range));
    if (range) {
      return new Response(stream, {
        status: 206,
        headers: {
          ...commonHeaders,
          "Content-Length": String(range.end - range.start + 1),
          "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
        },
      });
    }

    return new Response(stream, {
      headers: {
        ...commonHeaders,
        "Content-Length": String(total),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
