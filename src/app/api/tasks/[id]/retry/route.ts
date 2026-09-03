import { and, eq } from "drizzle-orm";
import { db, tasks } from "@/db";
import { bridgeCleanup } from "@/lib/coze/media-bridge";
import {
  manualRetryBlockReason,
  manualRetryNeedsConfirmation,
  parseTaskContextJson,
  serializeTaskContextJson,
  supportsTaskManualRetry,
} from "@/lib/tasks/retry";
import { canRetryTask } from "@/lib/tasks/task-state";
import {
  assertTaskCapacity,
  errorResponse,
  HttpError,
  requireProjectTaskManager,
} from "@/lib/services";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!task || task.deletedAt) throw new HttpError(404, "任务不存在");
    const { user } = await requireProjectTaskManager(task.projectId, task.userId);
    const blockedReason = manualRetryBlockReason(task);
    if (blockedReason) {
      throw new HttpError(400, blockedReason, "TASK_INPUT_CHANGE_REQUIRED");
    }
    if (!supportsTaskManualRetry(task)) {
      throw new HttpError(400, "当前任务类型不支持原地重试");
    }
    if (!canRetryTask(task.status)) {
      throw new HttpError(400, "仅失败的任务可重试");
    }
    const body = (await req.json().catch(() => ({}))) as {
      confirmDuplicateSpend?: unknown;
    };
    if (
      manualRetryNeedsConfirmation(task.errorCode, task.arkTaskId) &&
      body.confirmDuplicateSpend !== true
    ) {
      throw new HttpError(
        409,
        "上一次请求可能已被模型服务受理；请确认可能产生重复费用后再重试。",
        "TASK_RETRY_CONFIRMATION_REQUIRED"
      );
    }
    assertTaskCapacity(user.id, task.projectId);

    const context = parseTaskContextJson(task.contextJson);
    const bridgeKeys = Array.isArray(context.bridgeKeys)
      ? context.bridgeKeys.map(String)
      : [];
    if (task.kind === "video" && bridgeKeys.length) {
      await bridgeCleanup(bridgeKeys);
    }
    delete context.automaticRetry;
    delete context.submitPending;
    if (task.kind === "video") context.bridgeKeys = [];
    const retried = db
      .update(tasks)
      .set({
        status: "queued",
        arkTaskId: null,
        outputAssetId: null,
        usageJson: null,
        error: null,
        errorCode: null,
        errorRequestId: null,
        completedAt: null,
        contextJson: serializeTaskContextJson(context),
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, "failed")))
      .run();
    if (!retried.changes) {
      throw new HttpError(409, "任务状态已经变化，请刷新后重试");
    }
    return Response.json({ ok: true, taskId: task.id });
  } catch (error) {
    return errorResponse(error);
  }
}
