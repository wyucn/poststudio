import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, assets, tasks } from "@/db";
import { isValidVideoFrames } from "@/lib/ark/capabilities";
import { validateVideoExtension, validateVideoRefs } from "@/lib/ark/video-refs";
import { runtimeVideoModel } from "@/lib/models/runtime";
import {
  createTask,
  errorResponse,
  HttpError,
  requireProjectMember,
} from "@/lib/services";

const schema = z.object({
  prompt: z.string().min(1, "请输入提示词"),
  modelKey: z.string().default("seedance-2.0"),
  resolution: z.enum(["480p", "720p", "1080p", "4k"]).default("720p"),
  /** -1 表示智能时长 */
  duration: z.number().int().min(-1).max(15).optional(),
  /** 精确帧数；与 duration 二选一，仅 Seedance 1.0 系列支持 */
  frames: z.number().int().min(29).max(289).optional(),
  durationMode: z.enum(["duration", "frames"]).optional(),
  ratio: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]).optional(),
  firstFrameAssetId: z.string().optional(),
  lastFrameAssetId: z.string().optional(),
  /** 全能参考素材：图（≤9）/ 视频（≤3）/ 音频（≤3），与首尾帧互斥 */
  refAssetIds: z.array(z.string()).max(15).default([]),
  generateAudio: z.boolean().optional(),
  cameraFixed: z.boolean().optional(),
  watermark: z.boolean().default(false),
  returnLastFrame: z.boolean().optional(),
  webSearch: z.boolean().default(false),
  priority: z.number().int().min(0).max(9).default(0),
  serviceTier: z.enum(["default", "flex"]).default("default"),
  executionExpiresAfter: z.number().int().min(3600).max(259200).default(7200),
  seed: z.number().int().min(-1).max(4294967295).default(-1),
  draft: z.boolean().default(false),
  /** 本地 Draft 任务 ID；服务端校验归属后再换成方舟任务 ID。 */
  draftSourceTaskId: z.string().optional(),
  operation: z.enum(["generate", "extend"]).default("generate"),
  extensionDirection: z.enum(["after", "before"]).default("after"),
});

function validateImageAsset(
  projectId: string,
  assetId: string,
  label: string
): void {
  const ref = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!ref || ref.projectId !== projectId || ref.kind !== "image" || !ref.objectKey) {
    throw new HttpError(400, `${label}资产无效`);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await requireProjectMember(id);
    const body = schema.parse(await req.json());
    const model = runtimeVideoModel(body.modelKey);
    const cap = model.capability;
    const ratio = body.ratio ?? (cap.adaptiveRatio ? "adaptive" : "16:9");
    const returnLastFrame = body.returnLastFrame ?? cap.returnLastFrame;
    const hasDuration = body.duration !== undefined;
    const hasFrames = body.frames !== undefined;
    if (hasDuration && hasFrames) {
      throw new HttpError(
        400,
        "视频时长与帧数只能选择一个",
        "VIDEO_LENGTH_MODE_CONFLICT"
      );
    }
    if (body.durationMode === "frames" && !hasFrames) {
      throw new HttpError(400, "帧数模式需要提供帧数", "VIDEO_FRAMES_REQUIRED");
    }
    if (body.durationMode === "duration" && hasFrames) {
      throw new HttpError(
        400,
        "时长模式不能同时提供帧数",
        "VIDEO_LENGTH_MODE_CONFLICT"
      );
    }
    const lengthMode = body.durationMode ?? (hasFrames ? "frames" : "duration");
    const duration = lengthMode === "duration" ? body.duration ?? 5 : undefined;
    if (lengthMode === "frames") {
      if (!cap.frames) {
        throw new HttpError(
          400,
          `${model.label} 不支持按帧数生成，请切换到 Seedance 1.0 系列`,
          "VIDEO_FRAMES_UNSUPPORTED"
        );
      }
      if (!isValidVideoFrames(body.frames!, cap.frames)) {
        throw new HttpError(
          400,
          "视频帧数必须为 29–289 且按 4 帧递增",
          "VIDEO_FRAMES_INVALID"
        );
      }
    }
    let draftTaskId: string | undefined;

    if (body.draftSourceTaskId) {
      const source = db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.id, body.draftSourceTaskId),
            eq(tasks.projectId, id),
            eq(tasks.userId, user.id)
          )
        )
        .get();
      const sourceInput = source
        ? (JSON.parse(source.inputJson) as Record<string, unknown>)
        : null;
      if (
        !source ||
        source.kind !== "video" ||
        source.status !== "succeeded" ||
        source.modelKey !== model.key ||
        sourceInput?.draft !== true ||
        !source.arkTaskId
      ) {
        throw new HttpError(400, "Draft 样片任务无效、未完成或不属于当前用户");
      }
      draftTaskId = source.arkTaskId;
    }

    // ---- 按模型能力校验 ----
    if (!cap.resolutions.includes(body.resolution)) {
      throw new HttpError(400, `${model.label} 不支持 ${body.resolution} 分辨率`);
    }
    if (lengthMode === "duration" && duration === -1) {
      if (!cap.smartDuration) throw new HttpError(400, `${model.label} 不支持智能时长`);
    } else if (
      lengthMode === "duration" &&
      (duration! < cap.duration.min || duration! > cap.duration.max)
    ) {
      throw new HttpError(
        400,
        `${model.label} 时长范围为 ${cap.duration.min}-${cap.duration.max} 秒`
      );
    }
    if (body.draft && lengthMode === "frames") {
      throw new HttpError(400, "Draft 样片不支持帧数模式", "VIDEO_FRAMES_DRAFT_UNSUPPORTED");
    }
    if (ratio === "adaptive" && !cap.adaptiveRatio) {
      throw new HttpError(400, `${model.label} 不支持自适应画幅`);
    }
    if (body.webSearch && !cap.webSearch) {
      throw new HttpError(400, `${model.label} 不支持联网搜索`);
    }
    if (body.priority !== 0 && !cap.priority) {
      throw new HttpError(400, `${model.label} 不支持任务优先级`);
    }
    if (!cap.serviceTiers.includes(body.serviceTier)) {
      throw new HttpError(400, `${model.label} 不支持 ${body.serviceTier} 服务等级`);
    }
    if (body.seed !== -1 && !cap.seed) {
      throw new HttpError(400, `${model.label} 不支持固定随机种子`);
    }
    if ((body.draft || draftTaskId) && !cap.draft) {
      throw new HttpError(400, `${model.label} 不支持 Draft 样片`);
    }
    if (body.draft && body.resolution !== "480p") {
      throw new HttpError(400, "Draft 样片必须使用 480p 分辨率");
    }
    if (body.draft && body.serviceTier === "flex") {
      throw new HttpError(400, "Draft 样片不支持 Flex 服务等级");
    }
    if (returnLastFrame && !cap.returnLastFrame) {
      throw new HttpError(400, `${model.label} 不支持返回尾帧`);
    }
    if (body.draft && returnLastFrame) {
      throw new HttpError(400, "Draft 样片不支持返回尾帧");
    }
    if (body.operation === "extend") {
      if (!cap.modes.includes("extend")) {
        throw new HttpError(400, `${model.label} 不支持原生视频延长`);
      }
      if (body.refAssetIds.length !== 1) {
        throw new HttpError(400, "原生视频延长需要且只能选择 1 段视频素材");
      }
      if (body.firstFrameAssetId || body.lastFrameAssetId) {
        throw new HttpError(400, "原生视频延长不能同时使用首尾帧");
      }
    } else if (body.refAssetIds.length) {
      if (!cap.modes.includes("reference")) {
        throw new HttpError(400, `${model.label} 不支持全能参考`);
      }
      if (body.firstFrameAssetId || body.lastFrameAssetId) {
        throw new HttpError(400, "全能参考与首尾帧不可同时使用");
      }
    }
    if (body.lastFrameAssetId) {
      if (!cap.modes.includes("first_last")) {
        throw new HttpError(400, `${model.label} 不支持首尾帧生视频`);
      }
      if (!body.firstFrameAssetId) {
        throw new HttpError(400, "使用尾帧时必须同时提供首帧");
      }
    }
    if (body.cameraFixed && !cap.cameraFixed) {
      throw new HttpError(400, `${model.label} 不支持固定摄像头`);
    }
    if (
      body.cameraFixed &&
      (body.firstFrameAssetId || body.lastFrameAssetId || body.refAssetIds.length)
    ) {
      throw new HttpError(400, "固定摄像头仅支持文生视频，不支持参考图或全能参考场景");
    }

    // 入队前只校验素材；把素材类型快照写入 inputJson，便于后续解释最低 token 规则。
    let referenceMediaKinds: Array<"image" | "video" | "audio"> = [];
    if (body.operation === "extend") {
      referenceMediaKinds = validateVideoExtension(id, body.refAssetIds, cap, model.label);
    } else if (body.refAssetIds.length) {
      referenceMediaKinds = validateVideoRefs(id, body.refAssetIds, cap, model.label);
    } else {
      if (body.firstFrameAssetId) {
        validateImageAsset(id, body.firstFrameAssetId, "首帧图");
      }
      if (body.lastFrameAssetId) {
        validateImageAsset(id, body.lastFrameAssetId, "尾帧图");
      }
    }

    const task = createTask({
      projectId: id,
      userId: user.id,
      kind: "video",
      modelKey: model.key,
      input: {
        ...body,
        duration: lengthMode === "duration" ? duration : undefined,
        frames: lengthMode === "frames" ? body.frames : undefined,
        durationMode: lengthMode,
        ratio,
        returnLastFrame,
        draftTaskId,
        referenceMediaKinds,
      },
      status: "queued",
    });

    return Response.json({ task });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json({ error: e.issues[0]?.message ?? "参数错误" }, { status: 400 });
    }
    return errorResponse(e);
  }
}
