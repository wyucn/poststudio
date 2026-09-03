import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readGlobalStyles } from "./test-helpers/global-styles";

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      return /\.(?:css|tsx)$/.test(entry.name) ? [fullPath] : [];
    })
  );
  return nested.flat();
}

test("typography tokens keep body and supporting copy on the product baseline", async () => {
  const globals = await readGlobalStyles();

  assert.match(globals, /--font-size-body:\s*1rem;/);
  assert.match(globals, /--font-size-control:\s*0\.9375rem;/);
  assert.match(globals, /--font-size-secondary:\s*0\.875rem;/);
  assert.match(globals, /--font-size-compact:\s*0\.8125rem;/);
  assert.match(globals, /--font-size-micro:\s*0\.625rem;/);
  assert.match(globals, /--text-xs:\s*var\(--font-size-compact\);/);
  assert.match(globals, /--text-ui:\s*var\(--font-size-control\);/);
  assert.match(globals, /--text-micro:\s*var\(--font-size-micro\);/);
});

test("Chinese typography uses the native fallback stack without bundled MiSans assets", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const [layout, tokens] = await Promise.all([
    readFile(path.join(appRoot, "layout.tsx"), "utf8"),
    readFile(path.join(appRoot, "styles", "tokens.css"), "utf8"),
  ]);

  assert.doesNotMatch(layout, /fonts\/misans|MiSans/);
  assert.doesNotMatch(tokens, /MiSans/);
  assert.match(tokens, /"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC"/);
  await assert.rejects(access(path.join(appRoot, "fonts", "misans")));
});

test("readable UI copy does not bypass typography tokens with 8–12px literals", async () => {
  const roots = [
    path.join(process.cwd(), "src", "app"),
    path.join(process.cwd(), "src", "components"),
  ];
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const forbidden = [
    /text-\[(?:[89]|1[0-2])px\]/g,
    /font-size:\s*(?:[89]|1[0-2])px\b/g,
    /fontSize:\s*(?:[89]|1[0-2])\b/g,
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
