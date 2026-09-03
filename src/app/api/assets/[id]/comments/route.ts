import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asc, eq, inArray } from "drizzle-orm";
import { db, assets, assetComments, users } from "@/db";
import {
  errorResponse,
  HttpError,
  requireProjectMember,
  requireProjectViewer,
} from "@/lib/services";

async function loadAsset(id: string) {
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset) throw new HttpError(404, "素材不存在");
  const user = await requireProjectMember(asset.projectId);
  return { asset, user };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!asset) throw new HttpError(404, "素材不存在");
    await requireProjectViewer(asset.projectId);
    const list = db
      .select()
      .from(assetComments)
      .where(eq(assetComments.assetId, id))
      .orderBy(asc(assetComments.createdAt))
      .all();
    const userRows = list.length
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [...new Set(list.map((c) => c.userId))]))
          .all()
      : [];
    const names = new Map(userRows.map((u) => [u.id, u.name]));
    return Response.json(
      list.map((c) => ({ ...c, userName: names.get(c.userId) ?? "未知成员" }))
    );
  } catch (e) {
    return errorResponse(e);
  }
}

const postSchema = z.object({
  content: z.string().trim().min(1, "评论不能为空").max(500),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user } = await loadAsset(id);
    const body = postSchema.parse(await req.json());
    const comment = {
      id: randomUUID(),
      assetId: id,
      userId: user.id,
      content: body.content,
      createdAt: new Date(),
    };
    db.insert(assetComments).values(comment).run();
    return Response.json({ ...comment, userName: user.name });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json({ error: e.issues[0]?.message ?? "参数错误" }, { status: 400 });
    }
    return errorResponse(e);
  }
}
