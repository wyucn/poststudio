import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { assetTranscripts, assets, db, tasks } from "@/db";
import { REFERENCE_AUDIO_SOURCE_MAX_BYTES } from "@/lib/reference-media-guidance";
import {
  createTask,
  errorResponse,
  HttpError,
  requireProjectEditor,
  requireProjectViewer,
} from "@/lib/services";
import { AUDIO_TRANSCRIPTION_MODEL_KEY } from "@/lib/transcription";
import { assertManagedModelAvailable } from "@/lib/models/runtime";

const patchSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "校对文本不能为空")
    .max(2048, "参考音频原文不能超过 2048 字"),
});

function audioAsset(assetId: string) {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset || asset.kind !== "audio" || !asset.objectKey) {
    throw new HttpError(404, "音频素材不存在或已删除");
  }
  return asset;
}

function transcriptView(assetId: string) {
  const row = db
    .select()
    .from(assetTranscripts)
    .where(eq(assetTranscripts.assetId, assetId))
    .get();
  if (!row) return null;
  const task = row.taskId
    ? db.select().from(tasks).where(eq(tasks.id, row.taskId)).get()
    : null;
  const status = task?.status ?? (row.sourceText ? "succeeded" : null);
  return {
    assetId: row.assetId,
    taskId: row.taskId,
    status,
    sourceText: row.sourceText,
    text: row.correctedText ?? row.sourceText,
    error: task?.error ?? null,
    errorCode: task?.errorCode ?? null,
    updatedAt: row.updatedAt,
  };
}

function cancelUnusedTask(taskId: string) {
  const now = new Date();
  db.update(tasks)
    .set({
      status: "cancelled",
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, "queued")))
    .run();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = audioAsset(id);
    await requireProjectViewer(asset.projectId);
    return Response.json({ transcript: transcriptView(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = audioAsset(id);
    const { user } = await requireProjectEditor(asset.projectId);
    assertManagedModelAvailable(AUDIO_TRANSCRIPTION_MODEL_KEY);
    const existing = db
      .select()
      .from(assetTranscripts)
      .where(eq(assetTranscripts.assetId, id))
      .get();
    const existingTask = existing?.taskId
      ? db.select().from(tasks).where(eq(tasks.id, existing.taskId)).get()
      : null;
    if (existing?.sourceText) {
      return Response.json({ transcript: transcriptView(id), cached: true });
    }
    if (
      existingTask &&
      !existingTask.deletedAt &&
      (existingTask.status === "queued" || existingTask.status === "running")
    ) {
      return Response.json(
        { transcript: transcriptView(id), cached: false },
        { status: 202 }
      );
    }
    if ((asset.bytes ?? 0) > REFERENCE_AUDIO_SOURCE_MAX_BYTES) {
      throw new HttpError(
        413,
        "参考音频超过 100 MB，请先裁剪为较短的语音片段。",
        "REFERENCE_AUDIO_SOURCE_TOO_LARGE"
      );
    }
    if (
      !process.env.COZE_API_TOKEN ||
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_KEY
    ) {
      throw new HttpError(
        503,
        "语音转文字尚未完成服务配置，请联系管理员。",
        "TRANSCRIPTION_NOT_CONFIGURED"
      );
    }

    const task = createTask({
      projectId: asset.projectId,
      userId: user.id,
      kind: "text",
      modelKey: AUDIO_TRANSCRIPTION_MODEL_KEY,
      input: {
        prompt: "参考音频语音转文字",
        sourceAssetId: asset.id,
      },
      status: "queued",
    });
    const now = new Date();
    if (existing) {
      const replaced = db
        .update(assetTranscripts)
        .set({
          taskId: task.id,
          sourceText: null,
          correctedText: null,
          subtitleSrt: null,
          updatedBy: user.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(assetTranscripts.assetId, id),
            existing.taskId
              ? eq(assetTranscripts.taskId, existing.taskId)
              : isNull(assetTranscripts.taskId)
          )
        )
        .run();
      if (!replaced.changes) {
        cancelUnusedTask(task.id);
        return Response.json(
          { transcript: transcriptView(id), cached: false },
          { status: 202 }
        );
      }
    } else {
      const inserted = db
        .insert(assetTranscripts)
        .values({
          assetId: id,
          projectId: asset.projectId,
          taskId: task.id,
          sourceText: null,
          correctedText: null,
          subtitleSrt: null,
          updatedBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      if (!inserted.changes) {
        cancelUnusedTask(task.id);
        return Response.json(
          { transcript: transcriptView(id), cached: false },
          { status: 202 }
        );
      }
    }

    return Response.json(
      { transcript: transcriptView(id), cached: false },
      { status: 202 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = audioAsset(id);
    const { user } = await requireProjectEditor(asset.projectId);
    const body = patchSchema.parse(await req.json());
    const cached = db
      .select()
      .from(assetTranscripts)
      .where(eq(assetTranscripts.assetId, id))
      .get();
    if (!cached?.sourceText) {
      throw new HttpError(409, "请先完成语音转写，再保存校对文本");
    }
    db.update(assetTranscripts)
      .set({
        correctedText: body.text,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(assetTranscripts.assetId, id))
      .run();
    return Response.json({ transcript: transcriptView(id) });
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
