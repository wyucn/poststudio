import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("project surfaces expose compact scanning contracts", async () => {
  const projects = await readFile(
    path.join(process.cwd(), "src/app/projects/projects-client.tsx"),
    "utf8"
  );
  const workspace = await readFile(
    path.join(process.cwd(), "src/components/workspace/workspace.tsx"),
    "utf8"
  );

  assert.match(projects, /data-project-density="compact"/);
  assert.match(projects, /grid gap-2 sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(projects, /line-clamp-1 text-xs leading-5/);
  assert.match(workspace, /data-project-switcher-item=\{project\.id\}/);
  assert.match(workspace, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(workspace, /min-h-\[52px\]/);
  assert.match(workspace, /data-project-switcher-list/);
  assert.match(workspace, /aria-label="只看收藏"/);
  assert.match(workspace, /project-switcher-search h-10/);
});
