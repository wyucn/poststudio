import { z } from "zod";
import type { User } from "@/db/schema";
import { HttpError } from "@/lib/http-error";
import {
  canEditProjectRole,
  type ProjectRole,
} from "@/lib/projects/roles";

export const CAS_PASSWORD_HASH = "!cas";
export const LDAP_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function organizationEmailDomain(): string {
  const configured = process.env.ORG_EMAIL_DOMAIN?.trim().toLowerCase();
  return configured && /^[a-z0-9.-]+$/u.test(configured)
    ? configured
    : "example.com";
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

type AuthUser = Pick<User, "id" | "email" | "name" | "passwordHash" | "role">;

function toSessionUser(user: AuthUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export async function authorizeLocalCredentials(
  credentials: Partial<Record<"email" | "password", unknown>> | undefined,
  deps: {
    findUserByEmail: (email: string) => AuthUser | undefined;
    comparePassword: (password: string, passwordHash: string) => Promise<boolean>;
  }
): Promise<SessionUser | null> {
  const email = String(credentials?.email ?? "").toLowerCase().trim();
  const password = String(credentials?.password ?? "");
  if (!email || !password) return null;

  const user = deps.findUserByEmail(email);
  if (!user || user.passwordHash === CAS_PASSWORD_HASH) return null;
  if (!(await deps.comparePassword(password, user.passwordHash))) return null;
  return toSessionUser(user);
}

export function parseCasLdapResponse(payload: string): string | null {
  let ldap = payload.trim();
  if (ldap.startsWith("'") && ldap.endsWith("'") && ldap.length >= 2) {
    ldap = ldap.slice(1, -1);
  }
  return ldap && ldap !== "failed" && LDAP_RE.test(ldap) ? ldap : null;
}

interface UserRepository {
  findUserByEmail: (email: string) => User | undefined;
  insertUser: (user: User) => void;
  createId: () => string;
  now: () => Date;
}

export function getOrCreateCasUser(
  ldap: string,
  deps: UserRepository & { countUsers: () => number }
): { user: SessionUser; created: boolean } {
  if (!LDAP_RE.test(ldap)) throw new Error("Invalid LDAP identity");

  const email = `${ldap}@${organizationEmailDomain()}`;
  const existing = deps.findUserByEmail(email);
  if (existing) return { user: toSessionUser(existing), created: false };

  const user: User = {
    id: deps.createId(),
    email,
    name: ldap,
    passwordHash: CAS_PASSWORD_HASH,
    role: deps.countUsers() === 0 ? "admin" : "member",
    department: null,
    lastSeenAt: null,
    createdAt: deps.now(),
  };
  deps.insertUser(user);
  return { user: toSessionUser(user), created: true };
}

export async function resolveSessionUserByMode(options: {
  casMode: boolean;
  casCookie?: string;
  getCasUser: (sessionCookie: string | undefined) => Promise<SessionUser | null>;
  getLocalUser: () => Promise<SessionUser | null>;
}): Promise<SessionUser | null> {
  return options.casMode
    ? options.getCasUser(options.casCookie)
    : options.getLocalUser();
}

export function assertRegistrationEnabled(authMode: string | undefined): void {
  if (authMode === "cas") {
    throw new HttpError(403, "已启用公司账号登录，无需注册");
  }
}

export function resolveMemberTarget(
  input: string,
  casMode: boolean,
  deps: UserRepository
): { user: User; created: boolean } {
  const raw = input.toLowerCase().trim();

  let email: string;
  if (raw.includes("@")) {
    if (!z.string().email().safeParse(raw).success) {
      throw new HttpError(400, "邮箱格式不正确");
    }
    email = raw;
  } else if (casMode) {
    if (!LDAP_RE.test(raw)) {
      throw new HttpError(400, "LDAP 账号格式不正确");
    }
    email = `${raw}@${organizationEmailDomain()}`;
  } else {
    throw new HttpError(400, "邮箱格式不正确");
  }

  const existing = deps.findUserByEmail(email);
  if (existing) return { user: existing, created: false };

  if (!casMode || !email.endsWith(`@${organizationEmailDomain()}`)) {
    throw new HttpError(404, "该邮箱用户不存在，请先让对方注册");
  }

  const user: User = {
    id: deps.createId(),
    email,
    name: email.split("@")[0],
    passwordHash: CAS_PASSWORD_HASH,
    role: "member",
    department: null,
    lastSeenAt: null,
    createdAt: deps.now(),
  };
  deps.insertUser(user);
  return { user, created: true };
}

export function canEditProject(
  userRole: string,
  projectRole: ProjectRole | null
): boolean {
  return (
    userRole === "admin" ||
    (!!projectRole && canEditProjectRole(projectRole))
  );
}

export function projectAccess(
  userRole: string,
  projectRole: ProjectRole | null,
  visibility: "private" | "org" | "dept"
): "edit" | "view" | "none" {
  if (canEditProject(userRole, projectRole)) return "edit";
  if (projectRole || visibility !== "private") return "view";
  return "none";
}
