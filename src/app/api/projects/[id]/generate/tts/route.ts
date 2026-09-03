/**
 * 语音合成（Coze 内置音色 / ModelScope Qwen3-TTS 声音克隆）。
 * 统一写入持久任务队列，避免公司网关超时并支持进程重启恢复。
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assets, db } from "@/db";
import {
  createTask,
  errorResponse,
  HttpError,
  requireProjectMember,
} from "@/lib/services";
import {
  isQwenTtsInstanceKey,
} from "@/lib/modelscope/qwen-tts-runtime";
import {
  assertManagedModelAvailable,
  effectiveQwenTtsDefaultInstance,
  effectiveQwenTtsInstanceConfig,
} from "@/lib/models/runtime";

const schema = z.object({
  provider: z.enum(["coze", "modelscope"]).default("coze"),
  text: z.string().min(1).max(1024),
  voiceId: z.string().optional(),
  emotion: z.string().optional(),
  emotionScale: z.number().min(1).max(5).optional(),
  speedRatio: z.number().min(0.2).max(3).optional(),
  referenceAudioAssetId: z.string().optional(),
  referenceText: z.string().max(2048).optional(),
  instance: z.enum(["public", "self-hosted"]).optional(),
  language: z.enum([
    "Auto",
    "Chinese",
    "English",
    "Japanese",
    "Korean",
    "French",
    "German",
    "Spanish",
    "Portuguese",
    "Russian",
  ]).optional(),
  useXVectorOnly: z.boolean().optional(),
  modelSize: z.enum(["0.6B", "1.7B"]).optional(),
});

const QWEN_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await requireProjectMember(id);
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const input = parsed.data;
    if (Buffer.byteLength(input.text, "utf8") > 1024) {
      throw new HttpError(400, "文本超长：最多 1024 字节（约 340 个汉字）");
    }

    if (input.provider === "modelscope") {
      const instance = isQwenTtsInstanceKey(input.instance)
        ? input.instance
        : effectiveQwenTtsDefaultInstance();
      const instanceConfig = effectiveQwenTtsInstanceConfig(instance);
      if (!instanceConfig.configured) {
        const message =
          !instanceConfig.enabled
            ? `${instanceConfig.label}已由管理员暂时下线，请切换实例`
            : instance === "public"
            ? "公共 Qwen3-TTS 创空间尚未配置 Access Token，请联系管理员或切换到自建实例"
            : "尚未配置 Qwen3-TTS 自建实例，请联系管理员或切换到公共创空间";
        throw new HttpError(
          503,
          message,
          "QWEN_TTS_INSTANCE_NOT_CONFIGURED"
        );
      }
      if (!input.referenceAudioAssetId) {
        throw new HttpError(400, "请选择参考音频素材");
      }
      if (!input.useXVectorOnly && !input.referenceText?.trim()) {
        throw new HttpError(400, "高质量克隆需要填写参考音频的准确文本");
      }
      const referenceAsset = db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, input.referenceAudioAssetId),
            eq(assets.projectId, id),
            eq(assets.kind, "audio")
          )
        )
        .get();
      if (!referenceAsset?.objectKey) {
        throw new HttpError(400, "参考音频不存在、已删除或不属于当前项目");
      }
      if ((referenceAsset.bytes ?? 0) > QWEN_REFERENCE_MAX_BYTES) {
        throw new HttpError(400, "参考音频不能超过 20 MB，请先裁剪为短语音样本");
      }
    } else {
      assertManagedModelAvailable("coze-tts");
    }

    const task = createTask({
      projectId: id,
      userId: user.id,
      kind: "audio",
      modelKey:
      input.provider === "modelscope" ? "modelscope-qwen3-tts" : "coze-tts",
      input: {
        prompt: input.text,
        ...input,
        ...(input.provider === "modelscope"
          ? {
              instance: isQwenTtsInstanceKey(input.instance)
                ? input.instance
                : effectiveQwenTtsDefaultInstance(),
            }
          : {}),
      },
      status: "queued",
    });
    return Response.json({ task });
  } catch (e) {
    return errorResponse(e);
  }
}
