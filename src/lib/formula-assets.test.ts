import assert from "node:assert/strict";
import test from "node:test";
import {
  FORMULA_ASSET_MAX_SOURCE_CHARS,
  parseFormulaAssetState,
} from "./formula-assets";

const validState = {
  version: 1,
  mode: "latex",
  latex: "\\frac{a}{b}",
  text: "",
  activeLatex: "\\frac{a}{b}",
  displayMode: true,
  transparentPreview: true,
  latinShape: "italic",
  fractionPadding: "standard",
  cjkFont: '"方正兰亭圆简体", sans-serif',
  fontSelection: "preset:system-lanting-yuan",
  exportSize: "1920x1080",
  renderedWidth: 320,
  renderedHeight: 140,
};

test("formula asset metadata accepts editable state", () => {
  assert.deepEqual(parseFormulaAssetState(validState), validState);
});

test("formula asset metadata rejects oversized source and invalid canvas", () => {
  assert.throws(
    () => parseFormulaAssetState({ ...validState, latex: "x".repeat(FORMULA_ASSET_MAX_SOURCE_CHARS + 1) }),
    /LaTeX长度不合法/,
  );
  assert.throws(
    () => parseFormulaAssetState({ ...validState, renderedWidth: 0 }),
    /公式宽度不合法/,
  );
  assert.throws(
    () => parseFormulaAssetState({ ...validState, exportSize: "999x999" }),
    /公式导出画布不合法/,
  );
});
