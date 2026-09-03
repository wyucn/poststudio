"use client";

import { useState } from "react";
import { Film } from "lucide-react";
import { assetRawUrl, assetThumbnailUrl } from "@/lib/client/types";
import { cn } from "@/lib/utils";

export function VideoPoster({
  assetId,
  className = "",
  fit = "cover",
  hoverPreview = false,
  onAspectRatio,
}: {
  assetId: string;
  className?: string;
  fit?: "cover" | "contain";
  hoverPreview?: boolean;
  onAspectRatio?: (ratio: number) => void;
}) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const objectFit = fit === "contain" ? "object-contain" : "object-cover";

  return (
    <span
      className={cn("relative block overflow-hidden bg-muted", className)}
      onMouseEnter={() => hoverPreview && setPreviewing(true)}
      onMouseLeave={() => setPreviewing(false)}
    >
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 border border-foreground/10 bg-secondary text-muted-foreground">
        <Film className="size-5" />
        <span className="font-mono text-micro font-semibold">VIDEO</span>
      </span>
      {!posterFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assetThumbnailUrl(assetId)}
          alt=""
          loading="lazy"
          decoding="async"
          className={`pointer-events-none absolute inset-0 size-full ${objectFit}`}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) {
              onAspectRatio?.(image.naturalWidth / image.naturalHeight);
            }
          }}
          onError={() => setPosterFailed(true)}
        />
      )}
      {hoverPreview && previewing && (
        <video
          src={assetRawUrl(assetId)}
          muted
          autoPlay
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 size-full ${objectFit}`}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (video.videoWidth && video.videoHeight) {
              onAspectRatio?.(video.videoWidth / video.videoHeight);
            }
          }}
        />
      )}
    </span>
  );
}
