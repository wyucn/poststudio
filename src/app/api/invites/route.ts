import { randomUUID, randomBytes } from "node:crypto";
import { desc } from "drizzle-orm";
import { db, invites } from "@/db";
import { errorResponse, HttpError, requireUser } from "@/lib/services";

export async function GET() {
  try {
    const user = await requireUser();
    if (user.role !== "admin") throw new HttpError(403, "仅管理员可查看邀请码");
    const list = db.select().from(invites).orderBy(desc(invites.createdAt)).all();
    return Response.json(list);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    if (user.role !== "admin") throw new HttpError(403, "仅管理员可生成邀请码");
    const code = randomBytes(4).toString("hex").toUpperCase();
    const invite = {
      id: randomUUID(),
      code,
      createdBy: user.id,
      usedBy: null,
      createdAt: new Date(),
      usedAt: null,
    };
    db.insert(invites).values(invite).run();
    return Response.json(invite);
  } catch (e) {
    return errorResponse(e);
  }
}
