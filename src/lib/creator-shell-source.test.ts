import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readGlobalStyles } from "./test-helpers/global-styles";

test("all creators share the same workspace and composer primitives", async () => {
  const createRoot = path.join(
    process.cwd(),
    "src",
    "components",
    "workspace",
    "create"
  );
  const [creatorWorkspace, ...creatorPanels] = await Promise.all([
    readFile(path.join(createRoot, "creator-workspace.tsx"), "utf8"),
    ...["image-creator.tsx", "video-creator.tsx", "music-creator.tsx", "tts-creator.tsx", "formula-creator.tsx"].map(
      (file) => readFile(path.join(createRoot, file), "utf8")
    ),
  ]);
  const creatorSources = creatorPanels.join("\n");
  const globals = await readGlobalStyles();

  assert.match(
    creatorWorkspace,
    /type CreatorWorkspaceKind = "image" \| "video" \| "music" \| "tts" \| "formula";/
  );
  assert.match(creatorWorkspace, /function CreatorWorkspaceShell\(/);
  assert.match(creatorWorkspace, /data-creator-workspace=\{kind\}/);
  assert.match(creatorWorkspace, /function CreatorComposer\(/);
  assert.match(creatorWorkspace, /data-creator-composer=\{kind\}/);

  for (const kind of ["image", "video", "music", "tts", "formula"]) {
    assert.match(
      creatorSources,
      new RegExp(`<CreatorComposer kind="${kind}">`),
      `${kind} creator must use CreatorComposer`
    );
  }

  assert.doesNotMatch(creatorSources, /className="video-workspace/);
  assert.doesNotMatch(creatorSources, /className="video-composer/);
  assert.doesNotMatch(globals, /\.video-workspace\b/);
  assert.doesNotMatch(globals, /\.video-composer\b/);
  assert.match(
    globals,
    /\.creation-composer-card\.is-compact\[data-creator-composer="video"\]/
  );
});
