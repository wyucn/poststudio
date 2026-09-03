/**
 * 剪辑工具入口。请求只校验并持久化任务；SQLite worker 负责素材中转、
 * Coze 调用和产物转存，因此网关超时或进程重启不会丢失任务。
 */
import { z } from "zod";
import { validateEditTask } from "@/lib/edit/task";
import {
  createTask,
  errorResponse,
  HttpError,
  requireProjectMember,
} from "@/lib/services";
import { assertManagedModelAvailable } from "@/lib/models/runtime";

const schema = z.object({
  tool: z.string(),
  params: z.record(z.string(), z.unknown()),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await requireProjectMember(id);
    assertManagedModelAvailable("coze-edit");
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const tool = validateEditTask(id, parsed.data.tool, parsed.data.params);
    const task = createTask({
      projectId: id,
      userId: user.id,
      kind: "edit",
      modelKey: "coze-edit",
      input: { prompt: tool.label, tool: tool.key, params: parsed.data.params },
      status: "queued",
    });
    return Response.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}
