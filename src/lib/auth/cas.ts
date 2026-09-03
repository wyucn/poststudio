/**
 * 可选的企业 CAS 登录适配器。
 * 校验部署方配置的会话 Cookie，返回 LDAP 用户名。
 * 校验结果做内存缓存，避免每个请求都打 CAS。
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@/db";
import { errorDiagnostic } from "@/lib/error-safety";
import {
  getOrCreateCasUser,
  parseCasLdapResponse,
} from "./policy";

const CAS_AUTH_URL = process.env.CAS_AUTH_URL?.trim() ?? "";
const SESSION_COOKIE_NAME = process.env.CAS_COOKIE_NAME?.trim() || "SESS_V2";
const AUTH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const CAS_COOKIE_NAME = SESSION_COOKIE_NAME;

export function isCasMode(): boolean {
  return process.env.AUTH_MODE === "cas";
}

export function casLoginUrl(serviceUrl: string): string {
  const loginUrl = process.env.CAS_LOGIN_URL?.trim();
  if (!loginUrl) throw new Error("CAS_LOGIN_URL is required when AUTH_MODE=cas");
  const separator = loginUrl.includes("?") ? "&" : "?";
  return `${loginUrl}${separator}service=${encodeURIComponent(serviceUrl)}`;
}

const cache = new Map<string, { ldap: string | null; expires: number }>();

async function verifyCasCookie(sessionCookie: string): Promise<string | null> {
  if (!CAS_AUTH_URL) return null;
  const cached = cache.get(sessionCookie);
  if (cached && cached.expires > Date.now()) return cached.ldap;

  let ldap: string | null = null;
  try {
    const response = await fetch(CAS_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `cookie=${encodeURIComponent(sessionCookie)}`,
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (response.ok) {
      ldap = parseCasLdapResponse(await response.text());
    }
  } catch (e) {
    console.error("[cas] 校验失败:", errorDiagnostic(e));
    // 网络异常不缓存，下次重试
    return null;
  }

  // 防止缓存无限增长
  if (cache.size > 5000) cache.clear();
  cache.set(sessionCookie, { ldap, expires: Date.now() + CACHE_TTL_MS });
  return ldap;
}

/** 校验 CAS Cookie 并自动建档，返回用户信息；未登录返回 null */
export async function getCasUser(
  sessionCookie: string | undefined
): Promise<{ id: string; email: string; name: string; role: string } | null> {
  if (!sessionCookie) return null;
  const ldap = await verifyCasCookie(sessionCookie);
  if (!ldap) return null;

  const result = getOrCreateCasUser(ldap, {
    findUserByEmail: (email) =>
      db.select().from(users).where(eq(users.email, email)).get(),
    countUsers: () =>
      db.select({ c: sql<number>`count(*)` }).from(users).get()?.c ?? 0,
    insertUser: (user) => {
      db.insert(users).values(user).run();
    },
    createId: randomUUID,
    now: () => new Date(),
  });
  if (result.created) {
    console.log(`[cas] 新用户自动建档: ${ldap}`);
  }
  return result.user;
}
