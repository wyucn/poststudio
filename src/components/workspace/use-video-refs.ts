"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { assetRawUrl, type AssetDto } from "@/lib/client/types";
import {
  REF_MEDIA_MAX_SECONDS,
  type VideoCapability,
} from "@/lib/ark/capabilities";
import { probeDuration } from "./ref-trim-dialog";
import {
  REFERENCE_AUDIO_SOURCE_MAX_BYTES,
  REFERENCE_VIDEO_MAX_BYTES,
  referenceAudioNeedsTranscode,
  referenceAudioTranscodeNotice,
  videoCompressionAdvice,
} from "@/lib/reference-media-guidance";

// 浏览器读取的是媒体容器的完整时间轴。受末帧和音频编码 padding 影响，
// 标称 15 秒的素材常会被报告为略大于 15 秒，因此边界判断需要保留小幅容差。
const REF_MEDIA_DURATION_TOLERANCE_SECONDS = 0.25;

function normalizeBoundaryDuration(duration: number) {
  if (
    duration > REF_MEDIA_MAX_SECONDS &&
    duration <= REF_MEDIA_MAX_SECONDS + REF_MEDIA_DURATION_TOLERANCE_SECONDS
  ) {
    return REF_MEDIA_MAX_SECONDS;
  }
  return duration;
}

/** 按 id 批量取项目内资产（命中 react-query 缓存），用于回填已选参考素材 */
export function useAssetsByIds(projectId: string) {
  const qc = useQueryClient();
  return async (ids: unknown): Promise<AssetDto[]> => {
    const list = Array.isArray(ids) ? ids.map(String) : [];
    if (!list.length) return [];
    const all = await qc.fetchQuery<AssetDto[]>({
      queryKey: ["assets-by-id", projectId, list.join(",")],
      queryFn: () =>
        api(`/api/projects/${projectId}/assets?ids=${encodeURIComponent(list.join(","))}`),
      staleTime: 10_000,
    });
    return list
      .map((aid) => all.find((a) => a.id === aid))
      .filter((a): a is AssetDto => !!a);
  };
}

/**
 * 全能参考素材选择状态 + 校验（视频生成共用：独立面板与流水线镜头卡片）。
 * 校验依据方舟官方限制：图 ≤ maxRefImages（单张 ≤30MB）；视频 mp4/mov、单段 2-15s、
 * <50MB、≤ maxRefVideos 段且总时长 ≤15s；音频源文件 ≤100MB、单段 2-15s、
 * ≤ maxRefAudios 段且总时长 ≤15s，提交时按需转为受支持的 MP3；超长素材交由调用方
 * 弹出裁剪（trim 状态）。
 */
export function useVideoRefs(cap: VideoCapability, initialRefs: AssetDto[] = []) {
  const [refs, setRefs] = useState<AssetDto[]>(initialRefs);
  const [refDurations, setRefDurations] = useState<Record<string, number>>({});
  const [refError, setRefError] = useState("");
  const [refProbing, setRefProbing] = useState(false);
  const [trim, setTrim] = useState<{ asset: AssetDto; duration: number } | null>(null);
  const refNotice = useMemo(() => {
    const transcodeAudios = refs.filter(
      (asset) =>
        asset.kind === "audio" &&
        referenceAudioNeedsTranscode(asset.bytes ?? 0, asset.mime)
    );
    return transcodeAudios.length
      ? referenceAudioTranscodeNotice(
          transcodeAudios[0]?.bytes,
          transcodeAudios.length
        )
      : "";
  }, [refs]);

  const refCount = useMemo(
    () => ({
      image: refs.filter((a) => a.kind === "image").length,
      video: refs.filter((a) => a.kind === "video").length,
      audio: refs.filter((a) => a.kind === "audio").length,
    }),
    [refs]
  );

  const refKinds = useMemo(() => {
    const ks: ("image" | "video" | "audio")[] = ["image"];
    if (cap.maxRefVideos > 0) ks.push("video");
    if (cap.maxRefAudios > 0) ks.push("audio");
    return ks;
  }, [cap]);

  // 官方限制：音频不可单独作参考，需至少 1 张图或 1 段视频
  const audioOnlyRefs =
    refs.length > 0 && refCount.image === 0 && refCount.video === 0;

  async function addRef(a: AssetDto, knownDuration?: number) {
    setRefError("");
    if (a.kind === "text") return;
    if (refs.some((x) => x.id === a.id)) return;
    const kindName = a.kind === "image" ? "图" : a.kind === "video" ? "视频" : "音频";
    const limit =
      a.kind === "image"
        ? cap.maxRefImages
        : a.kind === "video"
          ? cap.maxRefVideos
          : cap.maxRefAudios;
    const used = refCount[a.kind as "image" | "video" | "audio"];
    if (used >= limit) {
      setRefError(
        limit === 0 ? `当前模型不支持参考${kindName}` : `参考${kindName}最多 ${limit} 个`
      );
      return;
    }
    const totalLimit = cap.maxRefImages + cap.maxRefVideos + cap.maxRefAudios;
    if (refs.length >= totalLimit) {
      setRefError(`参考素材合计最多 ${totalLimit} 个`);
      return;
    }
    if (a.kind === "image" && (a.bytes ?? 0) > 30 * 1024 * 1024) {
      setRefError("参考图单个不能超过 30MB");
      return;
    }
    if (
      a.kind === "audio" &&
      (a.bytes ?? 0) > REFERENCE_AUDIO_SOURCE_MAX_BYTES
    ) {
      setRefError("参考音频源文件不能超过 100MB，请先裁剪或压缩");
      return;
    }
    // 格式限制（官方：视频 mp4/mov，音频 mp3/wav）
    if (a.kind === "video" && a.mime && !["video/mp4", "video/quicktime"].includes(a.mime)) {
      setRefError("参考视频仅支持 MP4 / MOV 格式");
      return;
    }
    if (a.kind === "video" || a.kind === "audio") {
      let dur = knownDuration ?? refDurations[a.id];
      if (dur === undefined) {
        setRefProbing(true);
        try {
          dur = await probeDuration(assetRawUrl(a.id), a.kind);
        } finally {
          setRefProbing(false);
        }
      }
      if (!isFinite(dur)) {
        setRefError(
          `无法读取该${kindName}的时长，无法确认是否满足 15 秒限制，请换一个素材或先在剪辑工具中裁剪`
        );
        return;
      }
      const measuredDuration = dur;
      const effectiveDuration = normalizeBoundaryDuration(measuredDuration);
      setRefDurations((prev) => ({ ...prev, [a.id]: effectiveDuration }));
      if (
        a.kind === "video" &&
        (a.bytes ?? 0) > REFERENCE_VIDEO_MAX_BYTES
      ) {
        setRefError(
          videoCompressionAdvice({
            bytes: a.bytes ?? 0,
            durationSeconds: measuredDuration,
          })
        );
        return;
      }
      if (
        measuredDuration >
        REF_MEDIA_MAX_SECONDS + REF_MEDIA_DURATION_TOLERANCE_SECONDS
      ) {
        setTrim({ asset: a, duration: measuredDuration });
        return;
      }
      if (effectiveDuration < 2) {
        setRefError(
          `参考${kindName}单段至少 2 秒（该素材 ${effectiveDuration.toFixed(1)}s）`
        );
        return;
      }
      // 同类总时长 ≤ 15s（官方限制）
      const total =
        refs
          .filter((x) => x.kind === a.kind)
          .reduce((sum, x) => sum + (refDurations[x.id] ?? 0), 0) +
        effectiveDuration;
      if (
        total >
        REF_MEDIA_MAX_SECONDS + REF_MEDIA_DURATION_TOLERANCE_SECONDS
      ) {
        setRefError(
          `所有参考${kindName}总时长不能超过 ${REF_MEDIA_MAX_SECONDS}s（当前合计 ${total.toFixed(1)}s），请移除或裁剪部分素材`
        );
        return;
      }
    }
    setRefs((prev) => [...prev, a]);
  }

  function removeRef(id: string) {
    setRefs((prev) => prev.filter((x) => x.id !== id));
  }

  return {
    refs,
    setRefs,
    refError,
    refNotice,
    refProbing,
    trim,
    setTrim,
    refCount,
    refKinds,
    audioOnlyRefs,
    addRef,
    removeRef,
  };
}
