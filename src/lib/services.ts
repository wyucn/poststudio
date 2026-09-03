import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  assets,
  projectMembers,
  projects,
  tasks,
  users,
  type Asset,
  type Project,
  type Task,
} from "@/db";
import { putObject, putObjectStream } from "@/lib/storage";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import {
  canEditProjectRole,
  canManageProjectMembers,
  canManageTask,
  resolveProjectRole,
  type ProjectRole,
} from "@/lib/projects/roles";
import { HttpError, publicError } from "@/lib/http-error";
import { errorDiagnostic } from "@/lib/error-safety";

export { HttpError } from "@/lib/http-error";

export function isAdmin(user: Pick<SessionUser, "role">): boolean {
  return user.role === "admin";
}

/** 在线心跳：记录用户最近活跃时间，内存节流避免每个请求都写库 */
const presenceWritten = new Map<string, number>();
const PRESENCE_WRITE_INTERVAL_MS = 30_000;

function touchPresence(userId: string) {
  const now = Date.now();
  if (now - (presenceWritten.get(userId) ?? 0) < PRESENCE_WRITE_INTERVAL_MS) return;
  presenceWritten.set(userId, now);
  try {
    db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId)).run();
  } catch (e) {
    console.error("[presence] 更新失败:", errorDiagnostic(e));
  }
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "请先登录");
  touchPresence(user.id);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) {
    throw new HttpError(403, "仅平台管理员可以执行此操作", "ADMIN_REQUIRED");
  }
  return user;
}

function membershipFor(projectId: string, userId: string) {
  return db
    .select()
    .from(projectMembers)
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))
    )
    .get();
}

function accessForProject(
  project: Project,
  userId: string
): { role: ProjectRole; isMember: boolean } {
  const membership = membershipFor(project.id, userId);
  return {
    role: resolveProjectRole(project.createdBy, userId, membership?.role),
    isMember: project.createdBy === userId || !!membership,
  };
}

function loadProject(projectId: string): Project {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project || project.deletedAt) throw new HttpError(404, "项目不存在");
  return project;
}

export async function requireProjectViewer(
  projectId: string
): Promise<{
  user: SessionUser;
  canEdit: boolean;
  project: Project;
  role: ProjectRole;
}> {
  const user = await requireUser();
  const project = loadProject(projectId);
  const { role, isMember } = accessForProject(project, user.id);
  const isEditor = isAdmin(user) || canEditProjectRole(role);
  if (isEditor) {
    return { user, canEdit: !project.archivedAt, project, role };
  }
  if (isMember || project.visibility !== "private") {
    return { user, canEdit: false, project, role };
  }
  throw new HttpError(403, "你不是该项目成员");
}

export async function requireProjectEditor(projectId: string) {
  const access = await requireProjectViewer(projectId);
  if (access.project.archivedAt) {
    throw new HttpError(
      409,
      "项目已归档，请先恢复后再进行编辑或生成",
      "PROJECT_ARCHIVED"
    );
  }
  if (!isAdmin(access.user) && !canEditProjectRole(access.role)) {
    throw new HttpError(403, "当前项目角色为查看者，不能编辑或生成", "PROJECT_VIEW_ONLY");
  }
  return access;
}

export async function requireProjectMember(projectId: string) {
  return (await requireProjectEditor(projectId)).user;
}

export async function requireProjectManager(projectId: string) {
  const user = await requireUser();
  const project = loadProject(projectId);
  if (project.archivedAt) {
    throw new HttpError(
      409,
      "项目已归档，请先恢复后再管理成员",
      "PROJECT_ARCHIVED"
    );
  }
  const { role } = accessForProject(project, user.id);
  if (!isAdmin(user) && !canManageProjectMembers(role)) {
    throw new HttpError(
      403,
      "只有项目所有者或管理员可以管理成员",
      "PROJECT_MEMBER_MANAGEMENT_FORBIDDEN"
    );
  }
  return { user, project, role };
}

export async function requireProjectTaskManager(
  projectId: string,
  taskUserId: string
) {
  const access = await requireProjectEditor(projectId);
  if (
    !isAdmin(access.user) &&
    !canManageTask(access.role, taskUserId, access.user.id)
  ) {
    throw new HttpError(
      403,
      "编辑者只能管理自己创建的任务，项目所有者或管理员可管理全部任务",
      "PROJECT_TASK_MANAGEMENT_FORBIDDEN"
    );
  }
  return access;
}

export function errorResponse(e: unknown): Response {
  const result = publicError(e);
  if (result.shouldLog) {
    console.error(
      `[haitun-post-studio][${result.requestId}]`,
      errorDiagnostic(e)
    );
  }
  return Response.json(result.body, {
    status: result.status,
    headers: result.requestId ? { "X-Request-ID": result.requestId } : undefined,
  });
}

export interface AssetMeta {
  modelKey?: string;
  modelName?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  sourceAssetIds?: string[];
  [k: string]: unknown;
}

/** 从远端 URL 转存媒体并登记资产 */
export async function saveMediaAsset(opts: {
  projectId: string;
  userId: string;
  kind: "image" | "video" | "audio";
  remoteUrl: string;
  meta: AssetMeta;
  sourceTaskId?: string;
}): Promise<Asset> {
  const id = randomUUID();
  const response = await fetch(opts.remoteUrl);
  if (!response.ok || !response.body) {
    throw new Error(`媒体下载失败 (${response.status})`);
  }
  const mime = response.headers.get("content-type") || "application/octet-stream";
  const maxBytes =
    opts.kind === "image"
      ? 100 * 1024 * 1024
      : opts.kind === "audio"
        ? 200 * 1024 * 1024
        : 1024 * 1024 * 1024;
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new Error(`远端${opts.kind}文件超过转存上限`);
  }
  const { objectKey, bytes } = await putObjectStream(
    id,
    response.body,
    mime,
    maxBytes
  );
  const now = new Date();
  const asset: Asset = {
    id,
    projectId: opts.projectId,
    userId: opts.userId,
    kind: opts.kind,
    objectKey,
    mime,
    bytes,
    textContent: null,
    metaJson: JSON.stringify(opts.meta),
    sourceTaskId: opts.sourceTaskId ?? null,
    reviewStatus: null,
    favorite: false,
    createdAt: now,
  };
  db.insert(assets).values(asset).run();
  return asset;
}

/** 保存已在服务端内存中的媒体结果并登记资产（适合需要鉴权下载的外部服务）。 */
export async function saveMediaBufferAsset(opts: {
  projectId: string;
  userId: string;
  kind: "image" | "video" | "audio";
  buffer: Buffer;
  mime: string;
  meta: AssetMeta;
  sourceTaskId?: string;
}): Promise<Asset> {
  const maxBytes =
    opts.kind === "image"
      ? 100 * 1024 * 1024
      : opts.kind === "audio"
        ? 200 * 1024 * 1024
        : 1024 * 1024 * 1024;
  if (!opts.buffer.length) throw new Error("媒体文件为空");
  if (opts.buffer.length > maxBytes) {
    throw new Error(`远端${opts.kind}文件超过转存上限`);
  }
  const id = randomUUID();
  const { objectKey, bytes } = await putObject(id, opts.buffer, opts.mime);
  const asset: Asset = {
    id,
    projectId: opts.projectId,
    userId: opts.userId,
    kind: opts.kind,
    objectKey,
    mime: opts.mime,
    bytes,
    textContent: null,
    metaJson: JSON.stringify(opts.meta),
    sourceTaskId: opts.sourceTaskId ?? null,
    reviewStatus: null,
    favorite: false,
    createdAt: new Date(),
  };
  db.insert(assets).values(asset).run();
  return asset;
}

function positiveLimit(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** 在产生外部费用前统一检查用户并发和滚动 24 小时额度。0 表示关闭对应限制。 */
export function assertTaskCapacity(userId: string, projectId: string): void {
  const activeLimit = positiveLimit("GENERATION_MAX_ACTIVE_PER_USER", 3);
  const userDailyLimit = positiveLimit("GENERATION_MAX_DAILY_PER_USER", 100);
  const projectDailyLimit = positiveLimit("GENERATION_MAX_DAILY_PER_PROJECT", 500);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (activeLimit) {
    const active = db
      .select({ value: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          inArray(tasks.status, ["queued", "running"])
        )
      )
      .get()?.value ?? 0;
    if (active >= activeLimit) {
      throw new HttpError(429, `你已有 ${active} 个任务在执行，请等待完成后再提交`);
    }
  }

  if (userDailyLimit) {
    const daily = db
      .select({ value: count() })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), gte(tasks.createdAt, since)))
      .get()?.value ?? 0;
    if (daily >= userDailyLimit) {
      throw new HttpError(429, `你在最近 24 小时已提交 ${daily} 个任务，已达到额度`);
    }
  }

  if (projectDailyLimit) {
    const daily = db
      .select({ value: count() })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), gte(tasks.createdAt, since)))
      .get()?.value ?? 0;
    if (daily >= projectDailyLimit) {
      throw new HttpError(429, `项目最近 24 小时已提交 ${daily} 个任务，已达到额度`);
    }
  }
}

export function createTask(opts: {
  projectId: string;
  userId: string;
  kind: Task["kind"];
  modelKey: string;
  input: Record<string, unknown>;
  status?: Task["status"];
  arkTaskId?: string;
  context?: Record<string, unknown>;
}): Task {
  assertTaskCapacity(opts.userId, opts.projectId);
  const now = new Date();
  const task: Task = {
    id: randomUUID(),
    projectId: opts.projectId,
    userId: opts.userId,
    kind: opts.kind,
    status: opts.status ?? "queued",
    modelKey: opts.modelKey,
    inputJson: JSON.stringify(opts.input),
    arkTaskId: opts.arkTaskId ?? null,
    outputAssetId: null,
    contextJson: opts.context ? JSON.stringify(opts.context) : null,
    error: null,
    errorCode: null,
    errorRequestId: null,
    deletedAt: null,
    usageJson: null,
    attemptCount: 0,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(tasks).values(task).run();
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<
    Pick<
      Task,
      | "status"
      | "arkTaskId"
      | "outputAssetId"
      | "error"
      | "errorCode"
      | "errorRequestId"
      | "usageJson"
      | "startedAt"
      | "completedAt"
    >
  >
) {
  const now = new Date();
  const terminal =
    patch.status === "succeeded" ||
    patch.status === "failed" ||
    patch.status === "cancelled";
  db.update(tasks)
    .set({
      ...patch,
      ...(terminal && patch.completedAt === undefined ? { completedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(tasks.id, id))
    .run();
}
