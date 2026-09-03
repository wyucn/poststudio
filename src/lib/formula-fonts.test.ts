import assert from "node:assert/strict";
import test from "node:test";
import {
  arrayBufferToDataUrl,
  buildFontFaceCss,
  FORMULA_FONT_PRESETS,
  normalizeFontFamilyStack,
  quoteFontFamily,
} from "./formula-fonts";

test("font family stacks preserve quoted names and discard empty entries", () => {
  assert.deepEqual(
    normalizeFontFamilyStack('  "方正兰亭圆简体", Microsoft YaHei, , sans-serif  '),
    ['"方正兰亭圆简体"', "Microsoft YaHei", "sans-serif"],
  );
  assert.equal(quoteFontFamily('STIX Two Text'), '"STIX Two Text"');
  assert.equal(quoteFontFamily('A"B'), '"A\\"B"');
  assert.equal(quoteFontFamily("A\\B\nC"), '"A\\\\B C"');
});

test("font assets can be serialized as self-contained SVG font faces", () => {
  const dataUrl = arrayBufferToDataUrl(new Uint8Array([0, 1, 2, 255]).buffer, "font/woff2");
  assert.match(dataUrl, /^data:font\/woff2;base64,/);
  const css = buildFontFaceCss({
    id: "test",
    family: "STIX Two Text",
    source: "bundled",
    dataUrl,
    format: "woff2",
    weight: "400",
    style: "normal",
  });
  assert.match(css, /@font-face/);
  assert.match(css, /STIX Two Text/);
  assert.match(css, /data:font\/woff2;base64/);
});

test("formula font presets expose selectable system and bundled choices", () => {
  const ids = FORMULA_FONT_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(FORMULA_FONT_PRESETS.some((preset) => preset.label === "方正兰亭圆简体" && preset.source === "system"));
  assert.ok(FORMULA_FONT_PRESETS.some((preset) => preset.label === "STIX Two Text" && preset.source === "bundled"));
  assert.ok(FORMULA_FONT_PRESETS.some((preset) => preset.label === "STIX Two Math" && preset.source === "bundled"));
  assert.ok(FORMULA_FONT_PRESETS.every((preset) => preset.family.trim() && preset.note.trim()));
});
