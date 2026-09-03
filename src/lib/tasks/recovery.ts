/** 启动恢复：把进程中断的任务重新入队，由 SQLite worker 继续执行。 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, tasks } from "@/db";
import { HttpError } from "@/lib/http-error";
import { recordTaskFailure } from "./task-failure";

export function recoverOrphanTasks() {
  const orphans = db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ["queued", "running"]),
        isNull(tasks.arkTaskId)
      )
    )
    .all();

  let requeued = 0;
  let quarantined = 0;
  for (const task of orphans) {
    // 视频任务若在「已向方舟提交、未写回 arkTaskId」的窗口崩溃，方舟侧可能已在生成。
    // 盲目重新入队会二次提交、重复计费，故标记 failed 让用户手动确认后重试。
    let submitPending = false;
    if (task.kind === "video" && task.contextJson) {
      try {
        submitPending = !!(JSON.parse(task.contextJson) as { submitPending?: boolean })
          .submitPending;
      } catch {
        // contextJson 解析失败按未提交处理
      }
    }
    if (submitPending) {
      recordTaskFailure(
        task,
        new HttpError(
          409,
          "任务在提交视频生成时被中断，可能已在模型侧生成；请先检查历史产物，再决定是否重试。",
          "VIDEO_SUBMIT_INTERRUPTED"
        ),
        { notify: false }
      );
      quarantined++;
    } else {
      db.update(tasks)
        .set({
          status: "queued",
          error: null,
          errorCode: null,
          errorRequestId: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id))
        .run();
      requeued++;
    }
  }

  if (requeued) console.log(`[recovery] 已重新入队 ${requeued} 个中断任务`);
  if (quarantined)
    console.log(`[recovery] 已隔离 ${quarantined} 个提交中断的视频任务（防重复计费）`);
}
