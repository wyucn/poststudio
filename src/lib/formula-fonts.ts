export type FormulaFontSource = "bundled" | "local";

export type FormulaFontFormat = "woff2" | "woff" | "opentype" | "truetype";

export type FormulaFontAsset = {
  id: string;
  family: string;
  source: FormulaFontSource;
  dataUrl: string;
  format: FormulaFontFormat;
  weight?: string;
  style?: string;
};

export type BundledFormulaFont = {
  id: string;
  family: string;
  url: string;
  mimeType: string;
  format: FormulaFontFormat;
  weight: string;
  style: string;
};

export type FormulaFontPreset = {
  id: string;
  label: string;
  family: string;
  source: "system" | "bundled";
  note: string;
};

export const STIX_TWO_TEXT_FAMILY = "STIX Two Text";
export const STIX_TWO_MATH_FAMILY = "STIX Two Math";
export const FZ_LANTING_YUAN_FAMILY = "方正兰亭圆简体";

export const DEFAULT_FORMULA_FONT_STACK = [
  `"${FZ_LANTING_YUAN_FAMILY}"`,
  '"FZLanTingYuanS-R-GB"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
  '"STIX Two Text"',
  "sans-serif",
].join(", ");

/**
 * Fonts that can be selected before the user grants Local Font Access.
 * System presets are references only; they are embedded in an export only
 * after the browser has returned the actual local font bytes.
 */
export const FORMULA_FONT_PRESETS: FormulaFontPreset[] = [
  {
    id: "system-lanting-yuan",
    label: "方正兰亭圆简体",
    family: DEFAULT_FORMULA_FONT_STACK,
    source: "system",
    note: "系统字体·读取后可内嵌",
  },
  {
    id: "system-yahei",
    label: "微软雅黑",
    family: '"Microsoft YaHei", "微软雅黑", sans-serif',
    source: "system",
    note: "系统字体",
  },
  {
    id: "system-noto-sans-cjk",
    label: "思源黑体 / Noto Sans CJK",
    family: '"Noto Sans CJK SC", "Source Han Sans SC", "思源黑体", sans-serif',
    source: "system",
    note: "系统字体",
  },
  {
    id: "system-sim-sun",
    label: "宋体",
    family: '"SimSun", "宋体", serif',
    source: "system",
    note: "系统字体",
  },
  {
    id: "system-sim-hei",
    label: "黑体",
    family: '"SimHei", "黑体", sans-serif',
    source: "system",
    note: "系统字体",
  },
  {
    id: "bundled-stix-text",
    label: STIX_TWO_TEXT_FAMILY,
    family: `"${STIX_TWO_TEXT_FAMILY}", sans-serif`,
    source: "bundled",
    note: "内置字体·可直接内嵌",
  },
  {
    id: "bundled-stix-math",
    label: STIX_TWO_MATH_FAMILY,
    family: `"${STIX_TWO_MATH_FAMILY}", "${STIX_TWO_TEXT_FAMILY}", sans-serif`,
    source: "bundled",
    note: "内置字体·数学字形",
  },
];

/**
 * Fonts that can be redistributed with the application.  The MathJax STIX2
 * bundle contains the actual mathematical outlines; these font files cover
 * text nodes and keep exported SVGs usable when they are opened elsewhere.
 */
export const BUNDLED_FORMULA_FONTS: BundledFormulaFont[] = [
  {
    id: "stix-two-text-400-normal",
    family: STIX_TWO_TEXT_FAMILY,
    url: "/vendor/formula-fonts/stix-two-text-400-normal.woff2",
    mimeType: "font/woff2",
    format: "woff2",
    weight: "400",
    style: "normal",
  },
  {
    id: "stix-two-math-400-normal",
    family: STIX_TWO_MATH_FAMILY,
    url: "/vendor/formula-fonts/stix-two-math-400-normal.woff2",
    mimeType: "font/woff2",
    format: "woff2",
    weight: "400",
    style: "normal",
  },
];

export function normalizeFontFamilyStack(value: string) {
  const result: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;

  for (const character of value) {
    if (quote) {
      token += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      token += character;
      continue;
    }
    if (character === ",") {
      const normalized = token.trim();
      if (normalized) result.push(normalized);
      token = "";
      continue;
    }
    token += character;
  }

  const last = token.trim();
  if (last) result.push(last);
  return result;
}

export function quoteFontFamily(family: string) {
  const value = family
    .trim()
    .replace(/[\r\n]/gu, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', "\\\"");
  return `"${value}"`;
}

export function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function buildFontFaceCss(asset: FormulaFontAsset) {
  const descriptors = [
    `font-family:${quoteFontFamily(asset.family)}`,
    `src:url(${JSON.stringify(asset.dataUrl)}) format(${JSON.stringify(asset.format)})`,
  ];
  if (asset.weight) descriptors.push(`font-weight:${asset.weight}`);
  if (asset.style) descriptors.push(`font-style:${asset.style}`);
  return `@font-face{${descriptors.join(";")};}`;
}
