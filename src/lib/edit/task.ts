import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, assets, type Asset, type Task } from "@/db";
import { callCozeTool, cozeData } from "@/lib/coze/client";
import {
  bridgeCleanup,
  bridgeUploadImage,
  bridgeUploadObject,
} from "@/lib/coze/media-bridge";
import { assertBridgeMediaSize } from "@/lib/media-limits";
import {
  assetKindsForField,
  editTool,
  isAssetField,
  isMultiField,
  type EditToolDef,
} from "@/lib/coze/plugins";
import { HttpError, saveMediaAsset, updateTask } from "@/lib/services";

interface PlannedArgs {
  args: Record<string, unknown>;
  uploads: { fieldKey: string; index: number | null; asset: Asset }[];
  sourceAssetIds: string[];
}

function requireAsset(projectId: string, assetId: string, allowKinds: string[]): Asset {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset || asset.projectId !== projectId) {
    throw new HttpError(400, `素材不存在或不属于该项目: ${assetId}`);
  }
  if (!allowKinds.includes(asset.kind)) {
    throw new HttpError(400, `素材类型不符（需要 ${allowKinds.join("/")}）`);
  }
  if (!asset.objectKey) throw new HttpError(400, "素材缺少媒体文件");
  if (asset.kind !== "image" && asset.bytes !== null) {
    const mime = asset.mime || (asset.kind === "video" ? "video/mp4" : "audio/mpeg");
    assertBridgeMediaSize(asset.bytes, mime);
  }
  return asset;
}

function planToolArgs(
  projectId: string,
  tool: EditToolDef,
  params: Record<string, unknown>
): PlannedArgs {
  const args: Record<string, unknown> = {};
  const uploads: PlannedArgs["uploads"] = [];
  const sourceAssetIds: string[] = [];

  for (const field of tool.fields) {
    const raw = params[field.key];
    if (raw === undefined || raw === null || raw === "") {
      if (field.required) throw new HttpError(400, `缺少参数: ${field.label}`);
      continue;
    }
    if (isAssetField(field.type)) {
      const kinds = assetKindsForField(field.type);
      if (isMultiField(field.type)) {
        const ids = z.array(z.string()).min(1).parse(raw);
        args[field.key] = new Array(ids.length).fill("");
        ids.forEach((assetId, index) => {
          uploads.push({
            fieldKey: field.key,
            index,
            asset: requireAsset(projectId, assetId, kinds),
          });
          sourceAssetIds.push(assetId);
        });
      } else {
        const assetId = z.string().parse(raw);
        uploads.push({
          fieldKey: field.key,
          index: null,
          asset: requireAsset(projectId, assetId, kinds),
        });
        sourceAssetIds.push(assetId);
      }
    } else if (field.type === "number") {
      const value = z.number().parse(raw);
      if (field.min !== undefined && value < field.min) {
        throw new HttpError(400, `${field.label} 不能小于 ${field.min}`);
      }
      if (field.max !== undefined && value > field.max) {
        throw new HttpError(400, `${field.label} 不能大于 ${field.max}`);
      }
      args[field.key] = value;
    } else if (field.type === "boolean") {
      args[field.key] = z.boolean().parse(raw);
    } else if (field.type === "select") {
      const value = z.string().parse(raw);
      if (field.options && !field.options.some((option) => option.value === value)) {
        throw new HttpError(400, `${field.label} 取值无效`);
      }
      args[field.key] = value;
    }
  }

  if (tool.key === "compile_video_audio") {
    const sync = String(args.sync ?? "none");
    delete args.sync;
    if (sync !== "none") {
      const [mode, method] = sync.split("_");
      args.is_video_audio_sync = true;
      args.output_sync = { sync_mode: mode, sync_method: method };
    } else {
      args.is_video_audio_sync = false;
    }
  }
  args.url_expire = 86400;
  return { args, uploads, sourceAssetIds };
}

export function validateEditTask(
  projectId: string,
  toolKey: string,
  params: Record<string, unknown>
): EditToolDef {
  let tool: EditToolDef;
  try {
    tool = editTool(toolKey);
  } catch {
    throw new HttpError(400, `未知剪辑工具: ${toolKey}`);
  }
  planToolArgs(projectId, tool, params);
  return tool;
}

export async function executeEditTask(task: Task): Promise<void> {
  const input = JSON.parse(task.inputJson) as {
    tool: string;
    params: Record<string, unknown>;
  };
  const tool = validateEditTask(task.projectId, input.tool, input.params);
  const planned = planToolArgs(task.projectId, tool, input.params);
  const bridgeKeys: string[] = [];
  try {
    for (const upload of planned.uploads) {
      const bridged =
        upload.asset.kind === "image"
          ? await bridgeUploadImage(upload.asset.objectKey!, upload.asset.mime)
          : await bridgeUploadObject(
              upload.asset.objectKey!,
              upload.asset.mime ||
                (upload.asset.kind === "video" ? "video/mp4" : "audio/mpeg")
            );
      bridgeKeys.push(bridged.key);
      if (upload.index === null) planned.args[upload.fieldKey] = bridged.url;
      else (planned.args[upload.fieldKey] as string[])[upload.index] = bridged.url;
    }

    const result = await callCozeTool("videoEdit", tool.key, planned.args);
    const data = cozeData(result);
    const url = String(data.url ?? "");
    if (!url) throw new Error(`未返回产物地址: ${result.rawText.slice(0, 200)}`);
    const meta = data.video_meta as
      | { type?: string; resolution?: string; duration?: number; fps?: number }
      | undefined;
    const kind = meta?.type === "audio" ? "audio" : tool.outputKind;
    const asset = await saveMediaAsset({
      projectId: task.projectId,
      userId: task.userId,
      kind,
      remoteUrl: url,
      meta: {
        modelKey: "coze-edit",
        modelName: `剪辑 · ${tool.label}`,
        prompt: tool.label,
        params: {
          tool: tool.key,
          resolution: meta?.resolution,
          duration: meta?.duration,
          fps: meta?.fps,
        },
        sourceAssetIds: planned.sourceAssetIds,
      },
      sourceTaskId: task.id,
    });
    updateTask(task.id, { status: "succeeded", outputAssetId: asset.id });
  } finally {
    await bridgeCleanup(bridgeKeys);
  }
}
