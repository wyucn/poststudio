"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusMessage } from "@/components/ui/status-message";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import { assetMeta, type AssetDto } from "@/lib/client/types";
import {
  DEFAULT_FORMULA_LATEX,
  DEFAULT_FORMULA_TEXT,
  FORMULA_EXPORT_SIZES,
  FORMULA_FRACTION_PADDING_OPTIONS,
  FORMULA_SNIPPET_GROUPS,
  applyFractionPadding,
  fitFormulaExportSize,
  normalizeFormulaText,
  type FormulaFractionPadding,
  type FormulaInputMode,
} from "@/lib/formula";
import {
  parseFormulaAssetState,
  type FormulaAssetState,
} from "@/lib/formula-assets";
import {
  arrayBufferToDataUrl,
  BUNDLED_FORMULA_FONTS,
  buildFontFaceCss,
  DEFAULT_FORMULA_FONT_STACK,
  FORMULA_FONT_PRESETS,
  normalizeFontFamilyStack,
  quoteFontFamily,
  type FormulaFontAsset,
  type FormulaFontFormat,
} from "@/lib/formula-fonts";
import { Clipboard, Download, FileCode2, FunctionSquare, RefreshCw, Save, Sigma } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreationWorkspace } from "./creator-stage";
import { ComposerSteps, CreatorComposer, ParamSummary } from "./creator-workspace";

type MathJaxRuntime = {
  startup: { promise: Promise<void> };
  tex2svgPromise: (input: string, options?: { display?: boolean }) => Promise<HTMLElement>;
};

type LocalFontData = {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob: () => Promise<Blob>;
};

declare global {
  interface Window {
    MathJax?: MathJaxRuntime & Record<string, unknown>;
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

const MATHJAX_SCRIPT_ID = "haitun-mathjax-script";
const MATHJAX_VENDOR_ROOT = "/vendor/mathjax-stix2";
const DEFAULT_CJK_FONT = DEFAULT_FORMULA_FONT_STACK;
let mathJaxPromise: Promise<MathJaxRuntime> | null = null;

function encodeCjkRun(run: string) {
  return Array.from(run, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? character : `\\unicode{x${codePoint.toString(16)}}`;
  }).join("");
}

function wrapCjkRuns(source: string) {
  // Keep the normalized value copyable as LaTeX.  MathJax 4 renders the
  // decoded characters below as SVG text nodes, which lets a loaded local
  // font provide the actual CJK outlines in both preview and export.
  return source.replace(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]+/gu, encodeCjkRun);
}

function decodeUnicodeCommands(source: string) {
  return source.replace(/\\unicode\{(?:x|0x)?([0-9a-f]{1,6})\}/giu, (match, value: string) => {
    const codePoint = Number.parseInt(value, 16);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  });
}

function readBalancedGroup(source: string, start: number) {
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { end: index, content: source.slice(start, index + 1) };
      }
    }
  }
  return null;
}

function applyLatinShape(source: string, shape: "italic" | "roman") {
  if (shape !== "roman") return source;
  const passthrough = new Set([
    "begin",
    "end",
    "text",
    "textrm",
    "textbf",
    "textit",
    "mathrm",
    "mathit",
    "mathbf",
    "unicode",
    "operatorname",
    "operatorname*",
  ]);
  let result = "";
  let index = 0;
  while (index < source.length) {
    if (source[index] === "\\") {
      result += source[index];
      index += 1;
      let command = "";
      while (index < source.length && /[A-Za-z*]/u.test(source[index])) {
        command += source[index];
        result += source[index];
        index += 1;
      }
      if (passthrough.has(command) && source[index] === "{") {
        const group = readBalancedGroup(source, index);
        if (group) {
          result += group.content;
          index = group.end + 1;
        }
      }
      continue;
    }
    if (/[A-Za-z]/u.test(source[index])) {
      let token = source[index];
      index += 1;
      while (index < source.length && /[A-Za-z]/u.test(source[index])) {
        token += source[index];
        index += 1;
      }
      result += `\\mathrm{${token}}`;
      continue;
    }
    result += source[index];
    index += 1;
  }
  return result;
}

function setSvgTextFont(svg: SVGSVGElement, fontFamily: string) {
  const normalized = normalizeFontFamilyStack(fontFamily).join(", ") || DEFAULT_CJK_FONT;
  svg.querySelectorAll("text, tspan").forEach((node) => {
    if (!(node.textContent ?? "").trim()) return;
    node.setAttribute("font-family", normalized);
    node.setAttribute("font-style", "normal");
  });
}

function loadMathJax(): Promise<MathJaxRuntime> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("公式渲染只能在浏览器中运行"));
  }
  if (window.MathJax?.tex2svgPromise) {
    return window.MathJax.startup.promise.then(() => window.MathJax as MathJaxRuntime);
  }
  if (mathJaxPromise) return mathJaxPromise;

  const existing = document.getElementById(MATHJAX_SCRIPT_ID) as HTMLScriptElement | null;
  const ready = new Promise<MathJaxRuntime>((resolve, reject) => {
    const finish = () => {
      const runtime = window.MathJax;
      if (!runtime?.tex2svgPromise) {
        reject(new Error("公式渲染引擎初始化失败"));
        return;
      }
      runtime.startup.promise.then(() => {
        resolve(runtime);
      }).catch(reject);
    };
    if (existing) {
      if (existing.dataset.ready === "true") {
        finish();
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("公式渲染引擎加载失败")), { once: true });
      return;
    }

    window.MathJax = {
      loader: {
        paths: { "mathjax-stix2": MATHJAX_VENDOR_ROOT },
      },
      tex: {
        inlineMath: [["$", "$"], ["\\(", "\\)"]],
        displayMath: [["$$", "$$"], ["\\[", "\\]"]],
      },
      // Disable the shared font cache so downloaded SVGs are self-contained
      // and can be imported into After Effects without external <use> refs.
      svg: {
        fontCache: "none",
        dynamicPrefix: "[mathjax-stix2]/svg/dynamic",
      },
      output: {
        font: "mathjax-stix2",
        unknownFamily: DEFAULT_CJK_FONT,
        mtextInheritFont: true,
      },
      startup: { typeset: false, promise: Promise.resolve() },
    } as unknown as MathJaxRuntime & Record<string, unknown>;

    const script = document.createElement("script");
    script.id = MATHJAX_SCRIPT_ID;
    script.src = `${MATHJAX_VENDOR_ROOT}/tex-mml-svg-mathjax-stix2.js`;
    script.async = true;
    script.onload = () => {
      script.dataset.ready = "true";
      finish();
    };
    script.onerror = () => reject(new Error("公式渲染引擎加载失败，请刷新后重试"));
    document.head.append(script);
  });

  mathJaxPromise = ready.catch((error) => {
    mathJaxPromise = null;
    throw error;
  });
  return mathJaxPromise;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function localFontKey(font: LocalFontData) {
  return [font.family, font.fullName, font.postscriptName, font.style].join("|");
}

function localFontWeight(font: LocalFontData) {
  const value = `${font.fullName} ${font.postscriptName} ${font.style}`.toLowerCase();
  if (/(black|heavy|extrabold|extra bold)/u.test(value)) return "900";
  if (/(bold|semibold|semi bold|demibold|demi bold)/u.test(value)) return "700";
  if (/(medium|book)/u.test(value)) return "500";
  return "400";
}

function localFontStyle(font: LocalFontData) {
  return /(italic|oblique)/iu.test(`${font.fullName} ${font.postscriptName} ${font.style}`)
    ? "italic"
    : "normal";
}

function localFontFormat(buffer: ArrayBuffer, mimeType: string): FormulaFontFormat {
  const value = mimeType.toLowerCase();
  if (value.includes("woff2")) return "woff2";
  if (value.includes("woff")) return "woff";
  if (value.includes("opentype") || value.includes("otf")) return "opentype";
  const header = String.fromCharCode(...new Uint8Array(buffer.slice(0, 4)));
  if (header === "wOF2") return "woff2";
  if (header === "wOFF") return "woff";
  if (header === "OTTO") return "opentype";
  return "truetype";
}

function fontMimeType(format: FormulaFontFormat) {
  if (format === "woff2") return "font/woff2";
  if (format === "woff") return "font/woff";
  if (format === "opentype") return "font/otf";
  return "font/ttf";
}

function isLantingYuanFont(font: LocalFontData) {
  return /方正兰亭圆|lantingyuan/iu.test(
    `${font.family} ${font.fullName} ${font.postscriptName}`,
  );
}

function localFontSelectionValue(font: LocalFontData) {
  return `local:${localFontKey(font)}`;
}

function withFontFamily(fontFamily: string) {
  const fallback = normalizeFontFamilyStack(DEFAULT_CJK_FONT).filter(
    (family) => family.replace(/["']/gu, "").toLowerCase() !== fontFamily.toLowerCase(),
  );
  return [quoteFontFamily(fontFamily), ...fallback].join(", ");
}

function uniqueFontAssets(assets: FormulaFontAsset[]) {
  const result = new Map<string, FormulaFontAsset>();
  for (const asset of assets) {
    result.set(`${asset.family}|${asset.weight ?? ""}|${asset.style ?? ""}`, asset);
  }
  return [...result.values()];
}

function svgMetrics(svg: SVGSVGElement) {
  const viewBox = svg.getAttribute("viewBox")?.trim();
  if (viewBox) {
    const values = viewBox.split(/[\s,]+/).map(Number);
    if (values.length >= 4 && values.every(Number.isFinite)) {
      return { width: Math.max(1, values[2]), height: Math.max(1, values[3]), viewBox };
    }
  }
  const width = Number.parseFloat(svg.getAttribute("width") ?? "0");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "0");
  return {
    width: Math.max(1, Number.isFinite(width) ? width : 1),
    height: Math.max(1, Number.isFinite(height) ? height : 1),
    viewBox: `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`,
  };
}

function prepareExportSvg(
  source: SVGSVGElement,
  cjkFontFamily: string,
  embeddedFonts: FormulaFontAsset[],
): { svg: SVGSVGElement; width: number; height: number } {
  const svg = source.cloneNode(true) as SVGSVGElement;
  const metrics = svgMetrics(svg);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  svg.setAttribute("viewBox", metrics.viewBox);
  svg.removeAttribute("style");
  svg.removeAttribute("focusable");
  svg.setAttribute("width", String(metrics.width));
  svg.setAttribute("height", String(metrics.height));
  setSvgTextFont(svg, cjkFontFamily);
  svg.querySelectorAll("style").forEach((style) => {
    if (/@font-face|https?:\/\//iu.test(style.textContent ?? "")) style.remove();
  });
  const fonts = uniqueFontAssets(embeddedFonts);
  if (fonts.length) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = fonts.map(buildFontFaceCss).join("\n");
    svg.insertBefore(style, svg.firstChild);
  }
  return { svg, width: metrics.width, height: metrics.height };
}

function serializeSvg(svg: SVGSVGElement) {
  return new XMLSerializer().serializeToString(svg);
}

function FormulaHistoryRail() {
  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="flex items-center gap-2 border-b border-border/60 pb-3">
        <Sigma className="size-4 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">公式工具</p>
          <p className="font-mono text-micro text-muted-foreground">LOCAL / AE READY</p>
        </div>
      </div>
      <div className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
        <p>公式在浏览器本地渲染，不会创建后台任务，也不会消耗模型额度。</p>
        <div className="rounded-md border border-border/70 bg-muted/45 p-2.5">
          <p className="font-semibold text-foreground">首版已支持</p>
          <ul className="mt-1.5 space-y-1">
            <li>LaTeX 与中文近似输入</li>
            <li>MathJax SVG 预览</li>
            <li>透明 SVG / PNG 导出</li>
          </ul>
        </div>
        <div className="rounded-md border border-dashed border-border/70 p-2.5">
          <p className="font-semibold text-foreground">正在完善</p>
          <p className="mt-1">保存到项目资产库后可随时重新编辑；截图 OCR 仍待模型接入。</p>
        </div>
      </div>
    </div>
  );
}

function readInitialFormulaState(asset?: AssetDto | null): FormulaAssetState | null {
  const candidate = asset ? assetMeta(asset).formula : undefined;
  if (!candidate) return null;
  try {
    return parseFormulaAssetState(candidate);
  } catch {
    return null;
  }
}

export function FormulaPanel({
  projectId,
  projectName,
  initialFormulaAsset,
}: {
  projectId: string;
  projectName?: string;
  initialFormulaAsset?: AssetDto | null;
}) {
  const initialFormula = readInitialFormulaState(initialFormulaAsset);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<FormulaInputMode>(initialFormula?.mode ?? "latex");
  const [latex, setLatex] = useState(initialFormula?.latex ?? DEFAULT_FORMULA_LATEX);
  const [text, setText] = useState(initialFormula?.text ?? DEFAULT_FORMULA_TEXT);
  const [displayMode, setDisplayMode] = useState(initialFormula?.displayMode ?? true);
  const [latinShape, setLatinShape] = useState<"italic" | "roman">(initialFormula?.latinShape ?? "italic");
  const [fractionPadding, setFractionPadding] = useState<FormulaFractionPadding>(initialFormula?.fractionPadding ?? "standard");
  const [cjkFont, setCjkFont] = useState(initialFormula?.cjkFont ?? DEFAULT_CJK_FONT);
  const [exportSize, setExportSize] = useState(initialFormula?.exportSize ?? "1920x1080");
  const [transparentPreview, setTransparentPreview] = useState(initialFormula?.transparentPreview ?? true);
  const [safeAreaGuides, setSafeAreaGuides] = useState(false);
  const [renderedMarkup, setRenderedMarkup] = useState("");
  const [activeLatex, setActiveLatex] = useState(initialFormula?.activeLatex ?? DEFAULT_FORMULA_LATEX);
  const [status, setStatus] = useState<{ tone: "info" | "success" | "danger"; message: string }>({
    tone: "info",
    message: initialFormula ? "已从项目资产库载入公式，可继续修改后保存新版本" : "正在初始化公式渲染引擎…",
  });
  const [localFonts, setLocalFonts] = useState<LocalFontData[]>([]);
  const [fontSelection, setFontSelection] = useState(
    initialFormula?.fontSelection.startsWith("local:")
      ? "custom"
      : initialFormula?.fontSelection ?? "preset:system-lanting-yuan",
  );
  const [localFontSupported, setLocalFontSupported] = useState<boolean | null>(null);
  const [fontOperation, setFontOperation] = useState<"read" | "apply" | null>(null);
  const [fontStatus, setFontStatus] = useState(
    initialFormula?.fontSelection.startsWith("local:")
      ? "已恢复本机字体栈；如需再次内嵌，请重新读取本机字体"
      : "内置 STIX Two Text / STIX Two Math 正在准备…",
  );
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const renderVersion = useRef(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const embeddedFontsRef = useRef(new Map<string, FormulaFontAsset>());
  const activeLocalFontIdRef = useRef<string | null>(null);
  const bundledFontsPromiseRef = useRef<Promise<void> | null>(null);

  const ensureBundledFonts = useCallback(() => {
    if (bundledFontsPromiseRef.current) return bundledFontsPromiseRef.current;
    bundledFontsPromiseRef.current = Promise.all(
      BUNDLED_FORMULA_FONTS.map(async (font) => {
        const response = await fetch(font.url, { cache: "force-cache" });
        if (!response.ok) throw new Error(`${font.family} 字体加载失败`);
        const buffer = await response.arrayBuffer();
        const dataUrl = arrayBufferToDataUrl(buffer, font.mimeType);
        const asset: FormulaFontAsset = {
          id: font.id,
          family: font.family,
          source: "bundled",
          dataUrl,
          format: font.format,
          weight: font.weight,
          style: font.style,
        };
        embeddedFontsRef.current.set(font.id, asset);
        if (typeof FontFace !== "undefined") {
          try {
            const face = new FontFace(font.family, buffer, {
              weight: font.weight,
              style: font.style,
            });
            document.fonts.add(await face.load());
          } catch {
            // The data URL is still embedded in exported SVGs even if this
            // browser cannot activate the optional document font face.
          }
        }
      }),
    )
      .then(() => {
        setFontStatus("内置 STIX Two Text / STIX Two Math 已就绪");
      })
      .catch((error) => {
        bundledFontsPromiseRef.current = null;
        setFontStatus(error instanceof Error ? error.message : "内置字体加载失败，将使用系统回退字体");
        throw error;
      });
    return bundledFontsPromiseRef.current;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocalFontSupported(typeof window.queryLocalFonts === "function");
    }, 0);
    void ensureBundledFonts().catch(() => undefined);
    return () => window.clearTimeout(timer);
  }, [ensureBundledFonts]);

  async function applyLocalFont(font: LocalFontData) {
    const key = localFontKey(font);
    const assetId = `local:${key}`;
    let asset = embeddedFontsRef.current.get(assetId);
    if (!asset) {
      const blob = await font.blob();
      const buffer = await blob.arrayBuffer();
      const format = localFontFormat(buffer, blob.type);
      const mimeType = blob.type || fontMimeType(format);
      const dataUrl = arrayBufferToDataUrl(buffer, mimeType);
      if (typeof FontFace !== "undefined") {
        const face = new FontFace(font.family, buffer, {
          weight: localFontWeight(font),
          style: localFontStyle(font),
        });
        document.fonts.add(await face.load());
      }
      asset = {
        id: assetId,
        family: font.family,
        source: "local",
        dataUrl,
        format,
        weight: localFontWeight(font),
        style: localFontStyle(font),
      };
      embeddedFontsRef.current.set(assetId, asset);
    }
    activeLocalFontIdRef.current = asset.id;
    setFontSelection(localFontSelectionValue(font));
    setCjkFont(withFontFamily(font.family));
    setFontStatus(`已加载并内嵌本机字体：${font.family}`);
  }

  async function readLocalFonts() {
    if (!window.queryLocalFonts) {
      setFontStatus("当前浏览器不支持本机字体读取，请手动填写字体栈");
      return;
    }
    setFontOperation("read");
    try {
      const entries = await window.queryLocalFonts();
      const preferred = new Map<string, LocalFontData>();
      for (const entry of [...entries].sort((left, right) => {
        const leftRegular = /regular|normal|book/iu.test(`${left.style} ${left.fullName}`) ? 0 : 1;
        const rightRegular = /regular|normal|book/iu.test(`${right.style} ${right.fullName}`) ? 0 : 1;
        return leftRegular - rightRegular || left.family.localeCompare(right.family, "zh-CN");
      })) {
        if (!preferred.has(entry.family)) preferred.set(entry.family, entry);
      }
      const families = [...preferred.values()].sort((left, right) => left.family.localeCompare(right.family, "zh-CN"));
      setLocalFonts(families);
      const lantingYuan = families.find(isLantingYuanFont);
      if (lantingYuan) {
        await applyLocalFont(lantingYuan);
        setFontStatus(`已读取 ${families.length} 个字体，并优先应用方正兰亭圆：${lantingYuan.family}`);
      } else {
        setFontStatus(`已读取 ${families.length} 个本机字体，可选择后应用并内嵌`);
      }
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "浏览器未授予本机字体权限，请允许后重试"
        : error instanceof Error
          ? error.message
          : "本机字体读取失败，请重试";
      setFontStatus(message);
    } finally {
      setFontOperation(null);
    }
  }

  async function applyFontSelection(value: string) {
    setFontOperation("apply");
    const preset = value.startsWith("preset:")
      ? FORMULA_FONT_PRESETS.find((item) => `preset:${item.id}` === value)
      : undefined;
    try {
      if (preset) {
        activeLocalFontIdRef.current = null;
        setFontSelection(value);
        setCjkFont(preset.family);
        setFontStatus(
          preset.source === "bundled"
            ? `${preset.label} 已启用，导出时会自动内嵌`
            : `${preset.label} 已应用；读取本机字体后可内嵌`,
        );
        if (preset.source === "bundled") await ensureBundledFonts();
        return;
      }

      if (value === "custom") {
        activeLocalFontIdRef.current = null;
        setFontSelection(value);
        setFontStatus("已切换到自定义字体栈，请展开下方高级设置进行编辑");
        return;
      }

      const selected = localFonts.find((font) => localFontSelectionValue(font) === value);
      if (!selected) {
        setFontStatus("请先读取本机字体，再从字体选择器中选择一个字体");
        return;
      }
      await applyLocalFont(selected);
    } catch (error) {
      setFontStatus(error instanceof Error ? `字体加载失败：${error.message}` : "字体加载失败，请重试");
    } finally {
      setFontOperation(null);
    }
  }

  function resetFormulaFont() {
    activeLocalFontIdRef.current = null;
    setFontSelection("preset:system-lanting-yuan");
    setCjkFont(DEFAULT_CJK_FONT);
    setFontStatus("已恢复默认字体栈；已加载的本机字体不会自动写入导出文件");
  }

  const source = mode === "latex" ? latex : text;
  const preparedLatex = useMemo(() => {
    let value = mode === "text" ? normalizeFormulaText(text) : latex.trim();
    value = wrapCjkRuns(value);
    value = applyLatinShape(value, latinShape);
    value = applyFractionPadding(value, fractionPadding);
    return value;
  }, [fractionPadding, latex, latinShape, mode, text]);

  const renderFormula = useCallback(async () => {
    const version = ++renderVersion.current;
    if (!preparedLatex.trim()) {
      setRenderedMarkup("");
      setActiveLatex("");
      setStatus({ tone: "info", message: "请输入公式后再渲染" });
      return;
    }
    setBusy(true);
    try {
      const mathJax = await loadMathJax();
      const renderInput = decodeUnicodeCommands(preparedLatex);
      const node = await mathJax.tex2svgPromise(renderInput, { display: displayMode });
      if (version !== renderVersion.current) return;
      const markup = node.outerHTML;
      setRenderedMarkup(markup);
      setActiveLatex(preparedLatex);
      setStatus({ tone: "success", message: "预览已更新，结果可直接导出到 AE" });
    } catch (error) {
      if (version !== renderVersion.current) return;
      setRenderedMarkup("");
      setStatus({ tone: "danger", message: error instanceof Error ? error.message : "公式渲染失败，请检查 LaTeX" });
    } finally {
      if (version === renderVersion.current) setBusy(false);
    }
  }, [displayMode, preparedLatex, setActiveLatex, setBusy, setRenderedMarkup, setStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => void renderFormula(), 220);
    return () => window.clearTimeout(timer);
  }, [renderFormula]);

  useEffect(() => {
    if (!outputRef.current) return;
    outputRef.current.innerHTML = renderedMarkup;
    const svg = outputRef.current.querySelector("svg");
    if (svg) {
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      svg.style.color = transparentPreview ? "#171a14" : "#f8fafc";
      svg.style.fontFamily = cjkFont;
      setSvgTextFont(svg, cjkFont);
    }
  }, [cjkFont, renderedMarkup, transparentPreview]);

  function insertSnippet(code: string) {
    if (mode === "latex") setLatex((current) => `${current}${current ? " " : ""}${code}`);
    else setText((current) => `${current}${current ? " " : ""}${code}`);
  }

  async function copyLatex() {
    try {
      await navigator.clipboard.writeText(activeLatex);
      setStatus({ tone: "success", message: "当前 LaTeX 已复制" });
    } catch {
      setStatus({ tone: "danger", message: "剪贴板不可用，请手动复制下方 LaTeX" });
    }
  }

  function getExportSvg() {
    const svg = outputRef.current?.querySelector("svg");
    if (!svg) return null;
    const embeddedFonts = [...embeddedFontsRef.current.values()].filter(
      (font) => font.source === "bundled" || font.id === activeLocalFontIdRef.current,
    );
    return prepareExportSvg(svg, cjkFont, embeddedFonts);
  }

  async function exportSvg() {
    await ensureBundledFonts().catch(() => undefined);
    if (activeLatex !== preparedLatex) {
      setStatus({ tone: "info", message: "预览正在更新，请稍后再导出" });
      return;
    }
    const prepared = getExportSvg();
    if (!prepared) {
      setStatus({ tone: "danger", message: "请先生成有效公式" });
      return;
    }
    downloadBlob(new Blob([serializeSvg(prepared.svg)], { type: "image/svg+xml;charset=utf-8" }), "haitun-formula.svg");
    setStatus({ tone: "success", message: "AE SVG 已下载" });
  }

  async function buildPngBlob() {
    await ensureBundledFonts().catch(() => undefined);
    if (activeLatex !== preparedLatex) throw new Error("预览正在更新，请稍后再试");
    const prepared = getExportSvg();
    const target = FORMULA_EXPORT_SIZES.find((item) => item.value === exportSize) ?? FORMULA_EXPORT_SIZES[3];
    if (!prepared) throw new Error("请先生成有效公式");
    const fitted = fitFormulaExportSize(prepared.width, prepared.height, target.width, target.height);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持 PNG 导出");
    context.clearRect(0, 0, canvas.width, canvas.height);
    const image = new Image();
    const imageUrl = URL.createObjectURL(new Blob([serializeSvg(prepared.svg)], { type: "image/svg+xml" }));
    await new Promise<void>((resolve, reject) => {
      image.onload = () => {
        URL.revokeObjectURL(imageUrl);
        context.drawImage(image, 0, 0, fitted.width, fitted.height);
        resolve();
      };
      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error("PNG 渲染失败，请重试"));
      };
      image.src = imageUrl;
    });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("PNG 导出失败"));
      }, "image/png");
    });
    return {
      blob,
      filename: `haitun-formula-${target.value}.png`,
      target,
      width: fitted.width,
      height: fitted.height,
    };
  }

  async function exportPng() {
    try {
      const result = await buildPngBlob();
      downloadBlob(result.blob, result.filename);
      setStatus({ tone: "success", message: `透明 PNG 已下载（${result.width} × ${result.height}）` });
    } catch (error) {
      setStatus({ tone: "danger", message: error instanceof Error ? error.message : "PNG 导出失败" });
    }
  }

  async function saveFormulaAsset() {
    setSaving(true);
    try {
      const result = await buildPngBlob();
      const state: FormulaAssetState = {
        version: 1,
        mode,
        latex,
        text,
        activeLatex,
        displayMode,
        transparentPreview,
        latinShape,
        fractionPadding,
        cjkFont,
        fontSelection,
        exportSize: result.target.value,
        renderedWidth: result.width,
        renderedHeight: result.height,
      };
      const form = new FormData();
      form.append("file", result.blob, result.filename);
      form.append("metadata", JSON.stringify(state));
      await api<AssetDto>(`/api/projects/${projectId}/formula-assets`, {
        method: "POST",
        body: form,
      });
      await queryClient.invalidateQueries({ queryKey: ["assets", projectId] });
      setStatus({
        tone: "success",
        message: `已保存到项目资产库（${result.width} × ${result.height}），可从资产详情继续编辑`,
      });
    } catch (error) {
      setStatus({ tone: "danger", message: error instanceof Error ? error.message : "公式保存失败，请重试" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreationWorkspace
      kind="formula"
      composerLayout="side"
      index="FORMULA / 05"
      label="公式生成"
      projectName={projectName}
      headline="把公式做成可以直接进 AE 的素材"
      description="输入 LaTeX 或中文近似表达，实时预览并导出透明 SVG / PNG。"
      icon={Sigma}
      history={<FormulaHistoryRail />}
      stageContent={
        <div className="formula-stage-main flex h-full min-h-0 flex-col p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-micro font-semibold uppercase tracking-[0.18em] text-muted-foreground">16:9 / TRANSPARENT ARTBOARD</p>
              <p className="mt-1 text-sm font-semibold text-foreground">公式预览</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={() => setTransparentPreview((value) => !value)}>
                {transparentPreview ? "透明底" : "深色底"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="公式安全区辅助线"
                aria-pressed={safeAreaGuides}
                className={safeAreaGuides ? "bg-accent text-accent-foreground" : undefined}
                onClick={() => setSafeAreaGuides((value) => !value)}
              >
                {safeAreaGuides ? "隐藏安全区" : "显示安全区"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void renderFormula()} loading={busy} loadingText="渲染中">
                <RefreshCw /> 刷新
              </Button>
            </div>
          </div>
          <div className={`formula-preview-board relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-foreground/20 ${transparentPreview ? "is-transparent" : "bg-[#11150f]"}`}>
            <div ref={outputRef} className="formula-preview-output max-w-[88%] overflow-visible text-white" aria-live="polite" />
            {!renderedMarkup && <p className="text-sm text-muted-foreground">输入公式后将在这里显示预览</p>}
            {safeAreaGuides && (
              <div className="formula-safe-area-guides" data-formula-safe-area-guides="true" aria-hidden="true">
                <div className="formula-safe-area-guide formula-safe-area-guide--title">
                  <span>标题安全区 · 90%</span>
                </div>
                <div className="formula-safe-area-guide formula-safe-area-guide--action">
                  <span>动作安全区 · 80%</span>
                </div>
              </div>
            )}
            {busy && <span className="absolute bottom-3 right-3 rounded border border-border/70 bg-background/90 px-2 py-1 font-mono text-micro text-muted-foreground">RENDERING</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-mono">SVG / PNG · 无后台任务</span>
            <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
              {safeAreaGuides && <span data-formula-safe-area-status="true">安全区 90% / 80%</span>}
              <span>{activeLatex ? `${activeLatex.length} chars` : "等待输入"}</span>
            </span>
          </div>
        </div>
      }
    >
      <CreatorComposer kind="formula">
        <ComposerSteps finalLabel="导出素材" />
        <div className="formula-composer-grid grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.78fr)] lg:p-5">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-border/70 bg-muted/35 p-1" role="tablist" aria-label="公式输入模式">
              {([['latex', 'LaTeX 代码'], ['text', '中文近似']] as const).map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`min-h-9 rounded px-3 text-xs font-semibold transition-colors ${mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="formula-input">{mode === "latex" ? "LaTeX 公式" : "线性或中文表达"}</Label>
              <Textarea id="formula-input" aria-label={mode === "latex" ? "LaTeX 公式" : "线性或中文表达"} value={source} onChange={(event) => mode === "latex" ? setLatex(event.target.value) : setText(event.target.value)} rows={4} className="min-h-28 resize-y font-mono text-sm leading-6" placeholder={mode === "latex" ? "例如：\\frac{a+b}{c}" : "例如：x 平方加 y 平方等于 1"} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={displayMode} onChange={(event) => setDisplayMode(event.target.checked)} className="size-4 accent-primary" /> 展示公式模式</label>
              <Button type="button" variant="outline" size="sm" onClick={() => void renderFormula()} loading={busy} loadingText="渲染中"><RefreshCw /> 更新预览</Button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border border-border/70 bg-muted/20 p-2">
              {FORMULA_SNIPPET_GROUPS.map((group) => (
                <details key={group.title} open className="formula-snippet-group">
                  <summary className="cursor-pointer px-1 py-1.5 text-xs font-semibold text-foreground">{group.title}</summary>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {group.items.map((item) => <button key={item.label} type="button" onClick={() => insertSnippet(item.code)} className="min-w-0 rounded border border-border/70 bg-background px-2 py-1.5 text-left transition-colors hover:border-foreground/60 hover:bg-accent"><span className="block truncate text-xs font-semibold">{item.label}</span><code className="mt-0.5 block truncate font-mono text-micro text-muted-foreground">{item.code}</code></button>)}
                  </div>
                </details>
              ))}
            </div>
          </section>
          <section className="space-y-3 border-t border-border/60 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <div className="flex items-center gap-2"><FunctionSquare className="size-4 text-primary" /><p className="text-sm font-semibold">字体与导出</p></div>
            <div className="formula-export-controls grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>PNG 画布</Label><Select value={exportSize} onValueChange={(value) => setExportSize(value as FormulaAssetState["exportSize"])}><SelectTrigger aria-label="公式 PNG 导出画布"><SelectValue /></SelectTrigger><SelectContent>{FORMULA_EXPORT_SIZES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>英文字形</Label><Select value={latinShape} onValueChange={(value) => setLatinShape(value as "italic" | "roman")}><SelectTrigger aria-label="公式英文字形"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="italic">数学斜体</SelectItem><SelectItem value="roman">正体</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>分数留白</Label><Select value={fractionPadding} onValueChange={(value) => setFractionPadding(value as FormulaFractionPadding)}><SelectTrigger aria-label="公式分数留白"><SelectValue /></SelectTrigger><SelectContent>{FORMULA_FRACTION_PADDING_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <ParamSummary>{exportSize} · {transparentPreview ? "透明预览" : "深色预览"} · 预览与导出互不遮挡</ParamSummary>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="formula-font-select">文本 / 中文字体</Label>
                <span className="font-mono text-micro text-muted-foreground">{localFonts.length ? `${localFonts.length} 个本机字体` : "可先用内置字体"}</span>
              </div>
              <Select value={fontSelection} onValueChange={(value) => void applyFontSelection(value)} disabled={fontOperation !== null}>
                <SelectTrigger id="formula-font-select" aria-label="公式字体选择">
                  <SelectValue placeholder="选择文本字体" />
                </SelectTrigger>
                <SelectContent className="max-h-[min(60dvh,28rem)]">
                  <SelectGroup>
                    <SelectLabel>推荐字体</SelectLabel>
                    {FORMULA_FONT_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={`preset:${preset.id}`}>
                        <span className="flex min-w-0 items-center justify-between gap-3">
                          <span className="truncate" style={{ fontFamily: preset.family }}>{preset.label}</span>
                          <span className="shrink-0 text-micro text-muted-foreground">{preset.note}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {localFonts.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>已读取的本机字体（{localFonts.length}）</SelectLabel>
                      {localFonts.map((font) => (
                        <SelectItem key={localFontSelectionValue(font)} value={localFontSelectionValue(font)}>
                          <span className="truncate" style={{ fontFamily: `"${font.family}", sans-serif` }}>{font.family}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>高级</SelectLabel>
                    <SelectItem value="custom">自定义字体栈</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs leading-5">
              <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">数学字形</span><span className="font-semibold text-foreground">STIX Two Math · 内置</span></div>
              <div className="mt-1 flex items-center justify-between gap-2"><span className="text-muted-foreground">当前文本</span><span className="max-w-[65%] truncate text-right font-semibold text-foreground">{normalizeFontFamilyStack(cjkFont)[0] ?? "系统回退"}</span></div>
              <p className="mt-2 text-muted-foreground">数学轮廓固定由 MathJax 内嵌；选择本机字体并读取权限后，会把对应字体写入 SVG 的 @font-face。</p>
            </div>
            <div className="space-y-2 rounded-md border border-border/70 p-3">
              <div className="flex items-center justify-between gap-2"><Label>本机字体</Label><span className="font-mono text-micro text-muted-foreground">{localFonts.length ? `${localFonts.length} 个` : "尚未读取"}</span></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void readLocalFonts()} loading={fontOperation === "read"} loadingText="读取中" disabled={localFontSupported === false || fontOperation !== null}><span>读取本机字体</span></Button>
                <Button type="button" variant="ghost" size="sm" onClick={resetFormulaFont} disabled={fontOperation !== null}>恢复默认</Button>
              </div>
              <p data-formula-font-status="true" role="status" aria-live="polite" className="text-xs text-muted-foreground">{localFontSupported === false ? "当前浏览器不支持本机字体读取，请手动填写字体栈" : fontStatus}</p>
            </div>
            <details className="rounded-md border border-dashed border-border/70 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-foreground">高级：自定义字体栈</summary>
              <div className="mt-2 space-y-2">
                <Label htmlFor="formula-cjk-font">CSS 字体栈</Label>
                <Input id="formula-cjk-font" aria-label="公式中文字体栈" value={cjkFont} onChange={(event) => { activeLocalFontIdRef.current = null; setFontSelection("custom"); setCjkFont(event.target.value); }} placeholder={DEFAULT_FORMULA_FONT_STACK} />
                <p className="text-xs leading-5 text-muted-foreground">自定义系统字体不会自动复制到导出文件；需要内嵌时，请先读取本机字体并从上方选择。</p>
              </div>
            </details>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <Button type="button" variant="outline" onClick={() => void copyLatex()}>
                <Clipboard /> 复制 LaTeX
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void exportSvg()}
                disabled={busy || activeLatex !== preparedLatex}
              >
                <FileCode2 /> 导出 AE SVG
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void exportPng()}
                disabled={busy || activeLatex !== preparedLatex}
              >
                <Download /> 导出透明 PNG
              </Button>
              <Button
                type="button"
                data-formula-save-asset="true"
                onClick={() => void saveFormulaAsset()}
                loading={saving}
                loadingText="保存中"
                disabled={busy || activeLatex !== preparedLatex}
              >
                <Save /> 保存到项目资产库
              </Button>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/35 p-3"><p className="font-mono text-micro uppercase tracking-[0.14em] text-muted-foreground">CURRENT LATEX</p><code data-formula-active-latex="true" className="mt-1 block max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground">{activeLatex || "—"}</code></div>
            <StatusMessage tone={status.tone} appearance="inline">{status.message}</StatusMessage>
          </section>
        </div>
      </CreatorComposer>
    </CreationWorkspace>
  );
}
