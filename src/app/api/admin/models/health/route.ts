import { z } from "zod";
import { checkCozePluginHealth } from "@/lib/coze/client";
import {
  effectiveQwenTtsInstanceConfig,
  managedModelAdminConfig,
  recordManagedHealthCheck,
} from "@/lib/models/runtime";
import {
  checkQwenTtsInstanceHealth,
  qwenTtsHealthTimeoutMs,
} from "@/lib/modelscope/qwen-tts-runtime";
import { errorResponse, HttpError, requireAdmin } from "@/lib/services";

const schema = z.object({ key: z.string().min(1) });

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      throw new HttpError(400, "模型配置参数无效", "MODEL_CONFIG_INVALID");
    }
    const { key } = parsed.data;
    const item = managedModelAdminConfig(key);
    if (!item.enabled || item.healthStatus === "unconfigured") {
      return Response.json({ item });
    }

    if (item.provider === "ark") {
      recordManagedHealthCheck({
        key,
        status: "unknown",
        message: "Endpoint 与凭据配置完整；方舟健康状态由最近真实任务更新，避免付费探活。",
      });
    } else if (item.provider === "coze") {
      const plugin =
        key === "coze-music"
          ? "music"
          : key === "coze-tts"
            ? "tts"
            : "videoEdit";
      const health = await checkCozePluginHealth(plugin, key, 5_000);
      recordManagedHealthCheck({ key, ...health });
    } else {
      const instance = item.instanceKey === "self-hosted" ? "self-hosted" : "public";
      const health = await checkQwenTtsInstanceHealth(
        effectiveQwenTtsInstanceConfig(instance),
        { timeoutMs: qwenTtsHealthTimeoutMs() }
      );
      const status = health.status;
      if (status !== "disabled") {
        recordManagedHealthCheck({
          key,
          status,
          message: health.message,
        });
      }
    }

    return Response.json({ item: managedModelAdminConfig(key) });
  } catch (error) {
    return errorResponse(error);
  }
}
