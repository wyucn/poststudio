import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { errorResponse, HttpError, requireUser } from "@/lib/services";

/** 当前用户信息（从库里取最新昵称/角色，避免会话缓存过期值） */
export async function GET() {
  try {
    const sessionUser = await requireUser();
    const user = db.select().from(users).where(eq(users.id, sessionUser.id)).get();
    if (!user) throw new HttpError(404, "用户不存在");
    return Response.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(1, "昵称不能为空").max(24, "昵称最长 24 个字符"),
});

/** 修改展示昵称；底层识别（邮箱 / LDAP）保持不变 */
export async function PATCH(req: Request) {
  try {
    const sessionUser = await requireUser();
    const { name } = patchSchema.parse(await req.json());
    db.update(users).set({ name }).where(eq(users.id, sessionUser.id)).run();
    return Response.json({ ok: true, name });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json(
        { error: e.issues[0]?.message ?? "参数错误" },
        { status: 400 }
      );
    }
    return errorResponse(e);
  }
}
