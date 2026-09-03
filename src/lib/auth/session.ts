/**
 * 统一会话入口：根据 AUTH_MODE 走 CAS（公司账号）或 Auth.js（本地邮箱密码）。
 */
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { CAS_COOKIE_NAME, getCasUser, isCasMode } from "./cas";
import {
  resolveSessionUserByMode,
  type SessionUser,
} from "./policy";

export type { SessionUser } from "./policy";

export async function getSessionUser(): Promise<SessionUser | null> {
  if (isCasMode()) {
    const jar = await cookies();
    return resolveSessionUserByMode({
      casMode: true,
      casCookie: jar.get(CAS_COOKIE_NAME)?.value,
      getCasUser,
      getLocalUser: async () => null,
    });
  }
  return resolveSessionUserByMode({
    casMode: false,
    getCasUser,
    getLocalUser: async () => {
      const session = await auth();
      return session?.user?.id ? session.user : null;
    },
  });
}
