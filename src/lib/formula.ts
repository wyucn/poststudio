export type FormulaInputMode = "latex" | "text";

export type FormulaSnippet = {
  label: string;
  code: string;
  note: string;
};

export type FormulaSnippetGroup = {
  title: string;
  items: FormulaSnippet[];
};

export const FORMULA_FRACTION_PADDING_OPTIONS = [
  { value: "none", label: "不额外增加", tex: "" },
  { value: "thin", label: "窄", tex: "\\mkern2mu" },
  { value: "standard", label: "标准", tex: "\\mkern4mu" },
  { value: "wide", label: "更宽", tex: "\\mkern6mu" },
] as const;

export type FormulaFractionPadding =
  (typeof FORMULA_FRACTION_PADDING_OPTIONS)[number]["value"];

/**
 * The formula generator intentionally keeps the translation layer small and
 * predictable. It is a convenience for common Chinese/linear notation, not a
 * natural-language theorem prover.
 */
export function normalizeFormulaText(source: string): string {
  let text = source.trim();
  if (!text) return "";

  const phraseReplacements: Array<[RegExp, string]> = [
    [/平方/g, "^2"],
    [/立方/g, "^3"],
    [/四次方/g, "^4"],
    [/大于等于|≥/g, " \\ge "],
    [/小于等于|≤/g, " \\le "],
    [/不等于|≠/g, " \\ne "],
    [/约等于|≈/g, " \\approx "],
    [/趋于|趋近于/g, " \\to "],
    [/加上|加/g, " + "],
    [/减去|减/g, " - "],
    [/乘以|乘/g, " \\times "],
    [/除以/g, " / "],
    [/等于/g, " = "],
    [/角度/g, "^{\\circ}"],
    [/无穷/g, "\\infty"],
  ];

  for (const [pattern, replacement] of phraseReplacements) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(
    /([A-Za-z0-9]+)\s*分之\s*([A-Za-z0-9]+)/g,
    "\\frac{$2}{$1}"
  );
  text = text.replace(/根号下?\s*([A-Za-z0-9]+)/g, "\\sqrt{$1}");
  text = text.replace(
    /([A-Za-z0-9]+)的([A-Za-z0-9]+)次方/g,
    "$1^{$2}"
  );
  text = text.replace(
    /frac\s*\(([^,]+),([^)]+)\)/g,
    "\\frac{$1}{$2}"
  );
  text = replaceSqrtFunctions(text);

  const commandReplacements: Array<[RegExp, string]> = [
    [/(?<!\\)\btheta\b/gi, "\\theta"],
    [/(?<!\\)\balpha\b/gi, "\\alpha"],
    [/(?<!\\)\bbeta\b/gi, "\\beta"],
    [/(?<!\\)\bgamma\b/gi, "\\gamma"],
    [/(?<!\\)\bdelta\b/gi, "\\delta"],
    [/(?<!\\)\blambda\b/gi, "\\lambda"],
    [/(?<!\\)\bpi\b/gi, "\\pi"],
    [/(?<!\\)\bsigma\b/gi, "\\sigma"],
    [/(?<!\\)\bomega\b/gi, "\\omega"],
    [/(?<!\\)\bsin\b/gi, "\\sin"],
    [/(?<!\\)\bcos\b/gi, "\\cos"],
    [/(?<!\\)\btan\b/gi, "\\tan"],
    [/(?<!\\)\bln\b/gi, "\\ln"],
    [/(?<!\\)\blog\b/gi, "\\log"],
    [/(?<!\\)\bint\b/gi, "\\int"],
    [/(?<!\\)\bsum\b/gi, "\\sum"],
    [/(?<!\\)\blim\b/gi, "\\lim"],
    [/(?<!\\)\bsqrt\b/gi, "\\sqrt"],
  ];

  for (const [pattern, replacement] of commandReplacements) {
    text = text.replace(pattern, replacement);
  }

  return text
    .replace(/<=/g, " \\le ")
    .replace(/>=/g, " \\ge ")
    .replace(/!=/g, " \\ne ")
    .replace(/\*/g, " \\cdot ")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function replaceSqrtFunctions(input: string): string {
  let result = input;
  while (result.includes("sqrt(")) {
    const start = result.indexOf("sqrt(");
    const contentStart = start + 5;
    let depth = 1;
    let cursor = contentStart;

    while (cursor < result.length && depth > 0) {
      const current = result[cursor];
      if (current === "(") depth += 1;
      if (current === ")") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) break;

    const body = result.slice(contentStart, cursor - 1);
    const sqrtCommand = "\\sqrt";
    result = `${result.slice(0, start)}${sqrtCommand}{${body}}${result.slice(cursor)}`;
  }
  return result;
}

type FormulaGroup = { content: string; end: number };

function readFormulaGroup(source: string, start: number): FormulaGroup | null {
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      // Escaped braces (\\{ / \\}) are literal characters, not group
      // delimiters. Leave the opening brace of commands such as \\unicode{...}
      // for the outer scanner to process on the next iteration.
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { content: source.slice(start, index + 1), end: index };
      }
    }
  }
  return null;
}

function hasOddBackslashPrefix(source: string, index: number) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function fractionCommandAt(source: string, index: number) {
  if (source[index] !== "\\" || hasOddBackslashPrefix(source, index)) return null;
  for (const command of ["\\dfrac", "\\tfrac", "\\frac"] as const) {
    const end = index + command.length;
    if (
      source.startsWith(command, index) &&
      (end >= source.length || !/[A-Za-z]/u.test(source[end]))
    ) {
      return command;
    }
  }
  return null;
}

function fractionPaddingTex(padding: FormulaFractionPadding) {
  return FORMULA_FRACTION_PADDING_OPTIONS.find((option) => option.value === padding)?.tex ?? "";
}

/**
 * Adds real math-mode kerns to the two sides of every supported fraction
 * argument. Plain `\\,`/`\\:`/`\\;` spacing inside a fraction can be
 * normalized away by MathJax's fraction layout, so it is not a reliable way
 * to expose a visible fraction-padding control.
 */
export function applyFractionPadding(source: string, padding: FormulaFractionPadding) {
  const spacing = fractionPaddingTex(padding);
  if (!source || !spacing) return source;

  let result = "";
  let index = 0;
  while (index < source.length) {
    const command = fractionCommandAt(source, index);
    if (!command) {
      result += source[index];
      index += 1;
      continue;
    }

    const commandEnd = index + command.length;
    let numeratorStart = commandEnd;
    while (numeratorStart < source.length && /\s/u.test(source[numeratorStart])) {
      numeratorStart += 1;
    }
    const numerator = readFormulaGroup(source, numeratorStart);
    if (!numerator) {
      // Keep malformed input intact and continue scanning after the command;
      // a later valid nested fraction can still be transformed.
      result += source.slice(index, commandEnd);
      index = commandEnd;
      continue;
    }

    let denominatorStart = numerator.end + 1;
    while (denominatorStart < source.length && /\s/u.test(source[denominatorStart])) {
      denominatorStart += 1;
    }
    const denominator = readFormulaGroup(source, denominatorStart);
    if (!denominator) {
      result += source.slice(index, numerator.end + 1);
      index = numerator.end + 1;
      continue;
    }

    const numeratorBody = applyFractionPadding(
      numerator.content.slice(1, -1),
      padding,
    );
    const denominatorBody = applyFractionPadding(
      denominator.content.slice(1, -1),
      padding,
    );
    result += source.slice(index, numeratorStart);
    result += `{${spacing}${numeratorBody}${spacing}}`;
    result += source.slice(numerator.end + 1, denominatorStart);
    result += `{${spacing}${denominatorBody}${spacing}}`;
    index = denominator.end + 1;
  }
  return result;
}

export function fitFormulaExportSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number; scale: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
    scale,
  };
}

export const FORMULA_EXPORT_SIZES = [
  { value: "640x360", label: "360p · 640 × 360", width: 640, height: 360 },
  { value: "960x540", label: "540p · 960 × 540", width: 960, height: 540 },
  { value: "1280x720", label: "720p · 1280 × 720", width: 1280, height: 720 },
  { value: "1920x1080", label: "1080p · 1920 × 1080", width: 1920, height: 1080 },
] as const;

export const FORMULA_SNIPPET_GROUPS: FormulaSnippetGroup[] = [
  {
    title: "基础结构",
    items: [
      { label: "上标", code: "x^2", note: "平方、n 次方" },
      { label: "下标", code: "a_n", note: "数列、下标变量" },
      { label: "上下标", code: "x_i^2", note: "同时写上下角标" },
      { label: "括号放大", code: "\\left( \\frac{a}{b} \\right)", note: "自动伸缩括号" },
      { label: "绝对值", code: "\\left| x \\right|", note: "绝对值与范数" },
      { label: "分数", code: "\\frac{a+b}{c+d}", note: "最常见结构" },
    ],
  },
  {
    title: "根号与幂",
    items: [
      { label: "平方根", code: "\\sqrt{x+y}", note: "普通根号" },
      { label: "n 次根", code: "\\sqrt[n]{x}", note: "带阶数根号" },
      { label: "复杂上标", code: "x^{n+1}", note: "多字符上标" },
      { label: "指数函数", code: "e^{-\\lambda t}", note: "指数写法" },
      { label: "倒数", code: "x^{-1}", note: "负指数" },
      { label: "分之", code: "\\frac{1}{x}", note: "对应“x 分之 1”" },
    ],
  },
  {
    title: "求和、积分与极限",
    items: [
      { label: "求和", code: "\\sum_{i=1}^{n} i", note: "上下限求和" },
      { label: "连乘", code: "\\prod_{k=1}^{n} a_k", note: "乘积符号" },
      { label: "定积分", code: "\\int_a^b f(x)\\,dx", note: "积分上下限" },
      { label: "二重积分", code: "\\iint_D f(x,y)\\,dA", note: "多重积分" },
      { label: "极限", code: "\\lim_{x \\to 0} \\frac{\\sin x}{x}", note: "趋近写法" },
      { label: "无穷级数", code: "\\sum_{n=0}^{\\infty} x^n", note: "无穷级数" },
    ],
  },
  {
    title: "函数与符号",
    items: [
      { label: "正弦", code: "\\sin \\theta", note: "三角函数" },
      { label: "对数", code: "\\log_a b", note: "底数对数" },
      { label: "偏导", code: "\\frac{\\partial f}{\\partial x}", note: "偏微分" },
      { label: "导数", code: "\\frac{d}{dx}x^2", note: "普通导数" },
      { label: "向量", code: "\\vec{v}", note: "向量箭头" },
      { label: "帽子/点", code: "\\hat{x},\\ \\dot{x}", note: "统计与物理" },
    ],
  },
  {
    title: "矩阵与方程组",
    items: [
      { label: "矩阵", code: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", note: "方括号矩阵" },
      { label: "行列式", code: "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}", note: "行列式" },
      { label: "分段函数", code: "f(x)=\\begin{cases} x^2,&x>0\\\\0,&x=0\\\\-x,&x<0 \\end{cases}", note: "cases 环境" },
      { label: "对齐公式", code: "\\begin{aligned} a+b&=c\\\\ d+e&=f \\end{aligned}", note: "多行对齐" },
      { label: "联立方程", code: "\\begin{cases} x+y=1\\\\ x-y=3 \\end{cases}", note: "方程组" },
      { label: "省略号", code: "a_1,a_2,\\ldots,a_n", note: "序列写法" },
    ],
  },
];

export const DEFAULT_FORMULA_LATEX = "\\int_0^1 x^2\\,dx = \\frac{1}{3}";
export const DEFAULT_FORMULA_TEXT = "x 平方加 y 平方等于 1";
