import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db, projects, projectMembers, users } from "@/db";
import {
  errorResponse,
  HttpError,
  isAdmin,
  requireProjectMember,
  requireProjectViewer,
  requireUser,
} from "@/lib/services";
import { isDefaultProject } from "@/lib/projects/default-project";
import { touchProjectOpened } from "@/lib/projects/preferences";
import {
  findDuplicateProjectName,
  PROJECT_NAME_DUPLICATE_CODE,
} from "@/lib/projects/lifecycle";
import { resolveProjectRole } from "@/lib/projects/roles";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, canEdit, project, role } = await requireProjectViewer(id);
    touchProjectOpened(user.id, id);
    const memberRows = db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, id))
      .all();
    const memberUsers = memberRows.length
      ? db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            lastSeenAt: users.lastSeenAt,
          })
          .from(users)
          .where(inArray(users.id, memberRows.map((m) => m.userId)))
          .all()
      : [];
    // 在线判定：120 秒内有活跃心跳
    const onlineThreshold = Date.now() - 120_000;
    const membershipByUser = new Map(
      memberRows.map((membership) => [membership.userId, membership])
    );
    const members = memberUsers
      .map((m) => {
        const memberRole = resolveProjectRole(
          project.createdBy,
          m.id,
          membershipByUser.get(m.id)?.role
        );
        return {
          id: m.id,
          name: m.name,
          email: m.email,
          online: m.lastSeenAt
            ? m.lastSeenAt.getTime() > onlineThreshold
            : false,
          role: memberRole,
          isOwner: memberRole === "owner",
        };
      })
      .sort((a, b) => {
        const rank = { owner: 0, editor: 1, viewer: 2 } as const;
        return rank[a.role] - rank[b.role] || a.name.localeCompare(b.name, "zh-CN");
      });
    return Response.json({
      ...project,
      members,
      canEdit,
      isMember:
        project.createdBy === user.id ||
        memberRows.some((membership) => membership.userId === user.id),
      currentUserRole:
        isAdmin(user) &&
        project.createdBy !== user.id &&
        !memberRows.some((membership) => membership.userId === user.id)
          ? "admin"
          : role,
      canManage: isAdmin(user) || role === "owner",
      isDefault: isDefaultProject(project),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(1, "请填写项目名").max(60).optional(),
  description: z.string().max(200).nullable().optional(),
  visibility: z.enum(["private", "org"]).optional(),
  allowDuplicate: z.boolean().optional().default(false),
}).refine(
  (body) =>
    body.name !== undefined ||
    body.description !== undefined ||
    body.visibility !== undefined,
  "没有需要更新的内容"
);

/** 更新项目信息；名称/描述由成员维护，可见性仅创建者或管理员可改。 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const project = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project || project.deletedAt) throw new HttpError(404, "项目不存在");

    const body = patchSchema.parse(await req.json());
    if (isDefaultProject(project)) {
      throw new HttpError(400, "默认创作空间由系统管理，无需修改项目信息");
    }
    await requireProjectMember(id);
    if (
      body.visibility !== undefined &&
      project.createdBy !== user.id &&
      !isAdmin(user)
    ) {
      throw new HttpError(403, "只有项目创建者或管理员可以更改可见性");
    }
    if (body.name !== undefined) {
      const duplicate = findDuplicateProjectName(
        project.createdBy,
        body.name,
        project.id
      );
      if (duplicate && !body.allowDuplicate) {
        throw new HttpError(
          409,
          `项目所有者已有同名项目「${duplicate.name}」，确认后仍可继续保存`,
          PROJECT_NAME_DUPLICATE_CODE
        );
      }
    }

    const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) {
      patch.description = body.description?.trim() || null;
    }
    if (body.visibility !== undefined) patch.visibility = body.visibility;
    db.update(projects)
      .set(patch)
      .where(eq(projects.id, id))
      .run();
    return Response.json(db.select().from(projects).where(eq(projects.id, id)).get());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json({ error: e.issues[0]?.message ?? "参数错误" }, { status: 400 });
    }
    return errorResponse(e);
  }
}
