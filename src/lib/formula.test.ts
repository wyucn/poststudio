import assert from "node:assert/strict";
import test from "node:test";
import { applyFractionPadding, fitFormulaExportSize, normalizeFormulaText } from "./formula";

test("formula text normalization handles common Chinese notation", () => {
  assert.equal(normalizeFormulaText("x 平方加 y 平方等于 1"), "x ^2 + y ^2 = 1");
  assert.equal(normalizeFormulaText("a分之b"), "\\frac{b}{a}");
  assert.equal(normalizeFormulaText("根号下 x"), "\\sqrt{x}");
  assert.equal(normalizeFormulaText("sqrt(x+1)"), "\\sqrt{x+1}");
  assert.match(normalizeFormulaText("sin theta 趋于 0"), /\\sin \\theta/);
});

test("formula export fitting never upscales and stays within the target canvas", () => {
  assert.deepEqual(fitFormulaExportSize(200, 100, 1920, 1080), {
    width: 200,
    height: 100,
    scale: 1,
  });
  const fitted = fitFormulaExportSize(4000, 1000, 1920, 1080);
  assert.deepEqual(fitted, { width: 1920, height: 480, scale: 0.48 });
});

test("fraction padding adds measurable math kerns to numerator and denominator", () => {
  assert.equal(
    applyFractionPadding("\\frac{1}{3}", "wide"),
    "\\frac{\\mkern6mu1\\mkern6mu}{\\mkern6mu3\\mkern6mu}",
  );
  assert.equal(applyFractionPadding("\\frac{1}{3}", "none"), "\\frac{1}{3}");
});

test("fraction padding handles nested and alternate fraction commands", () => {
  assert.equal(
    applyFractionPadding("\\dfrac{a+\\frac{b}{c}}{d}", "standard"),
    "\\dfrac{\\mkern4mua+\\frac{\\mkern4mub\\mkern4mu}{\\mkern4muc\\mkern4mu}\\mkern4mu}{\\mkern4mud\\mkern4mu}",
  );
  assert.equal(
    applyFractionPadding("\\tfrac { x } \n { y }", "thin"),
    "\\tfrac {\\mkern2mu x \\mkern2mu} \n {\\mkern2mu y \\mkern2mu}",
  );
});
