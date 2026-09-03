import {
  and,
  desc,
  eq,
  inArray,
  like,
  lt,
  not,
  or,
  type SQL,
} from "drizzle-orm";
import { db, assets } from "@/db";
import { errorResponse, HttpError, requireProjectViewer } from "@/lib/services";

const KINDS = ["text", "image", "video", "audio"] as const;
type AssetKind = (typeof KINDS)[number];

function decodeCursor(value: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt: number;
      id: string;
    };
    if (!Number.isFinite(parsed.createdAt) || !parsed.id) throw new Error();
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new HttpError(400, "无效的分页游标");
  }
}

function encodeCursor(asset: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: asset.createdAt.getTime(), id: asset.id })
  ).toString("base64url");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireProjectViewer(id);
    const sp = new URL(req.url).searchParams;
    const conds: SQL[] = [eq(assets.projectId, id)];
    const ids = (sp.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length) {
      if (ids.length > 50) throw new HttpError(400, "单次最多查询 50 个素材");
      const found = db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, id), inArray(assets.id, ids)))
        .all();
      return Response.json(
        ids.map((assetId) => found.find((asset) => asset.id === assetId)).filter(Boolean)
      );
    }
    const requestedKinds = (sp.get("kind") ?? "")
      .split(",")
      .filter((kind): kind is AssetKind => KINDS.includes(kind as AssetKind));
    if (requestedKinds.length === 1) conds.push(eq(assets.kind, requestedKinds[0]));
    else if (requestedKinds.length > 1) conds.push(inArray(assets.kind, requestedKinds));
    const q = sp.get("q")?.trim();
    if (q) {
      conds.push(
        or(like(assets.metaJson, `%${q}%`), like(assets.textContent, `%${q}%`))!
      );
    }
    const userId = sp.get("userId");
    if (userId) conds.push(eq(assets.userId, userId));
    if (sp.get("favorite") === "1") conds.push(eq(assets.favorite, true));
    // 排除指定 role 的素材（如尾帧 last_frame）：视频生成副产物，不该污染引用列表
    const excludeRole = sp.get("excludeRole");
    if (excludeRole) {
      conds.push(not(like(assets.metaJson, `%"role":"${excludeRole}"%`)));
    }
    const preset = sp.get("preset");
    if (preset === "character" || preset === "scene" || preset === "style") {
      conds.push(like(assets.metaJson, `%"preset":"${preset}"%`));
    }

    const limitValue = sp.get("limit");
    if (!limitValue) {
      const list = db
        .select()
        .from(assets)
        .where(and(...conds))
        .orderBy(desc(assets.createdAt), desc(assets.id))
        .all();
      return Response.json(list);
    }
    const limit = Math.min(Math.max(Number(limitValue) || 40, 1), 100);
    const cursorValue = sp.get("cursor");
    if (cursorValue) {
      const cursor = decodeCursor(cursorValue);
      conds.push(
        or(
          lt(assets.createdAt, cursor.createdAt),
          and(eq(assets.createdAt, cursor.createdAt), lt(assets.id, cursor.id))
        )!
      );
    }
    const rows = db
      .select()
      .from(assets)
      .where(and(...conds))
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(limit + 1)
      .all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return Response.json({
      items,
      nextCursor: hasMore && items.length ? encodeCursor(items.at(-1)!) : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
