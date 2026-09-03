import { eq } from "drizzle-orm";
import { assets, db, projects } from "@/db";
import {
  createObjectReadStream,
  getObjectSize,
  nodeReadStreamToWeb,
} from "@/lib/storage";
import { errorResponse, HttpError } from "@/lib/services";
import { contentDisposition, downloadName } from "@/lib/asset-download";
import {
  getPublicAssetSigningSecret,
  publicAssetCacheControl,
  verifyPublicAssetAccess,
} from "@/lib/public-asset-signing";

/**
 * 公开原件下载接口（短时签名 URL，绕过项目成员鉴权）。
 * 供外部系统（如海豚制片管理工具的一键下载）拉取原始文件。
 * 始终带 Content-Disposition: attachment，触发浏览器直接下载而非内联预览。
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
      variant: "raw",
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
    const cacheControl = publicAssetCacheControl(verification.expiresAt);

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

    const disposition = contentDisposition(downloadName(asset));

    if (asset.kind === "text") {
      return new Response(asset.textContent ?? "", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": disposition,
          "Cache-Control": cacheControl,
        },
      });
    }
    if (!asset.objectKey) throw new HttpError(404, "媒体文件缺失");

    const total = await getObjectSize(asset.objectKey);
    const stream = nodeReadStreamToWeb(createObjectReadStream(asset.objectKey));
    return new Response(stream, {
      headers: {
        "Content-Type": asset.mime || "application/octet-stream",
        "Content-Length": String(total),
        "Content-Disposition": disposition,
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
