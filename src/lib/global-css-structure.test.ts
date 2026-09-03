import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  globalStyleImports,
  readGlobalStyleManifest,
} from "./test-helpers/global-styles";

const expectedImports = [
  "./styles/tokens.css",
  "./styles/formula-fonts.css",
  "./styles/base.css",
  "./styles/creator-layout.css",
  "./styles/components.css",
  "./styles/entry-pages.css",
  "./styles/workspace-theme.css",
];

test("global CSS stays a small ordered layer manifest", async () => {
  const manifest = await readGlobalStyleManifest();
  const imports = await globalStyleImports();

  assert.deepEqual(imports, expectedImports);
  assert.equal(
    manifest.replace(/@import\s+["'][^"']+["']\s*;\s*/g, "").trim(),
    ""
  );
  assert.ok(manifest.split(/\r?\n/).length <= 10);
});

test("global style modules keep tokens, layout, components, and page themes separate", async () => {
  const appRoot = path.join(process.cwd(), "src", "app");
  const sources = new Map(
    await Promise.all(
      expectedImports.map(async (specifier) => [
        specifier,
        await readFile(path.resolve(appRoot, specifier), "utf8"),
      ] as const)
    )
  );

  assert.match(sources.get("./styles/tokens.css") ?? "", /:root\s*\{/);
  assert.match(sources.get("./styles/tokens.css") ?? "", /@theme inline\s*\{/);
  assert.match(sources.get("./styles/formula-fonts.css") ?? "", /STIX Two Text/);
  assert.match(sources.get("./styles/base.css") ?? "", /body\s*\{/);
  assert.match(sources.get("./styles/base.css") ?? "", /\.focus-ring:focus-visible/);
  assert.match(sources.get("./styles/creator-layout.css") ?? "", /\.creation-workspace\s*\{/);
  assert.match(sources.get("./styles/creator-layout.css") ?? "", /\.creation-stage\s*\{/);
  assert.match(sources.get("./styles/components.css") ?? "", /\.card-frame::before/);
  assert.match(sources.get("./styles/components.css") ?? "", /\.dialog-content\[data-state="open"\]/);
  assert.match(sources.get("./styles/components.css") ?? "", /\.material-thin\s*\{/);
  assert.match(sources.get("./styles/entry-pages.css") ?? "", /\.projects-page\s*\{/);
  assert.match(sources.get("./styles/entry-pages.css") ?? "", /\.auth-experience\s*\{/);
  assert.match(sources.get("./styles/workspace-theme.css") ?? "", /\.workspace-shell\s*\{/);
  assert.match(sources.get("./styles/workspace-theme.css") ?? "", /\.project-switcher-panel\s*\{/);

  for (const [specifier, source] of sources) {
    assert.ok(
      source.split(/\r?\n/).length <= 1500,
      `${specifier} must remain smaller than the former global stylesheet`
    );
  }
});
