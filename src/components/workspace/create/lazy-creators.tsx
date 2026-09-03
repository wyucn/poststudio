"use client";

import dynamic from "next/dynamic";
import { LoadingState } from "@/components/ui/loading-state";

function CreatorPanelLoading({ label }: { label: string }) {
  return (
    <div
      className="flex h-full min-h-0 items-center justify-center bg-background px-6"
      data-creator-panel-loading={label}
    >
      <LoadingState label={`正在加载${label}创作器…`} />
    </div>
  );
}

export const ImagePanel = dynamic(
  () => import("./image-creator").then((module) => module.ImagePanel),
  {
    ssr: false,
    loading: () => <CreatorPanelLoading label="图像" />,
  }
);

export const VideoPanel = dynamic(
  () => import("./video-creator").then((module) => module.VideoPanel),
  {
    ssr: false,
    loading: () => <CreatorPanelLoading label="视频" />,
  }
);

export const MusicPanel = dynamic(
  () => import("./music-creator").then((module) => module.MusicPanel),
  {
    ssr: false,
    loading: () => <CreatorPanelLoading label="音乐" />,
  }
);

export const TtsPanel = dynamic(
  () => import("./tts-creator").then((module) => module.TtsPanel),
  {
    ssr: false,
    loading: () => <CreatorPanelLoading label="配音" />,
  }
);

export const FormulaPanel = dynamic(
  () => import("./formula-creator").then((module) => module.FormulaPanel),
  {
    ssr: false,
    loading: () => <CreatorPanelLoading label="公式" />,
  }
);
