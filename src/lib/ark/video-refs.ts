/**
 * 全能参考素材解析（视频生成共用）。
 * 把项目内的参考资产（图 / 视频 / 音频）按方舟「全能参考」要求解析为可提交的形式：
 * - 图片 / 视频 / 音频均经 Supabase 公开桶流式中转，返回公网 URL，
 *   并把中转对象 key 收集到 bridgeKeys，由轮询器在任务结束时清理。
 * 按模型能力做数量校验，保持调用方给定的顺序。
 */
import { inArray } from "drizzle-orm";
import { db, assets } from "@/db";
import {
  bridgeCleanup,
  bridgeUploadImage,
  bridgeUploadObject,
} from "@/lib/coze/media-bridge";
import { HttpError } from "@/lib/services";
import { assertBridgeMediaSize } from "@/lib/media-limits";
import { bridgeReferenceAudio } from "@/lib/reference-audio";
import { REFERENCE_AUDIO_SOURCE_MAX_BYTES } from "@/lib/reference-media-guidance";
import type { VideoCapability } from "./capabilities";

export interface ResolvedVideoRefs {
  refImages?: string[];
  refVideos?: string[];
  refAudios?: string[];
  /** 将界面里的 @素材名转换为方舟识别的 图片1 / 视频1 / 音频1。 */
  prompt: string;
  /** 中转上传产生的对象 key，需在任务结束后清理 */
  bridgeKeys: string[];
}

export type VideoReferenceKind = "image" | "video" | "audio";

function orderedVideoRefs(
  projectId: string,
  refAssetIds: string[],
  cap: VideoCapability,
  modelLabel: string
) {
  const found = db
    .select()
    .from(assets)
    .where(inArray(assets.id, refAssetIds))
    .all()
    .filter((asset) => asset.projectId === projectId && asset.objectKey);
  if (found.length !== refAssetIds.length) {
    throw new HttpError(400, "存在无效的参考素材");
  }
  const ordered = refAssetIds.map((id) => found.find((asset) => asset.id === id)!);
  const images = ordered.filter((asset) => asset.kind === "image");
  const videos = ordered.filter((asset) => asset.kind === "video");
  const audios = ordered.filter((asset) => asset.kind === "audio");
  if (images.length > cap.maxRefImages) {
    throw new HttpError(400, `${modelLabel} 最多支持 ${cap.maxRefImages} 张参考图`);
  }
  if (videos.length > cap.maxRefVideos) {
    throw new HttpError(400, `${modelLabel} 最多支持 ${cap.maxRefVideos} 段参考视频`);
  }
  if (audios.length > cap.maxRefAudios) {
    throw new HttpError(400, `${modelLabel} 最多支持 ${cap.maxRefAudios} 段参考音频`);
  }
  if (ordered.some((asset) => asset.kind === "text")) {
    throw new HttpError(400, "文本素材不能作为参考素材");
  }
  if (audios.length && !images.length && !videos.length) {
    throw new HttpError(400, "音频不能单独作为参考，需至少 1 张图或 1 段视频");
  }
  for (const asset of videos) {
    if (asset.bytes != null) {
      assertBridgeMediaSize(
        asset.bytes,
        asset.mime || "video/mp4"
      );
    }
  }
  for (const asset of audios) {
    if (asset.bytes != null && asset.bytes > REFERENCE_AUDIO_SOURCE_MAX_BYTES) {
      throw new HttpError(
        413,
        "参考音频超过 100 MB，请先裁剪或转换为较短的语音片段。",
        "REFERENCE_AUDIO_SOURCE_TOO_LARGE"
      );
    }
  }
  return { ordered, images, videos, audios };
}

type OrderedVideoRef = ReturnType<typeof orderedVideoRefs>["ordered"][number];

function assetName(asset: OrderedVideoRef): string {
  try {
    const meta = JSON.parse(asset.metaJson) as {
      presetName?: string;
      filename?: string;
      prompt?: string;
    };
    return (
      meta.presetName ||
      meta.filename ||
      meta.prompt?.slice(0, 24) ||
      `${asset.kind}-${asset.id.slice(0, 6)}`
    );
  } catch {
    return `${asset.kind}-${asset.id.slice(0, 6)}`;
  }
}

/** 方舟按同类型素材在 content 中的顺序识别引用，不识别项目内的素材名。 */
function normalizeReferenceMentions(prompt: string, ordered: OrderedVideoRef[]): string {
  const count = { image: 0, video: 0, audio: 0 };
  const prefix = { image: "图片", video: "视频", audio: "音频" } as const;
  const replacements = ordered
    .filter((asset) => asset.kind !== "text")
    .map((asset) => {
      const kind = asset.kind as keyof typeof count;
      count[kind] += 1;
      return { from: `@${assetName(asset)}`, to: `${prefix[kind]}${count[kind]}` };
    })
    .sort((a, b) => b.from.length - a.from.length);

  let normalized = prompt;
  const handled = new Set<string>();
  for (const replacement of replacements) {
    if (handled.has(replacement.from)) continue;
    handled.add(replacement.from);
    normalized = normalized.split(replacement.from).join(replacement.to);
  }
  return normalized;
}

export function validateVideoRefs(
  projectId: string,
  refAssetIds: string[],
  cap: VideoCapability,
  modelLabel: string
): VideoReferenceKind[] {
  const { ordered } = orderedVideoRefs(projectId, refAssetIds, cap, modelLabel);
  return ordered.map((asset) => asset.kind as VideoReferenceKind);
}

/** 原生延长只接受一段项目内视频；实际中转仍由后台 worker 完成。 */
export function validateVideoExtension(
  projectId: string,
  refAssetIds: string[],
  cap: VideoCapability,
  modelLabel: string
): VideoReferenceKind[] {
  const { ordered } = orderedVideoRefs(projectId, refAssetIds, cap, modelLabel);
  if (ordered.length !== 1 || ordered[0]?.kind !== "video") {
    throw new HttpError(400, "原生视频延长需要且只能选择 1 段视频素材");
  }
  return ["video"];
}

/**
 * 解析全能参考素材。调用前应保证 refAssetIds 非空，且已确认模型支持 reference 模式、
 * 与首尾帧互斥（这些与其它请求字段相关的校验留在路由层）。
 */
export async function resolveVideoRefs(
  projectId: string,
  refAssetIds: string[],
  cap: VideoCapability,
  modelLabel: string,
  prompt: string
): Promise<ResolvedVideoRefs> {
  const { ordered, images, videos, audios } = orderedVideoRefs(
    projectId,
    refAssetIds,
    cap,
    modelLabel
  );
  const bridgeKeys: string[] = [];
  try {
    // 视频流式中转；音频按需转为 128kbps MP3；参考图先压缩再中转。
    const bridgeMedia = async (asset: (typeof videos)[number]) => {
      const item = await bridgeUploadObject(
        asset.objectKey!,
        asset.mime || "application/octet-stream"
      );
      bridgeKeys.push(item.key);
      return item.url;
    };
    const bridgeImage = async (asset: (typeof images)[number]) => {
      const item = await bridgeUploadImage(asset.objectKey!, asset.mime);
      bridgeKeys.push(item.key);
      return item.url;
    };
    const refImages: string[] = [];
    for (const asset of images) refImages.push(await bridgeImage(asset));
    const refVideos: string[] = [];
    for (const asset of videos) refVideos.push(await bridgeMedia(asset));
    const refAudios: string[] = [];
    for (const asset of audios) {
      const item = await bridgeReferenceAudio(asset.objectKey!, asset.mime);
      bridgeKeys.push(item.key);
      refAudios.push(item.url);
    }
    return {
      refImages: refImages.length ? refImages : undefined,
      refVideos: refVideos.length ? refVideos : undefined,
      refAudios: refAudios.length ? refAudios : undefined,
      prompt: normalizeReferenceMentions(prompt, ordered),
      bridgeKeys,
    };
  } catch (error) {
    await bridgeCleanup(bridgeKeys);
    throw error;
  }
}
