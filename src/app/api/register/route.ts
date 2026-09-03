import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, isNull, and, sql } from "drizzle-orm";
import { db, users, invites } from "@/db";
import { assertRegistrationEnabled } from "@/lib/auth/policy";
import { errorResponse, HttpError } from "@/lib/services";

const schema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位"),
  name: z.string().min(1, "请填写昵称").max(30),
  inviteCode: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    assertRegistrationEnabled(process.env.AUTH_MODE);
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (existing) throw new HttpError(409, "该邮箱已注册");

    const userCount = db.select({ c: sql<number>`count(*)` }).from(users).get()?.c ?? 0;
    const isFirstUser = userCount === 0;

    let inviteId: string | null = null;
    if (!isFirstUser) {
      if (!body.inviteCode) throw new HttpError(400, "需要邀请码");
      const invite = db
        .select()
        .from(invites)
        .where(and(eq(invites.code, body.inviteCode.trim()), isNull(invites.usedBy)))
        .get();
      if (!invite) throw new HttpError(400, "邀请码无效或已被使用");
      inviteId = invite.id;
    }

    const userId = randomUUID();
    db.insert(users)
      .values({
        id: userId,
        email,
        name: body.name.trim(),
        passwordHash: await bcrypt.hash(body.password, 10),
        role: isFirstUser ? "admin" : "member",
        createdAt: new Date(),
      })
      .run();

    if (inviteId) {
      db.update(invites)
        .set({ usedBy: userId, usedAt: new Date() })
        .where(eq(invites.id, inviteId))
        .run();
    }

    return Response.json({ ok: true, isFirstUser });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json({ error: e.issues[0]?.message ?? "参数错误" }, { status: 400 });
    }
    return errorResponse(e);
  }
}
