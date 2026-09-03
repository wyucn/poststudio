import { and, eq, isNull } from "drizzle-orm";
import { db, tasks } from "@/db";
import { errorResponse, HttpError, requireProjectViewer } from "@/lib/services";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .get();
    if (!task) throw new HttpError(404, "任务不存在");
    await requireProjectViewer(task.projectId);
    return Response.json(task);
  } catch (e) {
    return errorResponse(e);
  }
}
