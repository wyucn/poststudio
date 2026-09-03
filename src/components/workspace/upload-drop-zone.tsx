"use client";

/**
 * 拖拽上传区：把本地文件拖进来（或点击选择）即上传到项目素材库。
 * 支持多文件依次上传，显示进度与失败原因。
 */
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Loader2, UploadCloud } from "lucide-react";
import type { AssetDto } from "@/lib/client/types";
import { uploadAssetFile } from "@/lib/client/upload";
import {
  ASSET_UPLOAD_MAX_BYTES,
  type UploadMediaKind,
  UPLOAD_ACCEPT_BY_KIND,
  validateUploadCandidate,
} from "@/lib/media-policy";
import { cn } from "@/lib/utils";
import { SPRING_BOUNCE, SPRING_UI } from "@/lib/motion";
import { StatusMessage } from "@/components/ui/status-message";

type PickKind = UploadMediaKind;

const KIND_NAME: Record<PickKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

export function UploadDropZone({
  projectId,
  kinds = ["image", "video", "audio"],
  multiple = true,
  compact = false,
  maxFileSizeMb,
  onUploaded,
  className,
}: {
  projectId: string;
  /** 允许的素材类型 */
  kinds?: PickKind[];
  /** 是否允许一次拖入多个文件 */
  multiple?: boolean;
  /** 紧凑样式（用于对话框内） */
  compact?: boolean;
  /** 覆盖当前使用场景的单文件大小限制 */
  maxFileSizeMb?: number;
  /** 每个文件上传成功后回调 */
  onUploaded?: (asset: AssetDto) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  /* 图标朝指针方向的微位移(§8「hint in the direction of the gesture」) */
  const [hint, setHint] = useState({ x: 0, y: 0 });
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    fileName: string;
    percent: number;
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const accept = kinds.map((k) => UPLOAD_ACCEPT_BY_KIND[k]).join(",");
  const kindNames = kinds.map((k) => KIND_NAME[k]).join(" / ");

  async function uploadFiles(fileList: FileList | File[]) {
    let files = Array.from(fileList);
    if (!files.length) return;
    if (!multiple) files = files.slice(0, 1);
    setErrors([]);
    setProgress({ done: 0, total: files.length, fileName: files[0].name, percent: 0 });

    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      try {
        validateUploadCandidate(file, kinds, maxFileSizeMb);
        const data = await uploadAssetFile({
          projectId,
          file,
          allowedKinds: kinds,
          maxFileSizeMb,
          onProgress: ({ percent }) =>
            setProgress({ done: i, total: files.length, fileName: file.name, percent }),
        });
        onUploaded?.(data);
      } catch (e) {
        failed.push(`${file.name}：${e instanceof Error ? e.message : "上传失败"}`);
      }
      setProgress({
        done: i + 1,
        total: files.length,
        fileName: files[i + 1]?.name ?? file.name,
        percent: i + 1 === files.length ? 100 : 0,
      });
    }
    qc.invalidateQueries({ queryKey: ["assets", projectId] });
    setProgress(null);
    setErrors(failed);
  }

  const busy = progress !== null;

  return (
    <div className={className}>
      <input
        ref={fileRef}
        type="file"
        aria-label="选择上传文件"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <motion.div
        ref={zoneRef}
        role="button"
        tabIndex={0}
        aria-label="上传素材"
        aria-disabled={busy}
        onClick={() => !busy && fileRef.current?.click()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !busy) {
            event.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
          /* 用指针相对中心的偏移驱动图标朝手指方向轻移 */
          const r = zoneRef.current?.getBoundingClientRect();
          if (r) {
            const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
            const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
            setHint({ x: dx * 6, y: dy * 6 });
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
          setHint({ x: 0, y: 0 });
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          setHint({ x: 0, y: 0 });
          if (!busy && e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
        }}
        /* 拖入时轻微放大(带回弹,因为是「接住」动量的语义,§9) */
        animate={{ scale: dragOver ? 1.02 : 1 }}
        transition={dragOver ? SPRING_BOUNCE : SPRING_UI}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed transition-colors",
          compact ? "px-4 py-4" : "px-6 py-7",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50",
          busy && "pointer-events-none opacity-70"
        )}
        aria-busy={busy}
      >
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin text-info motion-reduce:animate-none" />
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="max-w-full truncate px-2 text-sm text-muted-foreground"
            >
              上传中 {Math.min(progress.done + 1, progress.total)}/{progress.total} · {progress.fileName} · {progress.percent}%
            </p>
            <div
              className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-info-muted"
              role="progressbar"
              aria-label={`上传 ${progress.fileName}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
            >
              <motion.div
                className="h-full rounded-full bg-info"
                animate={{ width: `${progress.percent}%` }}
                transition={SPRING_UI}
              />
            </div>
          </>
        ) : (
          <>
            <motion.div
              animate={{ x: hint.x, y: dragOver ? hint.y - 2 : 0 }}
              transition={SPRING_UI}
            >
              <UploadCloud
                className={cn("text-primary", compact ? "size-5" : "size-6")}
              />
            </motion.div>
            <p className="text-sm font-medium">
              {dragOver ? "松开即上传" : `拖拽${kindNames}到这里，或点击选择文件`}
            </p>
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {multiple ? "支持多文件 · " : ""}
              {kinds
                .map(
                  (k) =>
                    `${KIND_NAME[k]} ≤${maxFileSizeMb ?? Math.round(ASSET_UPLOAD_MAX_BYTES[k] / 1024 / 1024)}MB`
                )
                .join(" · ")}
            </p>
          </>
        )}
      </motion.div>
      {errors.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {errors.map((e, i) => (
            <StatusMessage key={i} tone="danger" appearance="inline">
              {e}
            </StatusMessage>
          ))}
        </div>
      )}
    </div>
  );
}
