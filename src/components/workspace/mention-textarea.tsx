"use client";

/**
 * 支持 @ 引用素材库素材的提示词输入框（即梦式行内芯片）。
 *
 * 基于 contentEditable 实现：输入 @ 弹出素材联想列表，选中后在文字中插入
 * 「缩略图 + 素材名」的行内芯片（整体不可编辑、退格整块删除），并通过
 * onPick 把素材挂载为参考素材。对外 value 仍为纯文本（芯片序列化为 @素材名）。
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileAudio, FileText, Film, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/client/api";
import {
  assetLabel,
  assetMeta,
  assetThumbnailUrl,
  type AssetDto,
  type AssetPageDto,
} from "@/lib/client/types";
import { LoadingState } from "@/components/ui/loading-state";
import { SelectionIndicator } from "@/components/ui/selection-indicator";

const KIND_ICON = {
  image: ImageIcon,
  video: Film,
  audio: FileAudio,
  text: FileText,
} as const;

const KIND_LABEL: Record<AssetDto["kind"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文案",
};

const MENTION_PAGE_SIZE = 20;
const MENTION_TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function assetSummary(asset: AssetDto): string {
  const params = assetMeta(asset).params ?? {};
  const size = String(params.actualSize || params.size || "").replace("x", "×");
  const resolution = String(params.actualResolution || params.resolution || "");
  const ratio = String(params.actualRatio || params.ratio || "");
  const duration = params.actualDuration ?? params.duration;
  const frames = params.actualFrames ?? params.frames;
  const fps = params.framesPerSecond ?? params.actualFramesPerSecond;
  const specs = [
    size && `${size} px`,
    resolution,
    ratio && ratio !== "adaptive" && ratio,
    duration !== undefined && duration !== -1 && `${duration}s`,
    frames !== undefined && `${frames} 帧${fps ? ` · ${fps} fps` : ""}`,
  ].filter(Boolean);

  return [
    KIND_LABEL[asset.kind],
    MENTION_TIME_FORMAT.format(new Date(asset.createdAt)),
    ...specs,
  ].join(" · ");
}

/** 构建行内素材芯片（imperative DOM：contentEditable 内容不归 React 管） */
function buildChip(asset: AssetDto, label: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.mention = label;
  chip.draggable = false;
  chip.className =
    "mx-0.5 inline-flex max-w-44 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1 py-px align-middle text-xs";
  chip.title = label;

  if (asset.kind === "image") {
    const img = document.createElement("img");
    img.src = assetThumbnailUrl(asset.id);
    img.alt = "";
    img.draggable = false;
    img.className = "size-5 shrink-0 rounded-sm object-cover";
    chip.appendChild(img);
  } else if (asset.kind === "video") {
    const img = document.createElement("img");
    img.src = assetThumbnailUrl(asset.id);
    img.alt = "";
    img.draggable = false;
    img.className = "size-5 shrink-0 rounded-sm object-cover";
    img.onerror = () => img.remove();
    chip.appendChild(img);
  } else {
    const badge = document.createElement("span");
    badge.className =
      "flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary/20 text-micro text-primary";
    badge.textContent = asset.kind === "audio" ? "♪" : "T";
    chip.appendChild(badge);
  }

  const name = document.createElement("span");
  name.className = "truncate text-foreground/90";
  name.textContent = label;
  chip.appendChild(name);
  return chip;
}

/** 把编辑器 DOM 序列化为纯文本：芯片 → @素材名，换行保留 */
/** \u6784\u5EFA\u884C\u5185\u300C\u4EA4\u4E92\u7F16\u8F91\u6807\u8BB0\u300D\u82AF\u7247\uFF1A\u7F29\u7565\u56FE + \u6807\u7B7E\uFF08\u56FEN \u6846\u9009 #M\uFF09+ \u5750\u6807 token\u3002
 * \u5E8F\u5217\u5316\u65F6\u8F93\u51FA dataset.markToken\uFF08\u5373 \u56FEN<bbox>...</bbox>\uFF09\uFF0C\u4F9B\u6A21\u578B\u76F4\u63A5\u7406\u89E3\u3002 */
function buildMarkChip(
  asset: AssetDto,
  label: string,
  token: string,
  markId: number
): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.markToken = token;
  chip.dataset.markId = String(markId);
  chip.draggable = false;
  chip.className =
    "mx-0.5 inline-flex max-w-64 items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-1.5 py-0.5 align-middle text-xs";
  chip.title = token;

  const img = document.createElement("img");
  img.src = assetThumbnailUrl(asset.id);
  img.alt = "";
  img.draggable = false;
  img.className = "size-6 shrink-0 rounded-sm object-cover";
  chip.appendChild(img);

  const text = document.createElement("span");
  text.className = "min-w-0 leading-tight";
  const name = document.createElement("span");
  name.dataset.markLabel = "";
  name.className = "block truncate font-medium text-foreground/90";
  name.textContent = label;
  const coord = document.createElement("span");
  coord.dataset.markCoord = "";
  coord.className = "block truncate font-mono text-xs text-muted-foreground";
  coord.textContent = token.replace(/^\u56FE\d+/, "");
  text.appendChild(name);
  text.appendChild(coord);
  chip.appendChild(text);
  return chip;
}

function serializeNode(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) {
    return (n.textContent ?? "").replace(/\u00A0/g, " ");
  }
  if (n instanceof HTMLElement) {
    if (n.dataset.markToken !== undefined) return n.dataset.markToken;
    if (n.dataset.mention !== undefined) return `@${n.dataset.mention}`;
    if (n.tagName === "BR") return "\n";
    const inner = Array.from(n.childNodes).map(serializeNode).join("");
    // 浏览器可能把换行包成 div
    return n.tagName === "DIV" || n.tagName === "P" ? `\n${inner}` : inner;
  }
  return "";
}

function serializeEditor(el: HTMLElement): string {
  return Array.from(el.childNodes).map(serializeNode).join("");
}

interface MentionState {
  query: string;
}

export interface MentionTextareaHandle {
  /** 在光标处插入「交互编辑标记」芯片（缩略图 + 标签 + 坐标 token），markId 关联画布标记 */
  insertMarkChip: (
    asset: AssetDto,
    label: string,
    token: string,
    markId: number
  ) => void;
}

export interface MentionMarkState {
  id: number;
  label: string;
  token: string;
}

export const MentionTextarea = forwardRef<
  MentionTextareaHandle,
  {
    projectId: string;
    value: string;
    onChange: (v: string) => void;
    /** 选中素材后回调（由调用方挂为参考素材） */
    onPick: (asset: AssetDto) => void;
    /** 可引用的素材类型 */
    kinds?: AssetDto["kind"][];
    rows?: number;
    placeholder?: string;
    ariaLabel: string;
    /** 编辑框内当前存活的交互标记 markId 列表变化时回调（芯片被删除时同步画布） */
    onMarkIdsChange?: (markIds: number[]) => void;
    /** 父组件当前标记；删除或坐标更新时据此同步对应芯片 */
    marks?: MentionMarkState[];
    showHelp?: boolean;
  }
>(function MentionTextarea(
  {
    projectId,
    value,
    onChange,
    onPick,
    kinds = ["image", "video", "audio"],
    rows = 4,
    placeholder,
    ariaLabel,
    onMarkIdsChange,
    marks,
    showHelp = true,
  },
  ref
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const onMarkIdsChangeRef = useRef(onMarkIdsChange);
  const onChangeRef = useRef(onChange);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [active, setActive] = useState(0);
  const [empty, setEmpty] = useState(!value);

  useEffect(() => {
    onMarkIdsChangeRef.current = onMarkIdsChange;
    onChangeRef.current = onChange;
  }, [onChange, onMarkIdsChange]);

  // 外部改写 value（一键复用 / 清空等）时重建内容（纯文本，芯片不回放）
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const el = editorRef.current;
    if (!el) return;
    el.textContent = value;
    lastEmitted.current = value;
    setEmpty(!value);
    onMarkIdsChangeRef.current?.([]);
  }, [value]);

  const marksKey = marks
    ? JSON.stringify(
        marks.map(({ id, label, token }) => ({ id, label, token }))
      )
    : null;
  useEffect(() => {
    if (marksKey === null) return;
    const el = editorRef.current;
    if (!el) return;
    const nextMarks = new Map(
      (
        JSON.parse(marksKey) as Array<{
          id: number;
          label: string;
          token: string;
        }>
      ).map((mark) => [mark.id, mark])
    );
    let changed = false;
    el.querySelectorAll<HTMLElement>("[data-mark-id]").forEach((chip) => {
      const id = Number(chip.dataset.markId);
      const nextMark = nextMarks.get(id);
      if (!nextMark) {
        const next = chip.nextSibling;
        chip.remove();
        if (
          next?.nodeType === Node.TEXT_NODE &&
          next.textContent?.startsWith("\u00A0")
        ) {
          next.textContent = next.textContent.slice(1);
          if (!next.textContent) next.parentNode?.removeChild(next);
        }
        changed = true;
        return;
      }
      if (chip.dataset.markToken === nextMark.token) return;
      chip.dataset.markToken = nextMark.token;
      chip.title = nextMark.token;
      const label = chip.querySelector<HTMLElement>("[data-mark-label]");
      const coord = chip.querySelector<HTMLElement>("[data-mark-coord]");
      if (label) label.textContent = nextMark.label;
      if (coord) coord.textContent = nextMark.token.replace(/^\u56FE\d+/, "");
      changed = true;
    });
    if (!changed) return;
    let nextValue = serializeEditor(el);
    if (!el.querySelector("[data-mark-id]") && !nextValue.trim()) {
      el.textContent = "";
      nextValue = "";
    }
    lastEmitted.current = nextValue;
    setEmpty(!nextValue);
    onChangeRef.current(nextValue);
  }, [marksKey]);

  const emit = () => {
    const el = editorRef.current;
    if (!el) return;
    const v = serializeEditor(el);
    lastEmitted.current = v;
    setEmpty(!v);
    onChange(v);
    if (onMarkIdsChange) {
      const ids = Array.from(el.querySelectorAll<HTMLElement>("[data-mark-id]"))
        .map((n) => Number(n.dataset.markId))
        .filter((n) => Number.isFinite(n));
      onMarkIdsChange(ids);
    }
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<AssetPageDto>({
    queryKey: ["asset-mentions", projectId, kinds.join(","), mention?.query ?? ""],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        kind: kinds.join(","),
        limit: String(MENTION_PAGE_SIZE),
        excludeRole: "last_frame",
      });
      if (mention?.query) qs.set("q", mention.query);
      if (pageParam) qs.set("cursor", String(pageParam));
      return api<AssetPageDto>(`/api/projects/${projectId}/assets?${qs}`);
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: mention !== null,
  });
  const candidates = mention === null ? [] : (data?.pages.flatMap((page) => page.items) ?? []);

  useEffect(() => {
    if (mention === null) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-mention-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, mention]);

  /** 取光标所在文本节点中、光标前最近的 @ 上下文 */
  function caretMention(): { node: Text; at: number; caret: number } | null {
    const sel = window.getSelection();
    const el = editorRef.current;
    if (!sel?.rangeCount || !el) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return null;
    const caret = sel.anchorOffset;
    const before = (node.textContent ?? "").slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at === -1 || /\s/.test(before.slice(at + 1).replace(/\u00A0/g, " "))) {
      return null;
    }
    return { node: node as Text, at, caret };
  }

  function detectMention() {
    const ctx = caretMention();
    if (!ctx) {
      setMention(null);
      return;
    }
    setMention({ query: (ctx.node.textContent ?? "").slice(ctx.at + 1, ctx.caret) });
    setActive(0);
  }

  function removeAdjacentChip(key: "Backspace" | "Delete"): boolean {
    const el = editorRef.current;
    const selection = window.getSelection();
    if (!el || !selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return false;

    const isChip = (node: Node | null): node is HTMLElement =>
      node instanceof HTMLElement &&
      (node.dataset.markId !== undefined || node.dataset.mention !== undefined);
    const isSpacer = (node: Node | null): node is Text =>
      node instanceof Text && /^[\s\u00A0]*$/.test(node.textContent ?? "");

    let chip: HTMLElement | null = null;
    let spacer: Text | null = null;
    const container = range.startContainer;
    const offset = range.startOffset;

    if (container instanceof Text) {
      if (
        key === "Backspace" &&
        /^[\s\u00A0]*$/.test((container.textContent ?? "").slice(0, offset)) &&
        isChip(container.previousSibling)
      ) {
        chip = container.previousSibling;
        spacer = container;
      } else if (
        key === "Delete" &&
        /^[\s\u00A0]*$/.test((container.textContent ?? "").slice(offset)) &&
        isChip(container.nextSibling)
      ) {
        chip = container.nextSibling;
        spacer = container;
      } else if (offset === 0 && key === "Backspace" && isChip(container.previousSibling)) {
        chip = container.previousSibling;
      } else if (
        offset === (container.textContent ?? "").length &&
        key === "Delete" &&
        isChip(container.nextSibling)
      ) {
        chip = container.nextSibling;
      }
    } else if (container instanceof HTMLElement) {
      const adjacentIndex = key === "Backspace" ? offset - 1 : offset;
      const adjacent = container.childNodes[adjacentIndex] ?? null;
      if (isChip(adjacent)) {
        chip = adjacent;
      } else if (isSpacer(adjacent)) {
        const beyond =
          key === "Backspace" ? adjacent.previousSibling : adjacent.nextSibling;
        if (isChip(beyond)) {
          chip = beyond;
          spacer = adjacent;
        }
      }
    }

    if (!chip) return false;
    const parent = chip.parentNode;
    if (!parent) return false;
    const caret = document.createTextNode("");
    parent.insertBefore(caret, chip);
    chip.remove();
    spacer?.remove();
    const nextRange = document.createRange();
    nextRange.setStart(caret, 0);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    return true;
  }

  function pick(asset: AssetDto) {
    const el = editorRef.current;
    if (!el) return;
    const label = assetLabel(asset);
    const chip = buildChip(asset, label);
    const space = document.createTextNode("\u00A0");

    const ctx = caretMention();
    if (ctx) {
      // 把 "@query" 替换为芯片 + 空格
      const text = ctx.node.textContent ?? "";
      const afterText = text.slice(ctx.caret);
      ctx.node.textContent = text.slice(0, ctx.at);
      const parent = ctx.node.parentNode!;
      const anchor = ctx.node.nextSibling;
      parent.insertBefore(chip, anchor);
      parent.insertBefore(space, anchor);
      if (afterText) parent.insertBefore(document.createTextNode(afterText), anchor);
    } else {
      el.appendChild(chip);
      el.appendChild(space);
    }

    // 光标移到空格之后
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(space, 1);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);

    setMention(null);
    onPick(asset);
    emit();
    el.focus();
  }

  useImperativeHandle(ref, () => ({
    insertMarkChip(asset, label, token, markId) {
      const el = editorRef.current;
      if (!el) return;
      const chip = buildMarkChip(asset, label, token, markId);
      const space = document.createTextNode(" ");

      // 若光标在编辑器内则插入光标处，否则追加到末尾
      const sel = window.getSelection();
      let range: Range | null = null;
      if (sel?.rangeCount) {
        const r = sel.getRangeAt(0);
        if (el.contains(r.commonAncestorContainer)) range = r;
      }
      if (range) {
        range.deleteContents();
        range.insertNode(space);
        range.insertNode(chip);
      } else {
        el.appendChild(chip);
        el.appendChild(space);
      }

      // 光标移到空格之后
      const after = document.createRange();
      after.setStart(space, 1);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);

      emit();
      el.focus();
    },
  }));

  return (
    <div className="relative">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        className="focus-ring w-full whitespace-pre-wrap break-words rounded-md border border-input bg-card px-3 py-2 text-ui shadow-sm focus-visible:border-ring"
        style={{ minHeight: `${rows * 1.55 + 1.2}em` }}
        onInput={() => {
          emit();
          detectMention();
        }}
        onClick={detectMention}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            detectMention();
          }
        }}
        onKeyDown={(e) => {
          if (
            (e.key === "Backspace" || e.key === "Delete") &&
            removeAdjacentChip(e.key)
          ) {
            e.preventDefault();
            setMention(null);
            emit();
            return;
          }
          if (mention !== null && e.key === "Escape") {
            e.preventDefault();
            setMention(null);
            return;
          }
          if (mention !== null && candidates.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (active === candidates.length - 1 && hasNextPage && !isFetchingNextPage) {
                void fetchNextPage();
              } else {
                setActive((i) => Math.min(i + 1, candidates.length - 1));
              }
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(candidates[active]);
              return;
            }
          }
          if (e.key === "Enter") {
            // 统一为纯文本换行，避免浏览器插入 div 嵌套
            e.preventDefault();
            document.execCommand("insertText", false, "\n");
          }
        }}
        onPaste={(e) => {
          // 只接受纯文本，防止粘贴进富文本结构
          e.preventDefault();
          document.execCommand(
            "insertText",
            false,
            e.clipboardData.getData("text/plain")
          );
        }}
        onBlur={() => setTimeout(() => setMention(null), 150)}
      />
      {empty && placeholder && (
        <p className="pointer-events-none absolute left-3 top-2 text-ui text-muted-foreground">
          {placeholder}
        </p>
      )}
      {showHelp && (
        <p className="mt-1 text-xs text-muted-foreground/80">
          输入 @ 可引用素材库素材作为参考（以缩略图芯片嵌入文字）
        </p>
      )}
      {mention !== null && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <div
            ref={listRef}
            role="listbox"
            aria-label="引用素材"
            className="max-h-[min(22rem,45vh)] overflow-y-auto overscroll-contain"
            onScroll={(e) => {
              const list = e.currentTarget;
              const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
              if (remaining < 80 && hasNextPage && !isFetchingNextPage) {
                void fetchNextPage();
              }
            }}
          >
            {candidates.length ? (
              <>
                {candidates.map((a, i) => {
                  const Icon = KIND_ICON[a.kind];
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      data-mention-index={i}
                      className={`flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-left text-xs ${
                        i === active ? "bg-accent text-foreground" : "text-muted-foreground"
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(a);
                      }}
                      onMouseEnter={() => setActive(i)}
                    >
                      {a.kind === "image" ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={assetThumbnailUrl(a.id)}
                          alt=""
                          loading="lazy"
                          className="size-9 shrink-0 rounded border border-border object-cover"
                        />
                      ) : a.kind === "video" ? (
                        <span className="relative size-9 shrink-0 overflow-hidden rounded border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={assetThumbnailUrl(a.id)}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                          <Film className="absolute bottom-0.5 right-0.5 size-3 text-white drop-shadow" />
                        </span>
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded border border-border bg-muted/40">
                          <Icon className="size-4 text-primary" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{assetLabel(a)}</span>
                        <span className="block truncate font-mono text-xs opacity-70">
                          {assetSummary(a)}
                        </span>
                      </span>
                      <SelectionIndicator selected={i === active} />
                    </button>
                  );
                })}
                {isFetchingNextPage ? (
                  <LoadingState
                    appearance="inline"
                    label="正在加载更多素材…"
                    className="border-t border-border/60 px-3 py-1.5"
                  />
                ) : (
                  <p className="border-t border-border/60 px-3 py-1.5 text-center text-xs text-muted-foreground">
                    {hasNextPage
                      ? `已加载 ${candidates.length} 条，继续向下滚动`
                      : `已显示全部 ${candidates.length} 条`}
                  </p>
                )}
              </>
            ) : (
              isLoading ? (
                <LoadingState appearance="inline" label="正在加载素材…" className="px-3 py-2" />
              ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的素材</p>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
});
