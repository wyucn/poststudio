/**
 * 视频任务轮询器：定期向方舟查询进行中的视频任务，
 * 完成后把视频转存到本地存储并登记资产、回写流水线分镜。
 */
import { and, inArray, isNotNull, eq } from "drizzle-orm";
import { db, tasks } from "@/db";
import { getVideoTask } from "@/lib/ark/client";
import { getModel } from "@/lib/ark/models";
import { saveMediaAsset, updateTask } from "@/lib/services";
import { bridgeCleanup } from "@/lib/coze/media-bridge";
import { errorDiagnostic } from "@/lib/error-safety";
import { notifyPmAsset } from "@/lib/pm-callback";
import { notifyTaskDone } from "./notify";
import { logTaskDiagnostic, recordTaskFailure } from "./task-failure";
import { recordManagedTaskSuccess } from "@/lib/models/runtime";

/** 视频生成耗时长、用户大概率已切走，终态时推企微提醒 */
const notifyVideoDone = notifyTaskDone;

const POLL_INTERVAL_MS = 8000;
/** 旧任务未记录方舟执行超时时使用的本地兜底值。 */
const LEGACY_VIDEO_TASK_MAX_AGE_MS =
  Number(process.env.VIDEO_TASK_MAX_AGE_MS) || 30 * 60 * 1000;
const processingTaskIds = new Set<string>();

function videoFailureMessage(error: string | undefined): string {
  const detail = error?.toLowerCase() ?? "";
  if (/sensitive|safety|content|risk|moderation/.test(detail)) {
    return "提示词或参考素材未通过模型安全检查，请调整内容后重试。";
  }
  if (/parameter|argument|format|resolution|ratio|invalid/.test(detail)) {
    return "模型无法处理当前视频参数或参考素材，请调整设置后重试。";
  }
  if (/rate|quota|busy|overload|internal|timeout/.test(detail)) {
    return "视频模型服务当前繁忙，请稍后重试。";
  }
  return "视频生成失败，请调整提示词或参考素材后重试。";
}

async function pollOnce() {
  const pending = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.kind, "video"),
        inArray(tasks.status, ["queued", "running"]),
        isNotNull(tasks.arkTaskId)
      )
    )
    .all();

  for (const task of pending) {
    if (processingTaskIds.has(task.id)) continue;
    processingTaskIds.add(task.id);
    try {
      const context = task.contextJson
        ? (JSON.parse(task.contextJson) as {
            bridgeKeys?: string[];
          })
        : null;
      const input = JSON.parse(task.inputJson) as Record<string, unknown>;
      const requestedExpiresAfter = Number(input.executionExpiresAfter);
      const maxAgeMs = Number.isFinite(requestedExpiresAfter) && requestedExpiresAfter >= 3600
        ? requestedExpiresAfter * 1000 + 5 * 60 * 1000
        : LEGACY_VIDEO_TASK_MAX_AGE_MS;
      // 任务到达终态后清理参考素材的中转对象
      const cleanupBridge = () => {
        if (context?.bridgeKeys?.length) void bridgeCleanup(context.bridgeKeys);
      };

      // 超时兜底：方舟长时间不返回终态时，主动判失败并回收，避免永久轮询
      if (Date.now() - task.createdAt.getTime() > maxAgeMs) {
        const timeoutMsg = `视频生成超时（超过 ${Math.round(maxAgeMs / 60000)} 分钟未完成）`;
        recordTaskFailure(task, new Error(timeoutMsg), {
          code: "VIDEO_EXECUTION_TIMEOUT",
          userMessage: `${timeoutMsg}，请缩短时长或稍后重试。`,
          shouldLog: false,
        });
        cleanupBridge();
        continue;
      }

      const ark = await getVideoTask(task.arkTaskId!);

      if (ark.status === "running" && task.status === "queued") {
        updateTask(task.id, { status: "running" });
      } else if (ark.status === "succeeded" && ark.videoUrl) {
        const model = getModel(task.modelKey);
        const asset = await saveMediaAsset({
          projectId: task.projectId,
          userId: task.userId,
          kind: "video",
          remoteUrl: ark.videoUrl,
          meta: {
            modelKey: model.key,
            modelName: model.modelName,
            prompt: String(input.prompt ?? ""),
            params: {
              ...input,
              // 方舟返回的实际生成参数（adaptive / 智能时长场景下与请求值可能不同）
              actualResolution: ark.resolution,
              actualRatio: ark.ratio,
              actualDuration: ark.duration,
              actualFrames: ark.frames,
              framesPerSecond: ark.framesPerSecond,
              actualGenerateAudio: ark.generateAudio,
              actualSeed: ark.seed,
              actualServiceTier: ark.serviceTier,
            },
            sourceAssetIds: [
              ...(input.firstFrameAssetId ? [String(input.firstFrameAssetId)] : []),
              ...(input.lastFrameAssetId ? [String(input.lastFrameAssetId)] : []),
              ...(Array.isArray(input.refAssetIds) ? input.refAssetIds.map(String) : []),
            ],
          },
          sourceTaskId: task.id,
        });
        let lastFrameAssetId: string | null = null;
        if (ark.lastFrameUrl) {
          try {
            const lastFrameAsset = await saveMediaAsset({
              projectId: task.projectId,
              userId: task.userId,
              kind: "image",
              remoteUrl: ark.lastFrameUrl,
              meta: {
                filename: `尾帧 · ${String(input.prompt ?? "").slice(0, 20) || model.label}`,
                modelKey: model.key,
                modelName: model.modelName,
                prompt: String(input.prompt ?? ""),
                role: "last_frame",
                params: {
                  ...input,
                  actualResolution: ark.resolution,
                  actualRatio: ark.ratio,
                  actualDuration: ark.duration,
                  actualFrames: ark.frames,
                  framesPerSecond: ark.framesPerSecond,
                  actualSeed: ark.seed,
                },
                sourceAssetIds: [
                  asset.id,
                  ...(input.firstFrameAssetId ? [String(input.firstFrameAssetId)] : []),
                  ...(input.lastFrameAssetId ? [String(input.lastFrameAssetId)] : []),
                  ...(Array.isArray(input.refAssetIds) ? input.refAssetIds.map(String) : []),
                ],
              },
              sourceTaskId: task.id,
            });
            lastFrameAssetId = lastFrameAsset.id;
          } catch (error) {
            logTaskDiagnostic(task, error, "LAST_FRAME_SAVE_FAILED");
          }
        }
        updateTask(task.id, {
          status: "succeeded",
          outputAssetId: asset.id,
          usageJson: JSON.stringify({
            tokens: ark.completionTokens,
            totalTokens: ark.totalTokens,
            webSearchCalls: ark.webSearchUsage,
            tools: ark.tools,
            seed: ark.seed,
            frames: ark.frames,
            framesPerSecond: ark.framesPerSecond,
            generateAudio: ark.generateAudio,
            priority: ark.priority,
            serviceTier: ark.serviceTier,
            executionExpiresAfter: ark.executionExpiresAfter,
            draft: ark.draft,
            draftTaskId: ark.draftTaskId,
            source: "actual",
          }),
        });
        try {
          recordManagedTaskSuccess(task);
        } catch {
          console.error("[model-health] 视频成功状态写入失败", {
            taskId: task.id,
            modelKey: task.modelKey,
          });
        }
        notifyVideoDone(task, true);
        // 同步到制片管理工具的管线视图（成片判定：无分镜镜头上下文视为一键成片成品）
        void notifyPmAsset({
          postProjectId: task.projectId,
          assetId: asset.id,
          kind: "video",
          isFinal: true,
          prompt: String(input.prompt ?? ""),
          thumbnailAssetId: lastFrameAssetId,
        });
        cleanupBridge();
      } else if (
        ark.status === "failed" ||
        ark.status === "cancelled" ||
        ark.status === "expired"
      ) {
        if (ark.status === "cancelled") {
          updateTask(task.id, {
            status: "cancelled",
            error: "视频生成任务已取消",
            errorCode: "TASK_CANCELLED",
            errorRequestId: null,
          });
        } else {
          recordTaskFailure(task, new Error(ark.error || `方舟任务${ark.status}`), {
            code: ark.status === "expired" ? "ARK_VIDEO_EXPIRED" : "ARK_VIDEO_FAILED",
            userMessage:
              ark.status === "expired"
                ? "视频生成任务已超时，请调整设置后重试。"
                : videoFailureMessage(ark.error),
          });
        }
        cleanupBridge();
      }
    } catch (e) {
      // 单个任务查询失败不影响其它任务，下一轮重试
      logTaskDiagnostic(task, e, "ARK_VIDEO_POLL_FAILED");
    } finally {
      processingTaskIds.delete(task.id);
    }
  }
}

export function startPoller() {
  const g = globalThis as unknown as { __haitunPoller?: NodeJS.Timeout };
  if (g.__haitunPoller) return;
  g.__haitunPoller = setInterval(() => {
    pollOnce().catch((e) =>
      console.error("[poller] 未捕获错误", errorDiagnostic(e))
    );
  }, POLL_INTERVAL_MS);
  console.log("[haitun-post-studio] 视频任务轮询器已启动");
}
