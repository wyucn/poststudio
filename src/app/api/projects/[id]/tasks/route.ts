import { z } from "zod";
import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db, assets, tasks } from "@/db";
import { deleteVideoTask } from "@/lib/ark/client";
import {
  errorResponse,
  HttpError,
  isAdmin,
  requireProjectEditor,
  requireProjectViewer,
} from "@/lib/services";
import { canManageTask } from "@/lib/projects/roles";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user } = await requireProjectViewer(id);
    const sp = new URL(req.url).searchParams;

    const conds: SQL[] = [eq(tasks.projectId, id), isNull(tasks.deletedAt)];
    // mine=1：只看当前用户自己的任务（各生成面板的个人历史）
    if (sp.get("mine") === "1") conds.push(eq(tasks.userId, user.id));
    const kind = sp.get("kind");
    if (kind) {
      const kinds = kind.split(",") as (typeof tasks.$inferSelect)["kind"][];
      conds.push(kinds.length === 1 ? eq(tasks.kind, kinds[0]) : inArray(tasks.kind, kinds));
    }

    const list = db
      .select()
      .from(tasks)
      .where(and(...conds))
      .orderBy(desc(tasks.createdAt))
      .limit(100)
      .all();

    // withAssets=1：内嵌产物资产，供历史记录直接预览
    if (sp.get("withAssets") === "1") {
      const ids = list.map((t) => t.outputAssetId).filter((x): x is string => !!x);
      const assetMap = new Map(
        (ids.length
          ? db.select().from(assets).where(inArray(assets.id, ids)).all()
          : []
        ).map((a) => [a.id, a])
      );
      return Response.json(
        list.map((t) => ({
          ...t,
          outputAsset: t.outputAssetId ? (assetMap.get(t.outputAssetId) ?? null) : null,
        }))
      );
    }
    return Response.json(list);
  } catch (e) {
    return errorResponse(e);
  }
}

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "请选择要删除的记录").max(100),
});

/**
 * 从界面移除已结束的任务。使用软删除保留额度统计、审计记录与素材溯源；
 * 产物素材不会随任务记录一起删除。
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await requireProjectEditor(id);
    const body = deleteSchema.parse(await req.json());
    const ids = [...new Set(body.ids)];
    const rows = db
      .select({
        id: tasks.id,
        userId: tasks.userId,
        status: tasks.status,
        kind: tasks.kind,
        arkTaskId: tasks.arkTaskId,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, id),
          inArray(tasks.id, ids),
          isNull(tasks.deletedAt)
        )
      )
      .all();

    if (rows.length !== ids.length) {
      throw new HttpError(404, "部分任务不存在或已被删除，请刷新后重试");
    }
    if (
      !isAdmin(access.user) &&
      rows.some(
        (task) =>
          !canManageTask(access.role, task.userId, access.user.id)
      )
    ) {
      throw new HttpError(
        403,
        "编辑者只能删除自己的任务记录，项目所有者或管理员可删除全部任务",
        "PROJECT_TASK_MANAGEMENT_FORBIDDEN"
      );
    }
    if (rows.some((task) => task.status === "queued" || task.status === "running")) {
      throw new HttpError(409, "排队中或运行中的任务不能删除，请先取消或等待结束");
    }

    // 方舟只保存最近 7 天的临时记录。删除本地历史时尽力同步删除，
    // 远端记录已过期或不可删除不应阻塞本地软删除。
    void Promise.allSettled(
      rows
        .filter(
          (task) =>
            task.kind === "video" &&
            !!task.arkTaskId &&
            task.status !== "cancelled"
        )
        .map((task) => deleteVideoTask(task.arkTaskId!))
    );

    const deleted = db
      .update(tasks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(tasks.projectId, id),
          inArray(tasks.id, ids),
          isNull(tasks.deletedAt)
        )
      )
      .run();
    return Response.json({ deleted: deleted.changes });
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
