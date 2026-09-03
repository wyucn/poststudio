"use client";

import { Copy, Download, Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  assetDownloadUrl,
  assetLabel,
  assetRawUrl,
  type TaskDto,
} from "@/lib/client/types";
import { recordTaskProductEvent } from "@/lib/client/product-events";
import { TTS_VOICES } from "@/lib/coze/plugins";

function parseTaskInput(task: TaskDto): Record<string, unknown> {
  try {
    return JSON.parse(task.inputJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resultDetail(task: TaskDto, input: Record<string, unknown>): string {
  const cloned =
    task.modelKey === "modelscope-qwen3-tts" || input.provider === "modelscope";
  if (cloned) {
    const language = input.language === "Auto" ? "自动识别" : input.language;
    const instance =
      input.instance === "self-hosted" ? "自建实例" : "公共创空间（实验）";
    return ["Qwen3-TTS 声音克隆", instance, input.modelSize, language]
      .filter(Boolean)
      .join(" · ");
  }

  const voice = TTS_VOICES.find((item) => item.id === input.voiceId)?.name;
  const speed = input.speedRatio ? `${input.speedRatio}x` : null;
  return ["豆包预设音色", voice, speed].filter(Boolean).join(" · ");
}

export function TtsInlinePlayer({
  task,
  onReuse,
}: {
  task: TaskDto;
  onReuse: (input: Record<string, unknown>) => void;
}) {
  const asset = task.outputAsset;
  if (asset?.kind !== "audio") return null;

  const input = parseTaskInput(task);
  const text = String(input.text ?? "").trim() || assetLabel(asset);

  return (
    <section
      data-tts-inline-player
      aria-label="最新配音"
      aria-live="polite"
      className="grid gap-1.5 border-b border-border/60 bg-muted/25 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Mic2 aria-hidden="true" className="size-3.5 text-primary" />
          最新配音
        </p>
        <p className="mt-0.5 truncate text-sm font-medium" title={text}>
          {text}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {resultDetail(task, input)}
        </p>
      </div>
      <div className="flex items-center gap-1 self-center sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          aria-label="复用最新配音参数"
          onClick={() => {
            void recordTaskProductEvent(task.id, "reuse");
            onReuse(input);
          }}
        >
          <Copy aria-hidden="true" className="size-3.5" /> 复用参数
        </Button>
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
          <a
            href={assetDownloadUrl(asset.id)}
            download
            aria-label="下载最新配音"
          >
            <Download aria-hidden="true" className="size-3.5" /> 下载
          </a>
        </Button>
      </div>
      <audio
        key={asset.id}
        src={assetRawUrl(asset.id)}
        aria-label="播放最新配音"
        controls
        preload="metadata"
        className="h-8 w-full min-w-0 sm:col-span-2"
      />
    </section>
  );
}
