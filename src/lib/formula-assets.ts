import {
  FORMULA_EXPORT_SIZES,
  type FormulaFractionPadding,
  type FormulaInputMode,
} from "./formula";

/**
 * Configuration captured alongside a rendered formula PNG.  The image stays
 * the durable project asset; this small record makes the asset editable again
 * without storing browser-only font binaries or a second database table.
 */
export interface FormulaAssetState {
  version: 1;
  mode: FormulaInputMode;
  latex: string;
  text: string;
  activeLatex: string;
  displayMode: boolean;
  transparentPreview: boolean;
  latinShape: "italic" | "roman";
  fractionPadding: FormulaFractionPadding;
  cjkFont: string;
  fontSelection: string;
  exportSize: (typeof FORMULA_EXPORT_SIZES)[number]["value"];
  renderedWidth: number;
  renderedHeight: number;
}

export const FORMULA_ASSET_MAX_METADATA_CHARS = 64 * 1024;
export const FORMULA_ASSET_MAX_SOURCE_CHARS = 20_000;
export const FORMULA_ASSET_MAX_FONT_STACK_CHARS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`${label}长度不合法`);
  }
  return value;
}

function finitePositiveInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 4096) {
    throw new Error(`${label}不合法`);
  }
  return value;
}

/** Validate the metadata before it is persisted by the formula asset route. */
export function parseFormulaAssetState(value: unknown): FormulaAssetState {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("公式资产版本不受支持");
  }
  const mode = value.mode;
  if (mode !== "latex" && mode !== "text") throw new Error("公式输入模式不合法");
  const latinShape = value.latinShape;
  if (latinShape !== "italic" && latinShape !== "roman") throw new Error("英文字形不合法");
  const fractionPadding = value.fractionPadding;
  if (
    fractionPadding !== "none" &&
    fractionPadding !== "thin" &&
    fractionPadding !== "standard" &&
    fractionPadding !== "wide"
  ) {
    throw new Error("分数留白设置不合法");
  }
  const exportSize = value.exportSize;
  if (
    typeof exportSize !== "string" ||
    !FORMULA_EXPORT_SIZES.some((item) => item.value === exportSize)
  ) {
    throw new Error("公式导出画布不合法");
  }
  return {
    version: 1,
    mode,
    latex: boundedString(value.latex, FORMULA_ASSET_MAX_SOURCE_CHARS, "LaTeX"),
    text: boundedString(value.text, FORMULA_ASSET_MAX_SOURCE_CHARS, "中文表达"),
    activeLatex: boundedString(value.activeLatex, FORMULA_ASSET_MAX_SOURCE_CHARS, "当前公式"),
    displayMode: value.displayMode === true,
    transparentPreview: value.transparentPreview !== false,
    latinShape,
    fractionPadding,
    cjkFont: boundedString(value.cjkFont, FORMULA_ASSET_MAX_FONT_STACK_CHARS, "字体栈"),
    fontSelection: boundedString(value.fontSelection, 512, "字体选择"),
    exportSize: exportSize as FormulaAssetState["exportSize"],
    renderedWidth: finitePositiveInteger(value.renderedWidth, "公式宽度"),
    renderedHeight: finitePositiveInteger(value.renderedHeight, "公式高度"),
  };
}

export function formulaAssetMeta(state: FormulaAssetState, filename: string) {
  return {
    formula: state,
    generated: true,
    filename: filename.slice(0, 255),
  };
}
