"use client";

import { FileAudio, Film, X } from "lucide-react";
import { assetLabel, assetRawUrl, type AssetDto } from "@/lib/client/types";

/** 图片缩略图条（带移除按钮），用于首帧 / 尾帧 / 参考图 */
export function ThumbStrip({
  items,
  onRemove,
}: {
  items: AssetDto[];
  onRemove: (id: string) => void;
}) {
  return (
    <>
      {items.map((r) => (
        <div key={r.id} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assetRawUrl(r.id)}
            alt=""
            className="size-16 rounded-md border border-border object-cover"
          />
          <button
            className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-white cursor-pointer"
            onClick={() => onRemove(r.id)}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </>
  );
}

/** 混合类型参考素材的小卡片（图片缩略图 / 视频音频图标 + 名称） */
export function RefChip({
  asset,
  referenceName,
  onRemove,
}: {
  asset: AssetDto;
  /** Seedance 实际识别的同类型顺序名，如「视频1」。 */
  referenceName: string;
  onRemove: () => void;
}) {
  return (
    <div className="relative flex min-w-36 max-w-52 items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 pr-7">
      {asset.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assetRawUrl(asset.id)}
          alt=""
          className="size-12 shrink-0 rounded border border-border object-cover"
        />
      ) : asset.kind === "video" ? (
        <span className="relative size-12 shrink-0 overflow-hidden rounded border border-border">
          <video
            src={assetRawUrl(asset.id)}
            muted
            preload="metadata"
            className="size-full object-cover"
          />
          <Film className="absolute bottom-0.5 right-0.5 size-3 text-white drop-shadow" />
        </span>
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded border border-border bg-primary/5">
          <FileAudio className="size-4 text-primary" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block font-mono text-xs text-primary">{referenceName}</span>
        <span className="block truncate text-xs text-muted-foreground">{assetLabel(asset)}</span>
      </span>
      <button
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-destructive/80 p-0.5 text-white cursor-pointer"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
