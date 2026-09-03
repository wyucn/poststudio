"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { FileAudio, Film, ImagePlus } from "lucide-react";
import { api } from "@/lib/client/api";
import {
  assetMeta,
  assetThumbnailUrl,
  type AssetDto,
  type AssetPageDto,
} from "@/lib/client/types";
import { PRESET_LABEL } from "@/lib/presets";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { UploadDropZone } from "./upload-drop-zone";
import { VideoPoster } from "./video-poster";

type PickKind = "image" | "video" | "audio";

const KIND_NAME: Record<PickKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

function AssetPreview({ asset }: { asset: AssetDto }) {
  if (asset.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={assetThumbnailUrl(asset.id)}
        alt=""
        loading="lazy"
        decoding="async"
        className="block h-auto w-full bg-muted"
      />
    );
  }

  if (asset.kind === "video") {
    return (
      <VideoPoster assetId={asset.id} className="aspect-video w-full" fit="contain" />
    );
  }

  return (
    <div className="flex h-20 w-full flex-col items-center justify-center gap-1.5 bg-muted p-2">
      <FileAudio className="size-6 text-primary" />
      <p className="line-clamp-2 text-center text-xs text-muted-foreground">
        {assetMeta(asset).prompt || assetMeta(asset).filename || "音频"}
      </p>
    </div>
  );
}

/** 从项目素材中选择，或拖拽 / 点击上传新素材（支持图片 / 视频 / 音频） */
export function AssetPicker({
  projectId,
  open,
  onOpenChange,
  onSelect,
  kinds = ["image"],
  title = "选择素材",
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: AssetDto) => void;
  /** 可选择的素材类型，默认仅图片 */
  kinds?: PickKind[];
  title?: string;
}) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<AssetPageDto>({
    queryKey: ["assets", projectId, "picker", kinds.join(",")],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        kind: kinds.join(","),
        limit: "40",
        excludeRole: "last_frame",
      });
      if (pageParam) qs.set("cursor", String(pageParam));
      return api(`/api/projects/${projectId}/assets?${qs}`);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: open,
  });
  const items = data?.pages.flatMap((page) => page.items);
  const kindNames = kinds.map((k) => KIND_NAME[k]).join(" / ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            从项目素材库选择，或拖拽 / 点击上传本地{kindNames}
          </DialogDescription>
        </DialogHeader>
        <UploadDropZone
          projectId={projectId}
          kinds={kinds}
          multiple={false}
          compact
          onUploaded={(a) => {
            onSelect(a);
            onOpenChange(false);
          }}
        />
        <div className="max-h-[min(54vh,36rem)] overflow-y-auto pr-1">
          {isLoading ? (
            <LoadingState appearance="inline" label="正在加载项目素材…" className="py-8" />
          ) : (
            <>
          <div className="columns-2 gap-2 sm:columns-4">
            {items?.map((a) => {
              const meta = assetMeta(a);
              return (
                <button
                  key={a.id}
                  type="button"
                  className="focus-ring group relative mb-2 block w-full break-inside-avoid overflow-hidden rounded-md border border-border bg-muted text-left transition-colors hover:border-primary cursor-pointer"
                  onClick={() => {
                    onSelect(a);
                    onOpenChange(false);
                  }}
                >
                  <AssetPreview asset={a} />
                  {a.kind === "video" && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/55 p-1 text-white">
                      <Film className="size-3.5" />
                    </span>
                  )}
                  {meta.preset && (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-1 text-xs text-white">
                      {PRESET_LABEL[meta.preset]}·{meta.presetName}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {!items?.length && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <ImagePlus className="size-6" />
              <p className="text-sm">项目里还没有{kindNames}素材</p>
            </div>
          )}
          {hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className="mt-2 w-full"
              onClick={() => fetchNextPage()}
              loading={isFetchingNextPage}
              loadingText="加载中"
            >
              加载更多
            </Button>
          )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
