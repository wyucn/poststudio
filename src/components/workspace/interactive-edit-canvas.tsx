"use client";

/**
 * Seedream 5.0 Pro 交互编辑画布。
 * 在中央舞台上对单张参考图进行移动、点选和框选，坐标归一化为 0-999。
 * 标记由父组件持有，并通过同一 id 与提示词中的不可编辑芯片保持同步。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Hand,
  LocateFixed,
  Scan,
  Square,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { AssetDto } from "@/lib/client/types";
import { assetThumbnailUrl } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { SelectionIndicator } from "@/components/ui/selection-indicator";

type Mode = "move" | "point" | "box";
type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export interface Overlay {
  /** 与编辑框芯片共享的标记 id */
  id: number;
  imageId: string;
  type: Exclude<Mode, "move">;
  /** 归一化 0-999（相对该图） */
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  label: string;
  token: string;
}

interface CanvasView {
  zoom: number;
  panX: number;
  panY: number;
}

type Gesture =
  | {
      kind: "pan";
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      kind: "box";
      imageId: string;
      x: number;
      y: number;
      cx: number;
      cy: number;
    }
  | {
      kind: "move-mark";
      markId: number;
      startX: number;
      startY: number;
      cx: number;
      cy: number;
      origin: Overlay;
    }
  | {
      kind: "resize-mark";
      markId: number;
      handle: ResizeHandle;
      cx: number;
      cy: number;
      origin: Overlay;
    };

const DEFAULT_VIEW: CanvasView = { zoom: 1, panX: 0, panY: 0 };
const MIN_BOX_SIZE = 16;
const RESIZE_HANDLES: ResizeHandle[] = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
];

function clamp999(v: number): number {
  return Math.max(0, Math.min(999, Math.round(v)));
}

function clampZoom(v: number): number {
  return Math.max(0.5, Math.min(3, Math.round(v * 10) / 10));
}

export function moveOverlay(
  overlay: Overlay,
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): Overlay {
  const dx = currentX - startX;
  const dy = currentY - startY;
  if (overlay.type === "point") {
    return {
      ...overlay,
      x1: clamp999(overlay.x1 + dx),
      y1: clamp999(overlay.y1 + dy),
    };
  }
  const x2 = overlay.x2 ?? overlay.x1;
  const y2 = overlay.y2 ?? overlay.y1;
  const boundedDx = Math.max(-overlay.x1, Math.min(999 - x2, dx));
  const boundedDy = Math.max(-overlay.y1, Math.min(999 - y2, dy));
  return {
    ...overlay,
    x1: clamp999(overlay.x1 + boundedDx),
    y1: clamp999(overlay.y1 + boundedDy),
    x2: clamp999(x2 + boundedDx),
    y2: clamp999(y2 + boundedDy),
  };
}

export function resizeOverlay(
  overlay: Overlay,
  handle: ResizeHandle,
  currentX: number,
  currentY: number
): Overlay {
  if (overlay.type !== "box") return overlay;
  let x1 = overlay.x1;
  let y1 = overlay.y1;
  let x2 = overlay.x2 ?? overlay.x1 + MIN_BOX_SIZE;
  let y2 = overlay.y2 ?? overlay.y1 + MIN_BOX_SIZE;
  if (handle.includes("w")) x1 = Math.min(clamp999(currentX), x2 - MIN_BOX_SIZE);
  if (handle.includes("e")) x2 = Math.max(clamp999(currentX), x1 + MIN_BOX_SIZE);
  if (handle.includes("n")) y1 = Math.min(clamp999(currentY), y2 - MIN_BOX_SIZE);
  if (handle.includes("s")) y2 = Math.max(clamp999(currentY), y1 + MIN_BOX_SIZE);
  return {
    ...overlay,
    x1: clamp999(x1),
    y1: clamp999(y1),
    x2: clamp999(x2),
    y2: clamp999(y2),
  };
}

export function keyboardDelta(
  key: string,
  accelerated: boolean
): { dx: number; dy: number } | null {
  const step = accelerated ? 25 : 5;
  if (key === "ArrowLeft") return { dx: -step, dy: 0 };
  if (key === "ArrowRight") return { dx: step, dy: 0 };
  if (key === "ArrowUp") return { dx: 0, dy: -step };
  if (key === "ArrowDown") return { dx: 0, dy: step };
  return null;
}

export function InteractiveEditCanvas({
  assets,
  overlays,
  activeAssetId,
  selectedMarkId,
  onActiveAssetChange,
  onSelectMark,
  onAddMark,
  onUpdateMark,
  onRemoveMark,
}: {
  /** 参考图（按顺序对应 图1、图2…） */
  assets: AssetDto[];
  /** 受控标记（由父组件持有，芯片删除时同步过滤） */
  overlays: Overlay[];
  activeAssetId: string | null;
  selectedMarkId: number | null;
  onActiveAssetChange: (assetId: string) => void;
  onSelectMark: (markId: number | null) => void;
  onAddMark: (overlay: Overlay, asset: AssetDto) => void;
  onUpdateMark: (overlay: Overlay) => void;
  onRemoveMark: (markId: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("box");
  const [views, setViews] = useState<Record<string, CanvasView>>({});
  const [naturalSizes, setNaturalSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  const activeIndex = Math.max(
    0,
    assets.findIndex((asset) => asset.id === activeAssetId)
  );
  const activeAsset = assets[activeIndex] ?? assets[0];
  const view = activeAsset ? views[activeAsset.id] ?? DEFAULT_VIEW : DEFAULT_VIEW;
  const activeOverlays = activeAsset
    ? overlays.filter((overlay) => overlay.imageId === activeAsset.id)
    : [];
  const lastOverlay = overlays.at(-1);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () =>
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    nextId.current = Math.max(
      nextId.current,
      overlays.reduce((max, overlay) => Math.max(max, overlay.id + 1), 1)
    );
  }, [overlays]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMode("move");
      setGesture(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const fittedSize = useMemo(() => {
    if (!activeAsset) return { width: 0, height: 0 };
    const natural = naturalSizes[activeAsset.id];
    if (!natural || viewportSize.width === 0 || viewportSize.height === 0) {
      return { width: 0, height: 0 };
    }
    const availableWidth = Math.max(180, viewportSize.width - 72);
    const availableHeight = Math.max(160, viewportSize.height - 136);
    const scale = Math.min(
      availableWidth / natural.width,
      availableHeight / natural.height
    );
    return {
      width: Math.max(1, natural.width * scale),
      height: Math.max(1, natural.height * scale),
    };
  }, [activeAsset, naturalSizes, viewportSize]);

  function updateView(patch: Partial<CanvasView>) {
    if (!activeAsset) return;
    setViews((current) => ({
      ...current,
      [activeAsset.id]: {
        ...(current[activeAsset.id] ?? DEFAULT_VIEW),
        ...patch,
      },
    }));
  }

  function resetView() {
    if (!activeAsset) return;
    setViews((current) => ({ ...current, [activeAsset.id]: DEFAULT_VIEW }));
  }

  function selectAsset(assetId: string) {
    setGesture(null);
    onSelectMark(null);
    onActiveAssetChange(assetId);
  }

  function imgLabel(index: number): string {
    return `图${index + 1}`;
  }

  function toNorm(clientX: number, clientY: number) {
    const frame = frameRef.current;
    if (!frame) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    return {
      x: clamp999(((clientX - rect.left) / rect.width) * 1000),
      y: clamp999(((clientY - rect.top) / rect.height) * 1000),
    };
  }

  function addPointAt(x: number, y: number) {
    if (!activeAsset) return;
    const id = nextId.current++;
    const imageLabel = imgLabel(activeIndex);
    const overlay: Overlay = {
      id,
      imageId: activeAsset.id,
      type: "point",
      x1: clamp999(x),
      y1: clamp999(y),
      label: `${imageLabel} 点选 #${id}`,
      token: `${imageLabel}<point>${clamp999(x)} ${clamp999(y)}</point>`,
    };
    onAddMark(overlay, activeAsset);
    onSelectMark(id);
  }

  function addPoint(clientX: number, clientY: number) {
    const point = toNorm(clientX, clientY);
    addPointAt(point.x, point.y);
  }

  function addBox(x1: number, y1: number, x2: number, y2: number) {
    if (!activeAsset) return;
    const id = nextId.current++;
    const lo = { x: Math.min(x1, x2), y: Math.min(y1, y2) };
    const hi = { x: Math.max(x1, x2), y: Math.max(y1, y2) };
    const imageLabel = imgLabel(activeIndex);
    const overlay: Overlay = {
      id,
      imageId: activeAsset.id,
      type: "box",
      x1: lo.x,
      y1: lo.y,
      x2: hi.x,
      y2: hi.y,
      label: `${imageLabel} 框选 #${id}`,
      token: `${imageLabel}<bbox>${lo.x} ${lo.y} ${hi.x} ${hi.y}</bbox>`,
    };
    onAddMark(overlay, activeAsset);
    onSelectMark(id);
  }

  function withUpdatedToken(overlay: Overlay): Overlay {
    const index = Math.max(
      0,
      assets.findIndex((asset) => asset.id === overlay.imageId)
    );
    const imageLabel = imgLabel(index);
    return {
      ...overlay,
      token:
        overlay.type === "point"
          ? `${imageLabel}<point>${overlay.x1} ${overlay.y1}</point>`
          : `${imageLabel}<bbox>${overlay.x1} ${overlay.y1} ${overlay.x2} ${overlay.y2}</bbox>`,
    };
  }

  function editedOverlay(mark: Overlay): Overlay {
    if (gesture?.kind === "move-mark" && gesture.markId === mark.id) {
      return moveOverlay(
        gesture.origin,
        gesture.startX,
        gesture.startY,
        gesture.cx,
        gesture.cy
      );
    }
    if (gesture?.kind === "resize-mark" && gesture.markId === mark.id) {
      return resizeOverlay(
        gesture.origin,
        gesture.handle,
        gesture.cx,
        gesture.cy
      );
    }
    return mark;
  }

  function onMarkPointerDown(
    mark: Overlay,
    event: React.PointerEvent<HTMLElement>
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = toNorm(event.clientX, event.clientY);
    onSelectMark(mark.id);
    setGesture({
      kind: "move-mark",
      markId: mark.id,
      startX: point.x,
      startY: point.y,
      cx: point.x,
      cy: point.y,
      origin: mark,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onResizePointerDown(
    mark: Overlay,
    handle: ResizeHandle,
    event: React.PointerEvent<HTMLElement>
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = toNorm(event.clientX, event.clientY);
    onSelectMark(mark.id);
    setGesture({
      kind: "resize-mark",
      markId: mark.id,
      handle,
      cx: point.x,
      cy: point.y,
      origin: mark,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onMarkKeyDown(mark: Overlay, event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectMark(mark.id);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemoveMark(mark.id);
      return;
    }
    const delta = keyboardDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    onSelectMark(mark.id);
    onUpdateMark(
      withUpdatedToken(moveOverlay(mark, 0, 0, delta.dx, delta.dy))
    );
  }

  function onResizeKeyDown(
    mark: Overlay,
    handle: ResizeHandle,
    event: React.KeyboardEvent<HTMLElement>
  ) {
    const delta = keyboardDelta(event.key, event.shiftKey);
    if (!delta || mark.type !== "box") return;
    event.preventDefault();
    event.stopPropagation();
    const currentX = handle.includes("w")
      ? mark.x1 + delta.dx
      : handle.includes("e")
        ? (mark.x2 ?? mark.x1 + MIN_BOX_SIZE) + delta.dx
        : mark.x1;
    const currentY = handle.includes("n")
      ? mark.y1 + delta.dy
      : handle.includes("s")
        ? (mark.y2 ?? mark.y1 + MIN_BOX_SIZE) + delta.dy
        : mark.y1;
    onSelectMark(mark.id);
    onUpdateMark(withUpdatedToken(resizeOverlay(mark, handle, currentX, currentY)));
  }

  function addCenteredMark() {
    if (mode === "point") addPointAt(500, 500);
    if (mode === "box") addBox(350, 350, 650, 650);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeAsset || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "move") {
      onSelectMark(null);
      setGesture({
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        originX: view.panX,
        originY: view.panY,
      });
      return;
    }
    if (mode === "point") {
      addPoint(event.clientX, event.clientY);
      return;
    }
    const point = toNorm(event.clientX, event.clientY);
    setGesture({
      kind: "box",
      imageId: activeAsset.id,
      x: point.x,
      y: point.y,
      cx: point.x,
      cy: point.y,
    });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!gesture || !activeAsset) return;
    if (gesture.kind === "pan") {
      updateView({
        panX: gesture.originX + event.clientX - gesture.startX,
        panY: gesture.originY + event.clientY - gesture.startY,
      });
      return;
    }
    if (
      gesture.kind === "move-mark" ||
      gesture.kind === "resize-mark"
    ) {
      const point = toNorm(event.clientX, event.clientY);
      setGesture({ ...gesture, cx: point.x, cy: point.y });
      return;
    }
    if (gesture.imageId !== activeAsset.id) return;
    const point = toNorm(event.clientX, event.clientY);
    setGesture({ ...gesture, cx: point.x, cy: point.y });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (
      gesture?.kind === "box" &&
      (Math.abs(gesture.cx - gesture.x) > 8 ||
        Math.abs(gesture.cy - gesture.y) > 8)
    ) {
      addBox(gesture.x, gesture.y, gesture.cx, gesture.cy);
    } else if (
      gesture?.kind === "move-mark" ||
      gesture?.kind === "resize-mark"
    ) {
      onUpdateMark(withUpdatedToken(editedOverlay(gesture.origin)));
    }
    setGesture(null);
  }

  if (!activeAsset) return null;

  const cursorClass =
    mode === "move"
      ? gesture?.kind === "pan"
        ? "cursor-grabbing"
        : "cursor-grab"
      : mode === "point"
        ? "cursor-cell"
        : "cursor-crosshair";

  return (
    <div className="interactive-edit-canvas">
      <div className="interactive-edit-toolbar" role="toolbar" aria-label="画布工具">
        <div className="interactive-edit-mode-group">
          <Button
            type="button"
            size="sm"
            variant={mode === "move" ? "default" : "ghost"}
            className="relative"
            onClick={() => setMode("move")}
            aria-pressed={mode === "move"}
            title="移动画布（Esc）"
          >
            <SelectionIndicator
              selected={mode === "move"}
              className="interactive-edit-mode-selection"
            />
            <Hand /> 移动
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "point" ? "default" : "ghost"}
            className="relative"
            onClick={() => setMode("point")}
            aria-pressed={mode === "point"}
            title="点选目标"
          >
            <SelectionIndicator
              selected={mode === "point"}
              className="interactive-edit-mode-selection"
            />
            <LocateFixed /> 点选
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "box" ? "default" : "ghost"}
            className="relative"
            onClick={() => setMode("box")}
            aria-pressed={mode === "box"}
            title="框选目标"
          >
            <SelectionIndicator
              selected={mode === "box"}
              className="interactive-edit-mode-selection"
            />
            <Square /> 框选
          </Button>
        </div>
        {mode !== "move" && (
          <Button type="button" size="sm" variant="outline" onClick={addCenteredMark}>
            {mode === "point" ? <LocateFixed /> : <Square />}
            居中添加
          </Button>
        )}
        <span className="interactive-edit-toolbar-divider" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={!lastOverlay}
          onClick={() => lastOverlay && onRemoveMark(lastOverlay.id)}
          title="撤销上一个标记"
          aria-label="撤销上一个标记"
        >
          <Undo2 />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => updateView({ zoom: clampZoom(view.zoom - 0.2) })}
          title="缩小"
          aria-label="缩小"
        >
          <ZoomOut />
        </Button>
        <span className="interactive-edit-zoom">{Math.round(view.zoom * 100)}%</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => updateView({ zoom: clampZoom(view.zoom + 0.2) })}
          title="放大"
          aria-label="放大"
        >
          <ZoomIn />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={resetView}
          title="适合画布"
          aria-label="适合画布"
        >
          <Scan />
        </Button>
      </div>

      <div
        ref={viewportRef}
        className="interactive-edit-viewport"
        onWheel={(event) => {
          event.preventDefault();
          updateView({
            zoom: clampZoom(view.zoom + (event.deltaY > 0 ? -0.1 : 0.1)),
          });
        }}
      >
        <p id="interactive-edit-keyboard-help" className="sr-only">
          标记获得焦点后可用方向键移动，按住 Shift 加速；Delete 删除。框选手柄可用方向键调整尺寸。
        </p>
        <div className="interactive-edit-canvas-label">
          <span>{imgLabel(activeIndex)}</span>
          <b>{activeOverlays.length} 个标记</b>
        </div>

        <div className="interactive-edit-artboard">
          <div
            ref={frameRef}
            className={`interactive-edit-frame ${cursorClass}`}
            style={{
              width: fittedSize.width || 1,
              height: fittedSize.height || 1,
              opacity: fittedSize.width ? 1 : 0,
              transform: `translate3d(${view.panX}px, ${view.panY}px, 0) scale(${view.zoom})`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setGesture(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={activeAsset.id}
              src={`/api/assets/${activeAsset.id}/raw`}
              alt={`${imgLabel(activeIndex)} 待编辑参考图`}
              className="interactive-edit-image"
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget;
                setNaturalSizes((current) => ({
                  ...current,
                  [activeAsset.id]: {
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  },
                }));
              }}
            />

            {activeOverlays.map((mark) => {
              const displayMark = editedOverlay(mark);
              const number = overlays.findIndex((item) => item.id === mark.id) + 1;
              const selected = selectedMarkId === mark.id;
              const editable = selected || mode === "move";
              if (displayMark.type === "point") {
                return (
                  <span
                    key={mark.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`移动${mark.label}`}
                    aria-describedby="interactive-edit-keyboard-help"
                    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Delete"
                    className={`focus-ring interactive-edit-point ${
                      selected ? "is-selected" : ""
                    } ${editable ? "is-editable" : ""}`}
                    style={{
                      left: `${displayMark.x1 / 10}%`,
                      top: `${displayMark.y1 / 10}%`,
                    }}
                    onPointerDown={(event) => onMarkPointerDown(mark, event)}
                    onKeyDown={(event) => onMarkKeyDown(mark, event)}
                  >
                    {number}
                    {selected && (
                      <span className="interactive-edit-selection-badge" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </span>
                );
              }
              return (
                <span
                  key={mark.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`移动或调整${mark.label}`}
                  aria-describedby="interactive-edit-keyboard-help"
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Delete"
                  className={`focus-ring interactive-edit-box ${
                    selected ? "is-selected" : ""
                  } ${editable ? "is-editable" : ""}`}
                  style={{
                    left: `${displayMark.x1 / 10}%`,
                    top: `${displayMark.y1 / 10}%`,
                    width: `${(displayMark.x2! - displayMark.x1) / 10}%`,
                    height: `${(displayMark.y2! - displayMark.y1) / 10}%`,
                  }}
                  onPointerDown={(event) => onMarkPointerDown(mark, event)}
                  onKeyDown={(event) => onMarkKeyDown(mark, event)}
                >
                  <b>{number}</b>
                  {selected && (
                    <span className="interactive-edit-selection-badge" aria-hidden="true">
                      ✓
                    </span>
                  )}
                  {selected &&
                    RESIZE_HANDLES.map((handle) => (
                      <span
                        key={handle}
                        className={`focus-ring interactive-edit-resize-handle is-${handle}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`调整${mark.label}${handle}方向尺寸`}
                        aria-describedby="interactive-edit-keyboard-help"
                        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                        onPointerDown={(event) =>
                          onResizePointerDown(mark, handle, event)
                        }
                        onKeyDown={(event) => onResizeKeyDown(mark, handle, event)}
                      />
                    ))}
                </span>
              );
            })}

            {gesture?.kind === "box" &&
              gesture.imageId === activeAsset.id &&
              Math.abs(gesture.cx - gesture.x) > 2 && (
                <span
                  className="interactive-edit-box is-draft"
                  style={{
                    left: `${Math.min(gesture.x, gesture.cx) / 10}%`,
                    top: `${Math.min(gesture.y, gesture.cy) / 10}%`,
                    width: `${Math.abs(gesture.cx - gesture.x) / 10}%`,
                    height: `${Math.abs(gesture.cy - gesture.y) / 10}%`,
                  }}
                />
              )}
          </div>
        </div>

        {assets.length > 1 && (
          <div className="interactive-edit-reference-strip" aria-label="切换参考图">
            {assets.map((asset, index) => (
              <button
                key={asset.id}
                type="button"
                className={asset.id === activeAsset.id ? "is-active" : ""}
                onClick={() => selectAsset(asset.id)}
                aria-label={`切换到${imgLabel(index)}`}
                aria-pressed={asset.id === activeAsset.id}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetThumbnailUrl(asset.id)} alt="" draggable={false} />
                <span className="interactive-edit-reference-index">{index + 1}</span>
                <SelectionIndicator
                  selected={asset.id === activeAsset.id}
                  className="interactive-edit-reference-selected"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
