import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, tasks } from "@/db";
import { recordProductEvent } from "@/lib/product-events";
import { errorResponse, HttpError, requireProjectEditor } from "@/lib/services";

const bodySchema = z.object({
  action: z.enum(["reuse", "regenerate"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "无效的结果使用行为");
    const task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .get();
    if (!task) throw new HttpError(404, "任务不存在");
    const { user } = await requireProjectEditor(task.projectId);
    recordProductEvent({
      action: parsed.data.action,
      projectId: task.projectId,
      userId: user.id,
      taskId: task.id,
      assetId: task.outputAssetId,
      modelKey: task.modelKey,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
