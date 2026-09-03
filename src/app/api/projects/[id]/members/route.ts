import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, projectMembers, users } from "@/db";
import { isCasMode } from "@/lib/auth/cas";
import { resolveMemberTarget } from "@/lib/auth/policy";
import {
  errorResponse,
  HttpError,
  requireProjectManager,
} from "@/lib/services";
import { isDefaultProject } from "@/lib/projects/default-project";
import {
  MEMBER_ROLE_VALUES,
  PROJECT_ROLE_LABELS,
} from "@/lib/projects/roles";
import { ldapOf, notifyWecom } from "@/lib/wecom";
import { publicAppUrl } from "@/lib/app-url";

const addSchema = z.object({
  email: z.string().min(1, "请输入账号"),
  role: z.enum(MEMBER_ROLE_VALUES).default("viewer"),
});

const updateSchema = z.object({
  userId: z.string().min(1, "请选择项目成员"),
  role: z.enum(MEMBER_ROLE_VALUES),
});

const removeSchema = z.object({
  userId: z.string().min(1, "请选择项目成员"),
});

function assertFormalProject(project: Parameters<typeof isDefaultProject>[0]) {
  if (isDefaultProject(project)) {
    throw new HttpError(400, "默认创作空间为个人空间；需要协作时请创建正式项目");
  }
}

function findMembership(projectId: string, userId: string) {
  return db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId)
      )
    )
    .get();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user: inviter, project } = await requireProjectManager(id);
    assertFormalProject(project);
    const body = addSchema.parse(await req.json());
    const { user: target } = resolveMemberTarget(body.email, isCasMode(), {
      findUserByEmail: (email) =>
        db.select().from(users).where(eq(users.email, email)).get(),
      insertUser: (user) => {
        db.insert(users).values(user).run();
      },
      createId: randomUUID,
      now: () => new Date(),
    });

    if (findMembership(id, target.id)) {
      throw new HttpError(409, "该用户已是项目成员");
    }

    db.insert(projectMembers)
      .values({
        projectId: id,
        userId: target.id,
        role: body.role,
        addedAt: new Date(),
      })
      .run();
    void notifyWecom(
      `👋 @${ldapOf(target.email)} 你被 ${inviter.name} 以「${PROJECT_ROLE_LABELS[body.role]}」身份加入项目「${project.name}」\n${publicAppUrl()}/projects/${id}`,
      [ldapOf(target.email)]
    );
    return Response.json({
      ok: true,
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: body.role,
      },
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user: manager, project } = await requireProjectManager(id);
    assertFormalProject(project);
    const body = updateSchema.parse(await req.json());
    if (body.userId === project.createdBy) {
      throw new HttpError(
        409,
        "项目所有者角色只能通过所有权转移变更",
        "PROJECT_OWNER_ROLE_IMMUTABLE"
      );
    }
    const membership = findMembership(id, body.userId);
    if (!membership) throw new HttpError(404, "项目成员不存在");
    db.update(projectMembers)
      .set({ role: body.role })
      .where(
        and(
          eq(projectMembers.projectId, id),
          eq(projectMembers.userId, body.userId)
        )
      )
      .run();
    const target = db.select().from(users).where(eq(users.id, body.userId)).get();
    if (target) {
      void notifyWecom(
        `🔐 @${ldapOf(target.email)} ${manager.name} 已将你在项目「${project.name}」中的角色调整为「${PROJECT_ROLE_LABELS[body.role]}」`,
        [ldapOf(target.email)]
      );
    }
    return Response.json({ ok: true, role: body.role });
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user: manager, project } = await requireProjectManager(id);
    assertFormalProject(project);
    const body = removeSchema.parse(await req.json());
    if (body.userId === project.createdBy) {
      throw new HttpError(
        409,
        "不能移除项目所有者，请先转移所有权",
        "PROJECT_OWNER_REMOVE_FORBIDDEN"
      );
    }
    const membership = findMembership(id, body.userId);
    if (!membership) throw new HttpError(404, "项目成员不存在");
    db.delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, id),
          eq(projectMembers.userId, body.userId)
        )
      )
      .run();
    const target = db.select().from(users).where(eq(users.id, body.userId)).get();
    if (target) {
      void notifyWecom(
        `👋 @${ldapOf(target.email)} ${manager.name} 已将你移出项目「${project.name}」`,
        [ldapOf(target.email)]
      );
    }
    return Response.json({ ok: true, removed: true });
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
