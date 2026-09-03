import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, projectMembers, projects, tasks, users } from "@/db";
import {
  errorResponse,
  HttpError,
  isAdmin,
  requireUser,
} from "@/lib/services";
import {
  assertDeleteConfirmation,
  assertLifecycleAction,
  findDuplicateProjectName,
  PROJECT_NAME_DUPLICATE_CODE,
} from "@/lib/projects/lifecycle";
import { ldapOf, notifyWecom } from "@/lib/wecom";
import { publicAppUrl } from "@/lib/app-url";

const lifecycleSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("restore") }),
  z.object({
    action: z.literal("delete"),
    confirmationName: z.string().min(1, "请输入项目名称确认删除"),
  }),
  z.object({
    action: z.literal("transfer-owner"),
    userId: z.string().min(1, "请选择新所有者"),
    allowDuplicate: z.boolean().optional().default(false),
  }),
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const project = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project || project.deletedAt) throw new HttpError(404, "项目不存在");
    if (project.createdBy !== user.id && !isAdmin(user)) {
      throw new HttpError(403, "只有项目所有者或管理员可以管理项目生命周期");
    }

    const body = lifecycleSchema.parse(await req.json());
    assertLifecycleAction(project, body.action);
    if (body.action === "delete") {
      assertDeleteConfirmation(project.name, body.confirmationName);
    }
    const now = new Date();

    if (body.action === "archive" || body.action === "delete") {
      const activeTask = db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, id),
            inArray(tasks.status, ["queued", "running"])
          )
        )
        .get();
      if (activeTask) {
        throw new HttpError(
          409,
          "项目仍有生成任务运行，请等待任务完成或取消后再操作",
          "PROJECT_HAS_ACTIVE_TASKS"
        );
      }
    }

    if (body.action === "archive") {
      db.update(projects)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(projects.id, id))
        .run();
    } else if (body.action === "restore") {
      db.update(projects)
        .set({ archivedAt: null, updatedAt: now })
        .where(eq(projects.id, id))
        .run();
    } else if (body.action === "delete") {
      db.update(projects)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(projects.id, id))
        .run();
      return Response.json({ ok: true, deleted: true });
    } else {
      if (body.userId === project.createdBy) {
        throw new HttpError(409, "该成员已经是项目所有者", "PROJECT_OWNER_UNCHANGED");
      }
      const membership = db
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, id),
            eq(projectMembers.userId, body.userId)
          )
        )
        .get();
      if (!membership) {
        throw new HttpError(
          400,
          "请先将该用户加入项目成员，再转移所有权",
          "PROJECT_OWNER_MUST_BE_MEMBER"
        );
      }
      const target = db.select().from(users).where(eq(users.id, body.userId)).get();
      if (!target) throw new HttpError(404, "目标用户不存在");
      const duplicate = findDuplicateProjectName(
        target.id,
        project.name,
        project.id
      );
      if (duplicate && !body.allowDuplicate) {
        throw new HttpError(
          409,
          `目标所有者已有同名项目「${duplicate.name}」，确认后仍可转移所有权`,
          PROJECT_NAME_DUPLICATE_CODE
        );
      }

      db.transaction((tx) => {
        // 兼容历史数据：转移后原所有者仍保留普通成员访问，不会意外失去项目。
        tx.insert(projectMembers)
          .values({
            projectId: id,
            userId: project.createdBy,
            role: "editor",
            addedAt: now,
          })
          .onConflictDoNothing()
          .run();
        tx.update(projectMembers)
          .set({ role: "editor" })
          .where(
            and(
              eq(projectMembers.projectId, id),
              eq(projectMembers.userId, project.createdBy)
            )
          )
          .run();
        tx.update(projectMembers)
          .set({ role: "owner" })
          .where(
            and(
              eq(projectMembers.projectId, id),
              eq(projectMembers.userId, target.id)
            )
          )
          .run();
        tx.update(projects)
          .set({ createdBy: target.id, updatedAt: now })
          .where(eq(projects.id, id))
          .run();
      });
      void notifyWecom(
        `🔑 @${ldapOf(target.email)} ${user.name} 已将项目「${project.name}」的所有权转移给你\n${publicAppUrl()}/projects/${id}`,
        [ldapOf(target.email)]
      );
    }

    return Response.json({
      ok: true,
      project: db.select().from(projects).where(eq(projects.id, id)).get(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "参数错误" },
        { status: 400 }
      );
    }
    return errorResponse(error);
  }
}
