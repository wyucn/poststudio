/**
 * 成片合成共享执行逻辑（流水线·成片 与 剪辑器·导出 共用）。
 * 流程：中转上传 →（按需）逐片段裁剪 / 变速 / 静音 → 拼接(+转场) →（可选）配乐混音
 *   →（可选）字幕烧录 →（可选）超分 → 转存素材库。
 * 全部通过 Coze 视频剪辑插件在云端完成；本站域名 Coze 不可达，素材经 Supabase 公开桶中转。
 */
import type { Asset } from "@/db";
import { saveMediaAsset, updateTask } from "@/lib/services";
import { callCozeTool, cozeData } from "@/lib/coze/client";
import {
  bridgeCleanup,
  bridgeUpload,
  bridgeUploadObject,
} from "@/lib/coze/media-bridge";
import { logTaskDiagnostic } from "@/lib/tasks/task-failure";
import { ldapOf, notifyWecom } from "@/lib/wecom";

export interface CompileClipInput {
  asset: Asset;
  trimStart?: number;
  trimEnd?: number;
  /** 变速倍率（0.25~4，留空 / 1 = 原速） */
  speed?: number;
  /** 静音该片段原声（拼接前置 0 音量） */
  muted?: boolean;
}

export interface RunCompileOptions {
  taskId: string;
  projectId: string;
  userId: string;
  userEmail: string;
  /** 成片标题（素材名 / 通知用） */
  title: string;
  clips: CompileClipInput[];
  audio?: Asset | null;
  /** 音视频时长对齐策略：none / video_trim / video_speed / audio_trim / audio_speed */
  sync: string;
  keepOriginalAudio: boolean;
  /** 配乐音量倍数（留空 / 1 = 原音量） */
  audioVolume?: number;
  /** 拼接转场 id（已校验；留空 = 硬切） */
  transition?: string;
  /** 预先拼好的 SRT 字幕内容（流水线端按镜头台词生成；剪辑器端留空） */
  subtitleSrt?: string;
  /** 成片超分（留空 = 原始分辨率） */
  upscale?: "1080p" | "2K" | "4K";
  /** 来源素材 id（写入产物 meta.sourceAssetIds） */
  sourceAssetIds: string[];
}

/** 执行成片合成（后台任务内调用）。成功时存库并通知，失败交由 worker 统一记录。 */
export async function runCompile(opts: RunCompileOptions): Promise<void> {
  const {
    taskId,
    projectId,
    userId,
    userEmail,
    title,
    clips,
    audio,
    sync,
    keepOriginalAudio,
    audioVolume,
    transition,
    subtitleSrt,
    upscale,
    sourceAssetIds,
  } = opts;

  const bridgeKeys: string[] = [];
  const warnings: string[] = [];
  const diagnosticContext = {
    id: taskId,
    projectId,
    kind: "edit" as const,
    modelKey: "coze-edit",
  };
  try {
    updateTask(taskId, { status: "running" });

    // 1. 中转上传镜头视频（保持时间线顺序）
    const videoUrls: string[] = [];
    for (const c of clips) {
      const bridged = await bridgeUploadObject(
        c.asset.objectKey!,
        c.asset.mime || "video/mp4"
      );
      bridgeKeys.push(bridged.key);
      videoUrls.push(bridged.url);
    }

    // 2. 逐片段裁剪 / 变速 / 静音
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (c.trimStart !== undefined || c.trimEnd !== undefined) {
        const trimmed = await callCozeTool("videoEdit", "video_trim", {
          video: videoUrls[i],
          ...(c.trimStart !== undefined ? { start_time: c.trimStart } : {}),
          ...(c.trimEnd !== undefined ? { end_time: c.trimEnd } : {}),
          url_expire: 86400,
        });
        const u = String(cozeData(trimmed).url ?? "");
        if (!u) throw new Error(`镜头 ${i + 1} 裁剪未返回产物地址`);
        videoUrls[i] = u;
      }
      if (c.speed !== undefined && Math.abs(c.speed - 1) > 0.001) {
        const sped = await callCozeTool("videoEdit", "video_speed", {
          video: videoUrls[i],
          speed: c.speed,
          url_expire: 86400,
        });
        const u = String(cozeData(sped).url ?? "");
        if (!u) throw new Error(`镜头 ${i + 1} 变速未返回产物地址`);
        videoUrls[i] = u;
      }
      if (c.muted) {
        const muted = await callCozeTool("videoEdit", "ajust_audio_volume", {
          video: videoUrls[i],
          volume: 0,
          url_expire: 86400,
        });
        const u = String(cozeData(muted).url ?? "");
        if (!u) throw new Error(`镜头 ${i + 1} 静音未返回产物地址`);
        videoUrls[i] = u;
      }
    }

    // 3. 拼接（可选转场）
    let resultUrl: string;
    if (videoUrls.length >= 2) {
      const concat = await callCozeTool("videoEdit", "concat_videos", {
        videos: videoUrls,
        ...(transition ? { transitions: [transition] } : {}),
        url_expire: 86400,
      });
      resultUrl = String(cozeData(concat).url ?? "");
      if (!resultUrl) throw new Error("视频拼接未返回产物地址");
    } else {
      resultUrl = videoUrls[0];
    }

    // 4. 挂配乐
    if (audio) {
      const bridgedAudio = await bridgeUploadObject(
        audio.objectKey!,
        audio.mime || "audio/mpeg"
      );
      bridgeKeys.push(bridgedAudio.key);
      let audioUrl = bridgedAudio.url;
      if (audioVolume !== undefined && Math.abs(audioVolume - 1) > 0.001) {
        const vol = await callCozeTool("videoEdit", "ajust_audio_volume", {
          video: audioUrl,
          volume: audioVolume,
          url_expire: 86400,
        });
        const u = String(cozeData(vol).url ?? "");
        if (!u) throw new Error("配乐音量调整未返回产物地址");
        audioUrl = u;
      }
      const syncArgs =
        sync === "none"
          ? { is_video_audio_sync: false }
          : {
              is_video_audio_sync: true,
              output_sync: {
                sync_mode: sync.split("_")[0],
                sync_method: sync.split("_")[1],
              },
            };
      const mixed = await callCozeTool("videoEdit", "compile_video_audio", {
        video: resultUrl,
        audio: audioUrl,
        is_audio_reserve: keepOriginalAudio,
        ...syncArgs,
        url_expire: 86400,
      });
      resultUrl = String(cozeData(mixed).url ?? "");
      if (!resultUrl) throw new Error("配乐合成未返回产物地址");
    }

    // 5. 字幕烧录（流水线端传入 SRT；失败不阻断）
    if (subtitleSrt && subtitleSrt.trim()) {
      try {
        const bridgedSrt = await bridgeUpload(
          Buffer.from(subtitleSrt, "utf-8"),
          "application/x-subrip",
          "srt"
        );
        bridgeKeys.push(bridgedSrt.key);
        const subtitled = await callCozeTool("videoEdit", "add_subtitles", {
          video: resultUrl,
          subtitle_url: bridgedSrt.url,
          subtitle_config: {
            font_size: 48,
            font_color: "#FFFFFF",
            border_color: "#000000",
            border_width: 2,
            font_pos_config: { width: "80%", height: "15%", pos_x: "10%", pos_y: "80%" },
          },
          url_expire: 86400,
        });
        const u = String(cozeData(subtitled).url ?? "");
        if (!u) throw new Error("未返回产物地址");
        resultUrl = u;
      } catch (e) {
        const requestId = logTaskDiagnostic(
          diagnosticContext,
          e,
          "COMPILE_SUBTITLE_FAILED"
        );
        warnings.push(`字幕烧录失败，已输出无字幕版本（错误编号：${requestId}）`);
      }
    }

    // 6. 成片超分（失败不阻断）
    if (upscale) {
      try {
        const up = await callCozeTool("videoEdit", "video_super_resolution", {
          video: resultUrl,
          resolution: upscale,
          url_expire: 86400,
        });
        const u = String(cozeData(up).url ?? "");
        if (!u) throw new Error("未返回产物地址");
        resultUrl = u;
      } catch (e) {
        const requestId = logTaskDiagnostic(
          diagnosticContext,
          e,
          "COMPILE_UPSCALE_FAILED"
        );
        warnings.push(`超分失败，已输出原始分辨率（错误编号：${requestId}）`);
      }
    }

    // 7. 转存素材库
    const features = [
      transition ? "转场" : null,
      audio ? "配乐" : null,
      subtitleSrt ? "字幕" : null,
      upscale ? `超分${upscale}` : null,
    ].filter(Boolean);
    const featureText = features.length ? ` + ${features.join(" / ")}` : "";
    const asset = await saveMediaAsset({
      projectId,
      userId,
      kind: "video",
      remoteUrl: resultUrl,
      meta: {
        modelKey: "coze-edit",
        modelName: `成片 · ${title}`,
        prompt: `时间线成片（${clips.length} 个片段${featureText}）${
          warnings.length ? `；注意：${warnings.join("；")}` : ""
        }`,
        params: { shotCount: clips.length },
        sourceAssetIds,
      },
      sourceTaskId: taskId,
    });
    updateTask(taskId, { status: "succeeded", outputAssetId: asset.id });
    void notifyWecom(
      `🎬 成片合成完成｜「${title}」（${clips.length} 个片段${featureText}）${
        warnings.length ? `\n⚠️ ${warnings.join("；")}` : ""
      }\n@${ldapOf(userEmail)} 去素材库查看吧`,
      [ldapOf(userEmail)]
    );
  } finally {
    await bridgeCleanup(bridgeKeys);
  }
}
