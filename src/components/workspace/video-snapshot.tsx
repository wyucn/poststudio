"use client";

/**
 * 带截图能力的视频播放器：播放到任意位置点「截图」，
 * 预览当前帧后可下载或保存到项目素材库。
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Download, Save } from "lucide-react";
import { uploadAssetFile } from "@/lib/client/upload";
import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return m ? `${m}m${s}s` : `${s}s`;
}

export function SnapshotVideo({
  src,
  projectId,
  className,
  muted,
}: {
  src: string;
  projectId: string;
  className?: string;
  muted?: boolean;
}) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string; time: number } | null>(
    null
  );
  const [saved, setSaved] = useState(false);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setSaved(false);
      setShot({ blob, url: URL.createObjectURL(blob), time: video.currentTime });
    }, "image/png");
  };

  const close = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
  };

  const download = () => {
    if (!shot) return;
    const a = document.createElement("a");
    a.href = shot.url;
    a.download = `snapshot-${formatTime(shot.time)}.png`;
    a.click();
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!shot) return;
      const file = new File([shot.blob], `视频截图-${formatTime(shot.time)}.png`, {
        type: "image/png",
      });
      await uploadAssetFile({ projectId, file, allowedKinds: ["image"] });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      setSaved(true);
    },
  });

  return (
    <div className="group relative">
      <video ref={videoRef} src={src} controls muted={muted} crossOrigin="anonymous" className={className} />
      <Button
        variant="secondary"
        size="sm"
        className="absolute right-2 top-2 h-7 px-2 text-xs opacity-0 shadow transition-opacity group-hover:opacity-100"
        title="截取当前画面"
        onClick={capture}
      >
        <Camera className="size-3.5" /> 截图
      </Button>
      {shot && (
        <Dialog open onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>视频截图 · {formatTime(shot.time)}</DialogTitle>
              <DialogDescription>
                可直接下载，或保存到素材库（之后可当首帧 / 参考图使用）
              </DialogDescription>
            </DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.url}
              alt=""
              className="max-h-[60vh] w-full rounded-md border border-border object-contain"
            />
            {save.isError && (
              <StatusMessage tone="danger">{save.error.message}</StatusMessage>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={download}>
                <Download /> 下载
              </Button>
              <Button
                className="flex-1"
                onClick={() => save.mutate()}
                disabled={saved}
                loading={save.isPending}
                loadingText="保存中"
              >
                {saved ? (
                  <><CheckCircle2 /> 已存入素材库</>
                ) : (
                  <>
                    <Save /> 存入素材库
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
