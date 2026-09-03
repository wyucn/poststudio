import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { assets, db } from "@/db";
import { errorResponse, HttpError, requireProjectViewer } from "@/lib/services";
import { ensureAssetThumbnail } from "@/lib/thumbnails";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!asset) throw new HttpError(404, "资产不存在");
    await requireProjectViewer(asset.projectId);
    const filePath = await ensureAssetThumbnail(asset);
    if (!filePath) throw new HttpError(404, "该素材暂时没有可用缩略图");
    const data = await fs.readFile(filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
