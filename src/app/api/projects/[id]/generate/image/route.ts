import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db, assets } from "@/db";
import { isImageSizeSupported } from "@/lib/ark/capabilities";
import { runtimeImageModel } from "@/lib/models/runtime";
import {
  createTask,
  errorResponse,
  HttpError,
  requireProjectMember,
} from "@/lib/services";

const schema = z.object({
  prompt: z.string().min(1, "请输入提示词"),
  modelKey: z.string().default("seedream-5.0"),
  /** 具体像素值（如 2848x1600）或档位（2K/4K） */
  size: z.string().default("2048x2048"),
  /** 仅用于记录展示的画幅比例 */
  ratio: z.string().optional(),
  refAssetIds: z.array(z.string()).max(14).default([]),
  /** 创作预设：角色 / 场景 / 风格设定（服务端套用专业模板） */
  preset: z.enum(["character", "scene", "style"]).optional(),
  /** 预设下的角色名 / 场景名，用于资产标记 */
  presetName: z.string().max(30).optional(),
  /** 组图张数（>1 时开启连续生成，需模型支持） */
  count: z.number().int().min(1).max(15).default(1),
  /** 联网搜索（仅 Lite） */
  webSearch: z.boolean().default(false),
  /** 提示词优化模式（仅 Pro / 4.0 支持 fast） */
  optimizeMode: z.enum(["standard", "fast"]).optional(),
  /** 输出格式（仅 Pro / Lite 可选） */
  outputFormat: z.enum(["png", "jpeg"]).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await requireProjectMember(id);
    const body = schema.parse(await req.json());
    const model = runtimeImageModel(body.modelKey);
    const cap = model.capability;
    if (!isImageSizeSupported(model.key, body.size, cap)) {
      throw new HttpError(400, `${model.label} 不支持尺寸 ${body.size}`);
    }
    if (body.refAssetIds.length > cap.maxRefImages) {
      throw new HttpError(400, `${model.label} 最多支持 ${cap.maxRefImages} 张参考图`);
    }
    if (body.count > 1) {
      if (!cap.supportsSequential) {
        throw new HttpError(400, `${model.label} 不支持组图生成`);
      }
      if (body.refAssetIds.length + body.count > cap.maxImagesPerGen) {
        throw new HttpError(400, `参考图数量 + 生成张数不能超过 ${cap.maxImagesPerGen}`);
      }
    }
    if (body.webSearch && !cap.supportsWebSearch) {
      throw new HttpError(400, `${model.label} 不支持联网搜索`);
    }
    if (body.optimizeMode === "fast" && !cap.supportsFast) {
      throw new HttpError(400, `${model.label} 不支持 fast 提示词优化`);
    }
    if (body.outputFormat && !cap.supportsOutputFormat) {
      throw new HttpError(400, `${model.label} 不支持自定义输出格式`);
    }

    if (body.preset) {
      const name = body.presetName?.trim();
      if (!name) throw new HttpError(400, "请填写角色名 / 场景名");
    }

    // 入队前校验参考图；worker 执行时再流式中转，避免请求内加载大图。
    if (body.refAssetIds.length) {
      const refs = db
        .select()
        .from(assets)
        .where(inArray(assets.id, body.refAssetIds))
        .all()
        .filter((a) => a.projectId === id && a.kind === "image" && a.objectKey);
      if (refs.length !== body.refAssetIds.length) {
        throw new HttpError(400, "存在无效的参考图资产");
      }
    }

    // 后台任务：公司网关对长请求有超时限制（504），Seedream 高分辨率生成可超 1 分钟
    const task = createTask({
      projectId: id,
      userId: user.id,
      kind: "image",
      modelKey: model.key,
      input: body,
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
