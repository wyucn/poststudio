"use client";

/**
 * 全能参考素材超长（>15s）时的裁剪对话框：
 * - 视频：预览 + 起止时间，提交 Coze 视频裁剪任务，完成后产出新素材并自动挂为参考；
 * - 音频：波形框选片段，前端切片为 WAV 直接上传素材库（即时完成）。
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Scissors } from "lucide-react";
import { api } from "@/lib/client/api";
import { uploadAssetFile } from "@/lib/client/upload";
import { assetLabel, assetRawUrl, type AssetDto, type TaskDto } from "@/lib/client/types";
import { REF_MEDIA_MAX_SECONDS } from "@/lib/ark/capabilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AudioWave } from "./audio-wave";
import { StatusMessage } from "@/components/ui/status-message";

/** 读取媒体文件时长（秒），失败返回 NaN（调用方必须把 NaN 当作不可用处理） */
export function probeDuration(url: string, kind: "video" | "audio"): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    let settled = false;
    const done = (v: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.src = "";
      resolve(v);
    };
    const timer = setTimeout(() => done(NaN), 20000);
    el.onloadedmetadata = () => {
      if (isFinite(el.duration) && el.duration > 0) {
        done(el.duration);
        return;
      }
      // 部分流式封装 duration 为 Infinity，需要 seek 触发 durationchange
      el.ondurationchange = () => {
        if (isFinite(el.duration) && el.duration > 0) done(el.duration);
      };
      try {
        el.currentTime = 1e10;
      } catch {
        done(NaN);
      }
      setTimeout(() => done(isFinite(el.duration) ? el.duration : NaN), 4000);
    };
    el.onerror = () => done(NaN);
    el.src = url;
  });
}

function VideoTrim({
  projectId,
  asset,
  duration,
  onDone,
}: {
  projectId: string;
  asset: AssetDto;
  duration: number;
  onDone: (a: AssetDto, durationSec: number) => void;
}) {
  const qc = useQueryClient();
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState(String(Math.min(REF_MEDIA_MAX_SECONDS, Math.floor(duration))));
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const s = Number(start);
  const e = Number(end);
  const valid =
    isFinite(s) && isFinite(e) && s >= 0 && e > s && e <= duration + 0.01 &&
    e - s <= REF_MEDIA_MAX_SECONDS;

  async function submit() {
    setError("");
    setPhase("working");
    try {
      const { task } = await api<{ task: TaskDto }>(`/api/projects/${projectId}/edit`, {
        method: "POST",
        json: { tool: "video_trim", params: { video: asset.id, start_time: s, end_time: e } },
      });
      // 轮询裁剪任务直到产出新素材
      timerRef.current = setInterval(async () => {
        try {
          const t = await api<TaskDto>(`/api/tasks/${task.id}`);
          if (t.status === "succeeded" && t.outputAssetId) {
            clearInterval(timerRef.current!);
            const list = await api<AssetDto[]>(
              `/api/projects/${projectId}/assets?ids=${encodeURIComponent(t.outputAssetId)}`
            );
            const out = list.find((a) => a.id === t.outputAssetId);
            qc.invalidateQueries({ queryKey: ["assets", projectId] });
            if (out) onDone(out, e - s);
            else {
              setError("裁剪完成但未找到产物素材");
              setPhase("idle");
            }
          } else if (t.status === "failed" || t.status === "cancelled") {
            clearInterval(timerRef.current!);
            setError(t.error || "裁剪失败");
            setPhase("idle");
          }
        } catch {
          /* 单次轮询失败忽略，下次重试 */
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-3">
      <video
        src={assetRawUrl(asset.id)}
        controls
        preload="metadata"
        className="max-h-60 w-full rounded-md border border-border"
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="reference-trim-start">开始（秒）</Label>
          <Input
            id="reference-trim-start"
            type="number"
            min={0}
            step={0.1}
            value={start}
            onChange={(ev) => setStart(ev.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reference-trim-end">结束（秒）</Label>
          <Input
            id="reference-trim-end"
            type="number"
            min={0}
            step={0.1}
            value={end}
            onChange={(ev) => setEnd(ev.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        原素材 {duration.toFixed(1)}s，选取不超过 {REF_MEDIA_MAX_SECONDS}s 的片段
        {valid && `（当前 ${(e - s).toFixed(1)}s）`}
      </p>
      {error && <StatusMessage tone="danger">{error}</StatusMessage>}
      <Button
        onClick={submit}
        disabled={!valid}
        loading={phase === "working"}
        loadingText="裁剪中（约 1 分钟）"
        className="w-full"
      >
        <Scissors />
        裁剪并用作参考
      </Button>
    </div>
  );
}

function AudioTrim({
  projectId,
  asset,
  onDone,
}: {
  projectId: string;
  asset: AssetDto;
  onDone: (a: AssetDto, durationSec: number) => void;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveClip(blob: Blob, durationSec: number) {
    if (durationSec > REF_MEDIA_MAX_SECONDS) {
      setError(`选区 ${durationSec.toFixed(1)}s 超过 ${REF_MEDIA_MAX_SECONDS}s，请缩小选区`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const file = new File([blob], `${assetLabel(asset)}-ref.wav`, {
        type: "audio/wav",
      });
      const data = await uploadAssetFile({
        projectId,
        file,
        allowedKinds: ["audio"],
      });
      qc.invalidateQueries({ queryKey: ["assets", projectId] });
      onDone(data, durationSec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <AudioWave
        src={assetRawUrl(asset.id)}
        filename={assetLabel(asset)}
        onSaveClip={saveClip}
        saving={saving}
        maxSelection={REF_MEDIA_MAX_SECONDS}
      />
      <p className="text-xs text-muted-foreground">
        拖动手柄选出不超过 {REF_MEDIA_MAX_SECONDS}s 的片段，点「选区存入素材库」即裁剪并自动挂为参考。
      </p>
      {error && <StatusMessage tone="danger">{error}</StatusMessage>}
    </div>
  );
}

export function RefTrimDialog({
  projectId,
  asset,
  duration,
  onDone,
  onClose,
}: {
  projectId: string;
  /** 超长的视频 / 音频素材；为 null 时不显示 */
  asset: AssetDto | null;
  duration: number;
  /** 裁剪产物（新素材）回调 */
  onDone: (a: AssetDto, durationSec: number) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={asset !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>素材超过 {REF_MEDIA_MAX_SECONDS} 秒，需要裁剪</DialogTitle>
          <DialogDescription>
            全能参考的视频 / 音频素材最长 {REF_MEDIA_MAX_SECONDS} 秒。裁剪产物会存入素材库并自动挂为参考。
          </DialogDescription>
        </DialogHeader>
        {asset?.kind === "video" && (
          <VideoTrim projectId={projectId} asset={asset} duration={duration} onDone={onDone} />
        )}
        {asset?.kind === "audio" && (
          <AudioTrim projectId={projectId} asset={asset} onDone={onDone} />
        )}
      </DialogContent>
    </Dialog>
  );
}
