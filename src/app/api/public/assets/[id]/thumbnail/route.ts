import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { assets, db, projects } from "@/db";
import { errorResponse, HttpError } from "@/lib/services";
import { ensureAssetThumbnail } from "@/lib/thumbnails";
import {
  getPublicAssetSigningSecret,
  publicAssetCacheControl,
  verifyPublicAssetAccess,
} from "@/lib/public-asset-signing";

/**
 * 公开缩略图接口（短时签名 URL，绕过项目成员鉴权）。
 * 供外部系统（如海豚制片管理工具的管线视图）展示 AIGC 素材预览。
 * 仅暴露小尺寸 webp 缩略图；原图/视频仍走 /api/assets/[id]/raw 的鉴权代理。
 * 签名绑定素材 ID、访问用途和过期时间，原件与缩略图链接不可互换。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const secret = getPublicAssetSigningSecret();
    if (!secret) {
      throw new HttpError(503, "外部素材访问未配置", "PUBLIC_ASSET_NOT_CONFIGURED");
    }
    const { id } = await params;
    const url = new URL(req.url);
    const verification = verifyPublicAssetAccess({
      assetId: id,
      variant: "thumbnail",
      expires: url.searchParams.get("expires"),
      signature: url.searchParams.get("signature"),
      secret,
    });
    if (!verification.valid) {
      throw new HttpError(
        401,
        "素材访问链接无效或已过期",
        "PUBLIC_ASSET_LINK_INVALID"
      );
    }

    const asset = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!asset) throw new HttpError(404, "资产不存在");
    const project = db
      .select({ deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, asset.projectId))
      .get();
    if (!project || project.deletedAt) {
      throw new HttpError(404, "资产不存在");
    }
    const filePath = await ensureAssetThumbnail(asset);
    if (!filePath) throw new HttpError(404, "该素材暂时没有可用缩略图");
    const data = await fs.readFile(filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(data.length),
        "Cache-Control": publicAssetCacheControl(verification.expiresAt),
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
