"use client";

/**
 * 音频波形播放器：波形图 + 预置入/出点手柄 + 选区试听 / 片段下载（WAV）/ 片段存入素材库。
 * 交互参考网易云音乐铃声制作：波形加载后自动给出选区，拖动两端手柄调整入点/出点，
 * 拖动选区中部整体平移；点击波形空白处定位播放头。
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Download, Pause, Play, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusMessage } from "@/components/ui/status-message";

interface Selection {
  start: number;
  end: number;
}

type DragMode = "start" | "end" | "move";

/** 解码后的音频数据缓存（按 URL） */
const bufferCache = new Map<string, AudioBuffer>();

export async function decodeAudio(src: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(src);
  if (cached) return cached;
  const res = await fetch(src);
  if (!res.ok) throw new Error("音频加载失败");
  const arr = await res.arrayBuffer();
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    const buffer = await ctx.decodeAudioData(arr);
    if (bufferCache.size > 20) bufferCache.clear();
    bufferCache.set(src, buffer);
    return buffer;
  } finally {
    void ctx.close();
  }
}

/** AudioBuffer 选区 → 16bit PCM WAV Blob */
export function bufferToWav(buffer: AudioBuffer, start: number, end: number): Blob {
  const rate = buffer.sampleRate;
  const channels = Math.min(buffer.numberOfChannels, 2);
  const s = Math.max(0, Math.floor(start * rate));
  const e = Math.min(buffer.length, Math.ceil(end * rate));
  const frames = Math.max(0, e - s);
  const dataSize = frames * channels * 2;
  const out = new DataView(new ArrayBuffer(44 + dataSize));

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) out.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  out.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, channels, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * channels * 2, true);
  out.setUint16(32, channels * 2, true);
  out.setUint16(34, 16, true);
  writeStr(36, "data");
  out.setUint32(40, dataSize, true);

  let offset = 44;
  const chans = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = s; i < e; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

function fmtTime(sec: number): string {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

const HANDLE_HIT_PX = 10;

type AudioWaveProps = {
  src: string;
  filename?: string;
  /** 提供时显示「选区存入素材库」按钮 */
  onSaveClip?: (blob: Blob, durationSec: number) => void;
  saving?: boolean;
  /** 初始选区的最大长度（秒），如全能参考裁剪场景为 15 */
  maxSelection?: number;
};

function AudioWaveInstance({
  src,
  filename = "audio-clip",
  onSaveClip,
  saving,
  maxSelection,
}: AudioWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const selectionStartId = useId();
  const selectionEndId = useId();
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Selection | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [hoverCursor, setHoverCursor] = useState("pointer");
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ mode: DragMode; grabOffset: number } | null>(null);
  const playStopAtRef = useRef<number | null>(null);

  const defaultSelection = useCallback(
    (dur: number): Selection => ({
      start: 0,
      end: maxSelection ? Math.min(dur, maxSelection) : dur,
    }),
    [maxSelection]
  );

  useEffect(() => {
    let alive = true;
    decodeAudio(src)
      .then((b) => {
        if (!alive) return;
        setBuffer(b);
        setSel(defaultSelection(b.duration));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [src, defaultSelection]);

  const duration = buffer?.duration ?? 0;

  // 绘制波形 + 选区（含手柄）+ 播放头
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);

    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / W));
    ctx.fillStyle = "rgba(40,48,40,0.45)";
    for (let x = 0; x < W; x++) {
      let max = 0;
      const base = x * step;
      for (let i = 0; i < step; i += 4) {
        const v = Math.abs(data[base + i] ?? 0);
        if (v > max) max = v;
      }
      const h = Math.max(1, max * H * 0.88);
      ctx.fillRect(x, (H - h) / 2, 1, h);
    }

    if (sel) {
      const x1 = (sel.start / duration) * W;
      const x2 = (sel.end / duration) * W;
      // 选区外压暗
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(0, 0, x1, H);
      ctx.fillRect(x2, 0, W - x2, H);
      // 选区内高亮
      ctx.fillStyle = "rgba(198,242,57,0.28)";
      ctx.fillRect(x1, 0, x2 - x1, H);
      // 入/出点手柄：竖线 + 顶部抓手
      ctx.fillStyle = "#161916";
      for (const x of [x1, x2]) {
        ctx.fillRect(x - 1, 0, 2.5, H);
        ctx.beginPath();
        ctx.roundRect(x - 5, 0, 11, 18, 4);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(198,242,57,0.95)";
      ctx.lineWidth = 1.5;
      for (const x of [x1, x2]) {
        ctx.beginPath();
        ctx.moveTo(x + 0.25, 4);
        ctx.lineTo(x + 0.25, 14);
        ctx.stroke();
      }
    }

    if (duration > 0) {
      const px = (pos / duration) * W;
      ctx.fillStyle = "rgba(20,24,20,0.9)";
      ctx.fillRect(px, 0, 1.5, H);
    }
  }, [buffer, sel, pos, duration]);

  useEffect(() => {
    draw();
  }, [draw]);

  const timeAt = (clientX: number): number => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  /** 命中检测：入点手柄 / 出点手柄 / 选区内部 / 选区外 */
  const hitTest = (clientX: number): DragMode | null => {
    if (!sel || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const x1 = (sel.start / duration) * rect.width;
    const x2 = (sel.end / duration) * rect.width;
    if (Math.abs(x - x1) <= HANDLE_HIT_PX) return "start";
    if (Math.abs(x - x2) <= HANDLE_HIT_PX) return "end";
    if (x > x1 && x < x2) return "move";
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!buffer || !sel) return;
    const mode = hitTest(e.clientX);
    if (mode) {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { mode, grabOffset: timeAt(e.clientX) - sel.start };
      setDragging(true);
    } else {
      // 选区外点击：定位播放头
      const t = timeAt(e.clientX);
      const audio = audioRef.current;
      if (audio) audio.currentTime = t;
      setPos(t);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!buffer || !sel) return;
    const drag = dragRef.current;
    if (!drag) {
      const mode = hitTest(e.clientX);
      setHoverCursor(mode === "move" ? "grab" : mode ? "ew-resize" : "pointer");
      return;
    }
    const t = timeAt(e.clientX);
    const MIN = Math.min(0.2, duration);
    if (drag.mode === "start") {
      setSel({ start: Math.min(t, sel.end - MIN), end: sel.end });
    } else if (drag.mode === "end") {
      setSel({ start: sel.start, end: Math.max(t, sel.start + MIN) });
    } else {
      const len = sel.end - sel.start;
      let start = t - drag.grabOffset;
      start = Math.max(0, Math.min(start, duration - len));
      setSel({ start, end: start + len });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const togglePlay = (range?: Selection) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (range) {
      audio.currentTime = range.start;
      playStopAtRef.current = range.end;
    } else {
      playStopAtRef.current = null;
    }
    void audio.play().catch(() => setPlaying(false));
  };

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setPos(audio.currentTime);
    const stopAt = playStopAtRef.current;
    if (stopAt !== null && audio.currentTime >= stopAt) {
      audio.pause();
      playStopAtRef.current = null;
    }
  };

  const clipBlob = (): Blob | null =>
    buffer && sel ? bufferToWav(buffer, sel.start, sel.end) : null;

  const downloadClip = () => {
    const blob = clipBlob();
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}-${fmtTime(sel!.start)}-${fmtTime(sel!.end)}.wav`.replace(/:/g, ".");
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <StatusMessage tone="danger" appearance="inline">{error}</StatusMessage>;

  const isFullSelection = !!sel && sel.start <= 0.01 && sel.end >= duration - 0.01;
  const minimumSelection = Math.min(0.2, duration);

  function updateSelectionStart(rawValue: string) {
    if (!sel) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const minimum = maxSelection ? Math.max(0, sel.end - maxSelection) : 0;
    const maximum = Math.max(minimum, sel.end - minimumSelection);
    setSel({ start: Math.max(minimum, Math.min(value, maximum)), end: sel.end });
  }

  function updateSelectionEnd(rawValue: string) {
    if (!sel) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const minimum = Math.min(duration, sel.start + minimumSelection);
    const maximum = maxSelection
      ? Math.min(duration, sel.start + maxSelection)
      : duration;
    setSel({ start: sel.start, end: Math.max(minimum, Math.min(value, maximum)) });
  }

  return (
    <div className="space-y-2">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <canvas
        ref={canvasRef}
        width={800}
        height={96}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        style={{ cursor: dragging ? "grabbing" : hoverCursor }}
        className="h-24 w-full touch-none rounded-md border border-border bg-muted/40"
      />
      {!buffer && <LoadingState appearance="inline" label="正在解析波形…" className="justify-start" />}
      {sel && (
        <div className="grid max-w-sm grid-cols-2 gap-2" aria-label="音频选区键盘调整">
          <div className="space-y-1">
            <Label htmlFor={selectionStartId}>入点（秒）</Label>
            <Input
              id={selectionStartId}
              type="number"
              min={maxSelection ? Math.max(0, sel.end - maxSelection) : 0}
              max={Math.max(0, sel.end - minimumSelection)}
              step={0.1}
              value={Math.round(sel.start * 10) / 10}
              onChange={(event) => updateSelectionStart(event.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={selectionEndId}>出点（秒）</Label>
            <Input
              id={selectionEndId}
              type="number"
              min={Math.min(duration, sel.start + minimumSelection)}
              max={maxSelection ? Math.min(duration, sel.start + maxSelection) : duration}
              step={0.1}
              value={Math.round(sel.end * 10) / 10}
              onChange={(event) => updateSelectionEnd(event.target.value)}
              className="h-9"
            />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => togglePlay()} disabled={!buffer}>
          {playing ? <Pause /> : <Play />}
          {playing ? "暂停" : "播放"}
        </Button>
        <span className="font-mono text-xs text-muted-foreground">
          {fmtTime(pos)} / {fmtTime(duration)}
        </span>
        {sel && (
          <>
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="font-mono text-xs text-info"
            >
              {fmtTime(sel.start)} → {fmtTime(sel.end)}（{(sel.end - sel.start).toFixed(1)}s）
            </span>
            <Button variant="outline" size="sm" onClick={() => togglePlay(sel)}>
              <Play /> 试听选区
            </Button>
            <Button variant="outline" size="sm" onClick={downloadClip}>
              <Download /> 下载选区
            </Button>
            {onSaveClip && (
              <Button
                variant="outline"
                size="sm"
                loading={saving}
                loadingText="保存中"
                onClick={() => {
                  const blob = clipBlob();
                  if (blob) onSaveClip(blob, sel.end - sel.start);
                }}
              >
                <Save /> 选区存入素材库
              </Button>
            )}
            {!isFullSelection && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSel(defaultSelection(duration))}
              >
                <RotateCcw /> 重置选区
              </Button>
            )}
          </>
        )}
      </div>
      {sel && (
        <p className="text-xs text-muted-foreground/80">
          拖动两端黑色手柄或使用入点 / 出点输入框调整选区；拖动选区中部整体平移，点击选区外定位播放头。
        </p>
      )}
    </div>
  );
}

/**
 * A source change represents a different editing session. Remounting the
 * instance resets decoded audio, selection and playback state without a
 * synchronous state-reset effect.
 */
export function AudioWave(props: AudioWaveProps) {
  return (
    <AudioWaveInstance
      key={`${props.src}:${props.maxSelection ?? "full"}`}
      {...props}
    />
  );
}
