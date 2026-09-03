import { eq } from "drizzle-orm";
import {
  db,
  assets,
  users,
  type Asset,
  type Task,
} from "@/db";
import { runCompile } from "@/lib/edit/compile";
import { HttpError } from "@/lib/http-error";
import { assertBridgeMediaSize } from "@/lib/media-limits";

interface CompileClip {
  assetId: string;
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  muted?: boolean;
  shotId?: string;
}

interface CompileParams {
  clips: CompileClip[];
  audioAssetId?: string;
  audioVolume?: number;
  sync: string;
  keepOriginalAudio: boolean;
  title?: string;
  transition?: string;
  burnSubtitles?: boolean;
  upscale?: "1080p" | "2K" | "4K";
}

function requireMedia(projectId: string, assetId: string, kind: "video" | "audio"): Asset {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset || asset.projectId !== projectId || asset.kind !== kind || !asset.objectKey) {
    throw new HttpError(
      400,
      `无效或已删除的${kind === "video" ? "视频" : "音频"}素材`,
      "EDIT_ASSET_INVALID"
    );
  }
  if (asset.bytes !== null) {
    assertBridgeMediaSize(asset.bytes, asset.mime || (kind === "video" ? "video/mp4" : "audio/mpeg"));
  }
  return asset;
}

export async function executeCompileTask(task: Task): Promise<void> {
  const input = JSON.parse(task.inputJson) as { params: CompileParams };
  const user = db.select().from(users).where(eq(users.id, task.userId)).get();
  if (!user) throw new Error("任务用户不存在");
  const params = input.params;
  const clips = params.clips.map((clip) => ({
    asset: requireMedia(task.projectId, clip.assetId, "video"),
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    speed: clip.speed,
    muted: clip.muted,
  }));
  const audio = params.audioAssetId
    ? requireMedia(task.projectId, params.audioAssetId, "audio")
    : null;
  const sourceAssetIds = [
    ...params.clips.map((clip) => clip.assetId),
    ...(params.audioAssetId ? [params.audioAssetId] : []),
  ];

  await runCompile({
    taskId: task.id,
    projectId: task.projectId,
    userId: task.userId,
    userEmail: user.email,
    title: params.title?.trim() || "剪辑成片",
    clips,
    audio,
    sync: params.sync,
    keepOriginalAudio: params.keepOriginalAudio,
    audioVolume: params.audioVolume,
    sourceAssetIds,
  });
}
