import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("create tab stays a thin router over creator, stage, and settings modules", async () => {
  const workspaceRoot = path.join(
    process.cwd(),
    "src",
    "components",
    "workspace"
  );
  const createRoot = path.join(workspaceRoot, "create");
  const [entry, lazyCreators, shell, stage, settings, image, video, music, tts, formula] =
    await Promise.all([
      readFile(path.join(workspaceRoot, "create-tab.tsx"), "utf8"),
      readFile(path.join(createRoot, "lazy-creators.tsx"), "utf8"),
      readFile(path.join(createRoot, "creator-workspace.tsx"), "utf8"),
      readFile(path.join(createRoot, "creator-stage.tsx"), "utf8"),
      readFile(path.join(createRoot, "settings-flyout.tsx"), "utf8"),
      readFile(path.join(createRoot, "image-creator.tsx"), "utf8"),
      readFile(path.join(createRoot, "video-creator.tsx"), "utf8"),
      readFile(path.join(createRoot, "music-creator.tsx"), "utf8"),
      readFile(path.join(createRoot, "tts-creator.tsx"), "utf8"),
      readFile(path.join(createRoot, "formula-creator.tsx"), "utf8"),
    ]);

  assert.ok(entry.split(/\r?\n/).length <= 80, "create-tab.tsx must stay thin");
  assert.match(entry, /from "\.\/create\/lazy-creators"/);
  for (const moduleName of [
    "image-creator",
    "video-creator",
    "music-creator",
    "tts-creator",
    "formula-creator",
  ]) {
    assert.match(lazyCreators, new RegExp(`import\\("\\./${moduleName}"\\)`));
  }
  assert.match(lazyCreators, /from "next\/dynamic"/);
  assert.match(lazyCreators, /ssr: false/);
  assert.doesNotMatch(entry, /useMutation|useQuery|useState|StudioSettingsFlyout/);

  assert.match(shell, /export function CreatorWorkspaceShell/);
  assert.match(shell, /export function CreatorComposer/);
  assert.match(stage, /export function CreationWorkspace/);
  assert.match(stage, /StudioSettingsFlyout/);
  assert.match(settings, /export function StudioSettingsFlyout/);
  assert.match(image, /export function ImagePanel/);
  assert.match(video, /export function VideoPanel/);
  assert.match(music, /export function MusicPanel/);
  assert.match(tts, /export function TtsPanel/);
  assert.match(formula, /export function FormulaPanel/);
});

test("creator stages keep their empty canvas free of decorative type and orbit lines", async () => {
  const root = process.cwd();
  const [stage, video, creatorStyles, workspaceTheme] = await Promise.all([
    readFile(path.join(root, "src", "components", "workspace", "create", "creator-stage.tsx"), "utf8"),
    readFile(path.join(root, "src", "components", "workspace", "create", "video-creator.tsx"), "utf8"),
    readFile(path.join(root, "src", "app", "styles", "creator-layout.css"), "utf8"),
    readFile(path.join(root, "src", "app", "styles", "workspace-theme.css"), "utf8"),
  ]);

  assert.doesNotMatch(stage, /creation-stage-kinetic/);
  assert.doesNotMatch(video, /video-stage-(?:kinetic|vignette)/);
  assert.doesNotMatch(creatorStyles, /repeating-radial-gradient/);
  assert.doesNotMatch(workspaceTheme, /repeating-radial-gradient/);
});
