import { randomUUID } from "node:crypto";
import { z } from "zod";
import { desc, eq, ne } from "drizzle-orm";
import { db, projects, projectMembers } from "@/db";
import { errorResponse, HttpError, isAdmin, requireUser } from "@/lib/services";
import { isDefaultProject } from "@/lib/projects/default-project";
import {
  findDuplicateProjectName,
  PROJECT_NAME_DUPLICATE_CODE,
} from "@/lib/projects/lifecycle";
import {
  projectPreferenceMap,
  touchProjectOpened,
} from "@/lib/projects/preferences";
import {
  canEditProjectRole,
  resolveProjectRole,
  type ProjectRole,
} from "@/lib/projects/roles";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const view = new URL(req.url).searchParams.get("view") === "archived"
      ? "archived"
      : "active";
    const memberships = db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.userId, user.id))
      .all();
    const membershipMap = new Map(memberships.map((membership) => [membership.projectId, membership]));
    const myIds = new Set(memberships.map((m) => m.projectId));
    const preferences = projectPreferenceMap(user.id);
    const matchesView = (project: typeof projects.$inferSelect) =>
      !project.deletedAt &&
      (view === "archived" ? !!project.archivedAt : !project.archivedAt);
    const decorate = (p: typeof projects.$inferSelect) => {
      const mine = myIds.has(p.id);
      const createdByMe = p.createdBy === user.id;
      const effectiveRole = resolveProjectRole(
        p.createdBy,
        user.id,
        membershipMap.get(p.id)?.role
      );
      const currentUserRole: ProjectRole | "admin" =
        isAdmin(user) && !mine && !createdByMe ? "admin" : effectiveRole;
      const preference = preferences.get(p.id);
      return {
        ...p,
        mine,
        createdByMe,
        participating: mine && !createdByMe,
        favorite: preference?.favorite ?? false,
        lastOpenedAt: preference?.lastOpenedAt ?? null,
        currentUserRole,
        canEdit:
          !p.archivedAt &&
          (isAdmin(user) || canEditProjectRole(effectiveRole)),
        isDefault: isDefaultProject(p),
        // 仅创建者或管理员可切换可见性
        canManage: isAdmin(user) || effectiveRole === "owner",
      };
    };
    // 管理员可看到平台上的所有项目
    if (isAdmin(user)) {
      const list = db
        .select()
        .from(projects)
        .orderBy(desc(projects.updatedAt))
        .all()
        .filter(
          (project) =>
            matchesView(project) &&
            (!isDefaultProject(project) || project.createdBy === user.id)
        );
      return Response.json(list.map(decorate));
    }
    // 归档项目只对现有成员保留只读入口，不继续出现在全公司公共发现中。
    if (view === "archived") {
      const archivedMine = myIds.size
        ? db
            .select()
            .from(projects)
            .all()
            .filter((project) => matchesView(project) && myIds.has(project.id))
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        : [];
      return Response.json(archivedMine.map(decorate));
    }
    // 普通用户：自己参与的项目 + 全公司公开的项目（非成员只读）
    const list = db
      .select()
      .from(projects)
      .where(ne(projects.visibility, "private"))
      .orderBy(desc(projects.updatedAt))
      .all()
      .filter(matchesView);
    const seen = new Set(list.map((p) => p.id));
    const mineOnly = myIds.size
      ? db
          .select()
          .from(projects)
          .all()
          .filter((p) => matchesView(p) && myIds.has(p.id) && !seen.has(p.id))
      : [];
    const merged = [...list, ...mineOnly].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
    return Response.json(merged.map(decorate));
  } catch (e) {
    return errorResponse(e);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写项目名").max(60),
  description: z.string().max(200).optional(),
  visibility: z.enum(["private", "org"]).default("private"),
  allowDuplicate: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await req.json());
    const name = body.name.trim();
    const duplicate = findDuplicateProjectName(user.id, name);
    if (duplicate && !body.allowDuplicate) {
      throw new HttpError(
        409,
        `你已有同名项目「${duplicate.name}」，确认后仍可继续创建`,
        PROJECT_NAME_DUPLICATE_CODE
      );
    }
    const now = new Date();
    const project = {
      id: randomUUID(),
      name,
      description: body.description?.trim() ?? null,
      createdBy: user.id,
      visibility: body.visibility,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(projects).values(project).run();
    db.insert(projectMembers)
      .values({ projectId: project.id, userId: user.id, role: "owner", addedAt: now })
      .run();
    touchProjectOpened(user.id, project.id, now);
    return Response.json({
      ...project,
      mine: true,
      createdByMe: true,
      participating: false,
      favorite: false,
      lastOpenedAt: now,
      archivedAt: null,
      currentUserRole: "owner",
      canEdit: true,
      isDefault: false,
      canManage: true,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json({ error: e.issues[0]?.message ?? "参数错误" }, { status: 400 });
    }
    return errorResponse(e);
  }
}
