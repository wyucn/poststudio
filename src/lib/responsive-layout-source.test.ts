import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readGlobalStyles } from "./test-helpers/global-styles";

test("creator workspaces expose explicit desktop, tablet, and mobile modes", async () => {
  const creatorWorkspace = await readFile(
    path.join(
      process.cwd(),
      "src",
      "components",
      "workspace",
      "create",
      "creator-workspace.tsx"
    ),
    "utf8"
  );
  const workspace = await readFile(
    path.join(process.cwd(), "src", "components", "workspace", "workspace.tsx"),
    "utf8"
  );
  const globals = await readGlobalStyles();

  assert.match(creatorWorkspace, /min-\[1100px\]:grid-cols-/);
  assert.match(creatorWorkspace, /creator-history-trigger/);
  assert.match(creatorWorkspace, /creator-history-dialog/);
  assert.match(creatorWorkspace, /打开\$\{label\}历史记录/);
  assert.match(creatorWorkspace, /查看、复用或管理最近的生成任务与结果/);

  assert.match(workspace, /data-workspace-shell/);
  assert.match(workspace, /data-workspace-navigation/);
  assert.match(workspace, /data-workspace-main/);
  assert.match(workspace, /workspace-creation-nav/);
  assert.match(workspace, /workspace-project-nav/);
  assert.match(workspace, /workspace-utility-nav/);

  assert.match(
    globals,
    /@media \(min-width: 1100px\) \{[\s\S]*?\.creation-workspace \{[\s\S]*?grid-template-columns:/
  );
  assert.match(
    globals,
    /@media \(max-width: 767px\) \{[\s\S]*?\.workspace-shell \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?grid-template-rows: minmax\(0, 1fr\) calc\(64px \+ env\(safe-area-inset-bottom\)\) !important;/
  );
  assert.match(
    globals,
    /\.workspace-rail \{[\s\S]*?overflow-x: auto;[\s\S]*?touch-action: pan-x;/
  );
  assert.match(
    globals,
    /\.project-switcher-panel \{[\s\S]*?width: min\(360px, calc\(100vw - 1rem\)\) !important;/
  );
  assert.match(globals, /\.creation-stage-description \{\s*display: none;/);
});
