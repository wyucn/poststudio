import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, assets, tasks, type Task } from "@/db";
import { submitVideoTask } from "@/lib/ark/client";
import { isValidVideoFrames } from "@/lib/ark/capabilities";
import { resolveVideoRefs } from "@/lib/ark/video-refs";
import { HttpError } from "@/lib/http-error";
import { runtimeVideoModel } from "@/lib/models/runtime";
import {
  bridgeCleanup,
  bridgeUploadImage,
} from "@/lib/coze/media-bridge";

interface VideoInput {
  prompt: string;
  resolution?: string;
  duration?: number;
  frames?: number;
  durationMode?: "duration" | "frames";
  ratio?: string;
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  refAssetIds?: string[];
  generateAudio?: boolean;
  cameraFixed?: boolean;
  watermark?: boolean;
  returnLastFrame?: boolean;
  webSearch?: boolean;
  priority?: number;
  serviceTier?: "default" | "flex";
  executionExpiresAfter?: number;
  seed?: number;
  draft?: boolean;
  draftTaskId?: string;
  operation?: "generate" | "extend";
  extensionDirection?: "after" | "before";
}

function imageAsset(task: Task, assetId: string, label: string) {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (
    !asset ||
    asset.projectId !== task.projectId ||
    asset.kind !== "image" ||
    !asset.objectKey
  ) {
    throw new HttpError(400, `${label}资产无效或已删除`, "REFERENCE_IMAGE_INVALID");
  }
  return asset;
}

export async function submitQueuedVideoTask(task: Task): Promise<void> {
  const input = JSON.parse(task.inputJson) as VideoInput;
  const model = runtimeVideoModel(task.modelKey);
  const cap = model.capability;
  if (input.duration !== undefined && input.frames !== undefined) {
    throw new HttpError(
      400,
      "视频时长与帧数只能选择一个",
      "VIDEO_LENGTH_MODE_CONFLICT"
    );
  }
  if (input.durationMode === "frames" && input.frames === undefined) {
    throw new HttpError(400, "帧数模式需要提供帧数", "VIDEO_FRAMES_REQUIRED");
  }
  if (input.durationMode === "duration" && input.frames !== undefined) {
    throw new HttpError(
      400,
      "时长模式不能同时提供帧数",
      "VIDEO_LENGTH_MODE_CONFLICT"
    );
  }
  if (input.frames !== undefined) {
    if (!cap.frames) {
      throw new HttpError(
        400,
        `${model.label} 不支持按帧数生成`,
        "VIDEO_FRAMES_UNSUPPORTED"
      );
    }
    if (!isValidVideoFrames(input.frames, cap.frames)) {
      throw new HttpError(
        400,
        "视频帧数必须为 29–289 且按 4 帧递增",
        "VIDEO_FRAMES_INVALID"
      );
    }
  }
  const context = task.contextJson
    ? (JSON.parse(task.contextJson) as Record<string, unknown> & { bridgeKeys?: string[] })
    : {};
  if (context.bridgeKeys?.length) await bridgeCleanup(context.bridgeKeys);
  const bridgeKeys: string[] = [];
  try {
    let submitPrompt = input.prompt;
    if (input.operation === "extend") {
      submitPrompt =
        input.extensionDirection === "before"
          ? `向前延长视频1，${input.prompt.trim()}，最后自然衔接视频1。`
          : `从视频1结尾继续向后延长，${input.prompt.trim()}，保持与视频1的主体、风格、光线和运动连续。`;
    }
    let firstFrame: string | undefined;
    let lastFrame: string | undefined;
    let refImages: string[] | undefined;
    let refVideos: string[] | undefined;
    let refAudios: string[] | undefined;
    if (!input.draftTaskId && input.refAssetIds?.length) {
      const refs = await resolveVideoRefs(
        task.projectId,
        input.refAssetIds,
        cap,
        model.label,
        submitPrompt
      );
      submitPrompt = refs.prompt;
      refImages = refs.refImages;
      refVideos = refs.refVideos;
      refAudios = refs.refAudios;
      bridgeKeys.push(...refs.bridgeKeys);
    } else if (!input.draftTaskId) {
      for (const [assetId, label] of [
        [input.firstFrameAssetId, "首帧图"],
        [input.lastFrameAssetId, "尾帧图"],
      ] as const) {
        if (!assetId) continue;
        const asset = imageAsset(task, assetId, label);
        const bridged = await bridgeUploadImage(asset.objectKey!, asset.mime);
        bridgeKeys.push(bridged.key);
        if (label === "首帧图") firstFrame = bridged.url;
        else lastFrame = bridged.url;
      }
    }

    // 进入方舟提交窗口前打标记：若在「已提交、未写回 arkTaskId」之间崩溃，
    // recovery 不能盲目重试（会重复生成、重复计费），据此标记 failed 让用户手动决定。
    const pendingContext = { ...context, bridgeKeys, submitPending: true };
    db.update(tasks)
      .set({ contextJson: JSON.stringify(pendingContext), updatedAt: new Date() })
      .where(eq(tasks.id, task.id))
      .run();
    const arkTaskId = await submitVideoTask({
      endpointId: model.endpointId,
      prompt: submitPrompt,
      resolution: input.resolution,
      duration: input.frames === undefined ? input.duration : undefined,
      frames: input.frames,
      ratio: input.ratio ?? (cap.adaptiveRatio ? "adaptive" : "16:9"),
      firstFrame,
      lastFrame,
      refImages,
      refVideos,
      refAudios,
      generateAudio: cap.generateAudio ? input.generateAudio : undefined,
      cameraFixed: cap.cameraFixed ? input.cameraFixed : undefined,
      watermark: input.watermark,
      returnLastFrame: cap.returnLastFrame ? input.returnLastFrame : undefined,
      webSearch: cap.webSearch ? input.webSearch : undefined,
      priority: cap.priority ? input.priority : undefined,
      serviceTier: cap.serviceTiers.includes(input.serviceTier ?? "default")
        ? input.serviceTier
        : "default",
      executionExpiresAfter: input.executionExpiresAfter,
      safetyIdentifier: createHash("sha256").update(task.userId).digest("hex"),
      seed: cap.seed ? input.seed : undefined,
      draft: cap.draft ? input.draft : undefined,
      draftTaskId: cap.draft ? input.draftTaskId : undefined,
    });
    const doneContext = { ...context, bridgeKeys };
    db.update(tasks)
      .set({
        status: "queued",
        arkTaskId,
        contextJson: JSON.stringify(doneContext),
        error: null,
        errorCode: null,
        errorRequestId: null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id))
      .run();
  } catch (error) {
    await bridgeCleanup(bridgeKeys);
    throw error;
  }
}
