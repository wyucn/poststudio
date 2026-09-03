import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, projectMembers, projects, type Project } from "@/db";
import type { SessionUser } from "@/lib/auth/session";

const DEFAULT_PROJECT_NAME = "默认创作";
const DEFAULT_PROJECT_DESCRIPTION = "随时开始生成，之后可将素材整理到正式项目。";

/**
 * 每位用户的默认创作空间使用稳定 ID，避免首次访问并发产生重复项目。
 * 它仍是一个完整 project，因此现有任务、资产和权限链路无需分叉。
 */
export function defaultProjectId(userId: string): string {
  const digest = createHash("sha256")
    .update(`haitun-default-project:${userId}`)
    .digest("hex")
    .slice(0, 24);
  return `default-${digest}`;
}

export function isDefaultProject(
  project: Pick<Project, "id" | "createdBy">
): boolean {
  return project.id === defaultProjectId(project.createdBy);
}

export function ensureDefaultProject(
  user: Pick<SessionUser, "id">
): Project {
  const id = defaultProjectId(user.id);
  const existing = db.select().from(projects).where(eq(projects.id, id)).get();
  const now = new Date();

  if (!existing) {
    db.insert(projects)
      .values({
        id,
        name: DEFAULT_PROJECT_NAME,
        description: DEFAULT_PROJECT_DESCRIPTION,
        createdBy: user.id,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  db.insert(projectMembers)
    .values({ projectId: id, userId: user.id, role: "owner", addedAt: now })
    .onConflictDoNothing()
    .run();

  return db.select().from(projects).where(eq(projects.id, id)).get()!;
}
