import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readGlobalStyles } from "./test-helpers/global-styles";

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const red = channel(Number.parseInt(value.slice(0, 2), 16));
  const green = channel(Number.parseInt(value.slice(2, 4), 16));
  const blue = channel(Number.parseInt(value.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function token(source: string, name: string): string {
  const match = source.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`));
  assert.ok(match, `missing --${name}`);
  return match[1];
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      return entry.name.endsWith(".tsx") ? [fullPath] : [];
    })
  );
  return nested.flat();
}

test("semantic colors meet readable contrast on the primary surface", async () => {
  const globals = await readGlobalStyles();
  const background = token(globals, "background");

  for (const name of [
    "foreground",
    "muted-foreground",
    "success",
    "warning",
    "info",
    "favorite",
    "destructive",
  ]) {
    assert.ok(
      contrast(token(globals, name), background) >= 4.5,
      `${name} must meet WCAG AA contrast against background`
    );
  }

  assert.ok(contrast(token(globals, "ring"), background) >= 3);
  assert.ok(contrast(token(globals, "magenta"), "#ffffff") >= 4.5);
  assert.ok(contrast(token(globals, "favorite-muted"), "#000000") >= 3);

  for (const [foreground, surface] of [
    ["success", "success-muted"],
    ["warning", "warning-muted"],
    ["info", "info-muted"],
    ["favorite", "favorite-muted"],
    ["destructive", "destructive-muted"],
  ] as const) {
    assert.ok(
      contrast(token(globals, foreground), token(globals, surface)) >= 4.5,
      `${foreground} must meet WCAG AA contrast against ${surface}`
    );
  }
});

test("UI source uses semantic feedback instead of raw palette status colors", async () => {
  const roots = [
    path.join(process.cwd(), "src", "app"),
    path.join(process.cwd(), "src", "components"),
  ];
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const forbidden = [
    /(?:text|bg|border|ring)-(?:lime|emerald|amber|yellow|cyan)(?:-\d+|\/|\b)/g,
    /(?:加载|提交|保存|创建|生成)中\.\.\./g,
  ];
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${path.relative(process.cwd(), file)}:${line} ${match[0]}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("focus and asynchronous feedback primitives expose stable accessibility contracts", async () => {
  const globals = await readGlobalStyles();
  const button = await readFile(
    path.join(process.cwd(), "src", "components", "ui", "button.tsx"),
    "utf8"
  );
  const loading = await readFile(
    path.join(process.cwd(), "src", "components", "ui", "loading-state.tsx"),
    "utf8"
  );
  const status = await readFile(
    path.join(process.cwd(), "src", "components", "ui", "status-message.tsx"),
    "utf8"
  );

  assert.match(globals, /:focus-visible\s*\{/);
  const focusRingRule = globals.match(/\.focus-ring:focus-visible\s*\{([^}]*)\}/);
  assert.ok(focusRingRule, "missing the shared focus-ring rule");
  assert.match(focusRingRule[1], /outline:\s*3px solid/);
  assert.doesNotMatch(focusRingRule[1], /outline:\s*none/);
  assert.match(button, /aria-busy=\{loading \|\| undefined\}/);
  assert.match(button, /motion-reduce:animate-none/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-live="polite"/);
  assert.match(status, /role=\{tone === "danger" \? "alert" : "status"\}/);
});

test("dashboard reserves enough width for variable-length cost values", async () => {
  const dashboard = await readFile(
    path.join(process.cwd(), "src", "app", "dashboard", "dashboard-client.tsx"),
    "utf8"
  );

  assert.match(
    dashboard,
    /isAdmin \? "2xl:grid-cols-9" : "2xl:grid-cols-8"/
  );
  assert.match(
    dashboard,
    /<Card className=\{className\} data-kpi=\{label\}>/
  );
  assert.match(
    dashboard,
    /label="预估消耗"[\s\S]*?className="2xl:col-span-2"/
  );
  assert.match(dashboard, /label="结果使用"/);
  assert.doesNotMatch(dashboard, /采用率/);
});
