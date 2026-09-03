import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { errorResponse, HttpError, requireUser } from "@/lib/services";
import { isCasMode } from "@/lib/auth/cas";
import { ldapOf } from "@/lib/wecom";

/**
 * 当前登录用户的身份信息（姓名 / LDAP 账号 / 邮箱 / 部门）。
 *
 * 说明：公司 cas-ldap 方案与登录校验是同一个接口，只能拿到 LDAP 账号本身，
 * 无法获取姓名/部门/职位/工号等完整档案。因此这里只返回库里已有的信息：
 * - 账号由部署方配置的组织邮箱域反推；
 * - 部门读库中现存值（预留给 dept 可见性，需接公司目录服务后才会有值）。
 */
export async function GET() {
  try {
    const sessionUser = await requireUser();
    const user = db.select().from(users).where(eq(users.id, sessionUser.id)).get();
    if (!user) throw new HttpError(404, "用户不存在");

    return Response.json({
      casMode: isCasMode(),
      ldap: isCasMode() ? ldapOf(user.email) : null,
      name: user.name,
      email: user.email,
      department: user.department,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
