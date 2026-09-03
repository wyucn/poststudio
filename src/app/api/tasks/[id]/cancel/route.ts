import { and, eq } from "drizzle-orm";
import { db, tasks } from "@/db";
import { ArkError, deleteVideoTask } from "@/lib/ark/client";
import { bridgeCleanup } from "@/lib/coze/media-bridge";
import { canCancelTask } from "@/lib/tasks/task-state";
import {
  errorResponse,
  HttpError,
  requireProjectTaskManager,
} from "@/lib/services";

/** 取消本地排队任务；视频已提交方舟时，同时取消仍在方舟队列中的任务。 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!task || task.deletedAt) throw new HttpError(404, "任务不存在");
    await requireProjectTaskManager(task.projectId, task.userId);
    if (!canCancelTask(task.status)) {
      throw new HttpError(409, "仅排队中的任务可以取消");
    }

    if (task.kind === "video" && task.arkTaskId) {
      try {
        await deleteVideoTask(task.arkTaskId);
      } catch (error) {
        if (error instanceof ArkError) {
          if (error.status === 504) {
            throw new HttpError(504, "取消请求超时，任务状态未改变，请稍后重试");
          }
          throw new HttpError(
            409,
            "视频任务已开始运行，当前无法取消，请等待任务完成"
          );
        }
        throw error;
      }
    }

    const cancelled = db
      .update(tasks)
      .set({
        status: "cancelled",
        error: null,
        errorCode: null,
        errorRequestId: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), eq(tasks.status, "queued")))
      .run();
    if (!cancelled.changes) {
      throw new HttpError(409, "任务状态已经变化，请刷新后重试");
    }
    if (task.contextJson) {
      try {
        const context = JSON.parse(task.contextJson) as { bridgeKeys?: string[] };
        if (context.bridgeKeys?.length) void bridgeCleanup(context.bridgeKeys);
      } catch {
        // 旧任务上下文损坏不应影响已经成功的取消操作。
      }
    }
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
