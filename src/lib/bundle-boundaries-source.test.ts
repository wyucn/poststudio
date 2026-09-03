import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("heavy client capabilities stay behind route and interaction boundaries", async () => {
  const root = process.cwd();
  const [
    packageJson,
    tidalScene,
    dashboardClient,
    dashboardCharts,
    deferredCharts,
    createTab,
    lazyCreators,
    workspace,
    tasksTab,
    genHistory,
    lazyTaskDetails,
  ] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "src/components/tidal-scene.tsx"), "utf8"),
    readFile(path.join(root, "src/app/dashboard/dashboard-client.tsx"), "utf8"),
    readFile(path.join(root, "src/app/dashboard/dashboard-charts.tsx"), "utf8"),
    readFile(path.join(root, "src/app/dashboard/deferred-dashboard-charts.tsx"), "utf8"),
    readFile(path.join(root, "src/components/workspace/create-tab.tsx"), "utf8"),
    readFile(path.join(root, "src/components/workspace/create/lazy-creators.tsx"), "utf8"),
    readFile(path.join(root, "src/components/workspace/workspace.tsx"), "utf8"),
    readFile(path.join(root, "src/components/workspace/tasks-tab.tsx"), "utf8"),
    readFile(path.join(root, "src/components/workspace/gen-history.tsx"), "utf8"),
    readFile(path.join(root, "src/components/workspace/lazy-task-details-drawer.tsx"), "utf8"),
  ]);

  assert.match(packageJson, /"analyze": "next experimental-analyze --output"/);
  assert.match(packageJson, /"analyze:ui": "next experimental-analyze"/);

  assert.doesNotMatch(tidalScene, /import \* as THREE from "three"/);
  assert.match(tidalScene, /await import\("three"\)/);
  assert.match(tidalScene, /new IntersectionObserver/);
  assert.match(tidalScene, /new THREE\.Timer\(\)/);
  assert.doesNotMatch(tidalScene, /new THREE\.Clock\(\)/);

  assert.doesNotMatch(dashboardClient, /from "recharts"/);
  assert.doesNotMatch(dashboardClient, /<AreaChart|<PieChart/);
  assert.match(dashboardClient, /<DeferredDashboardCharts/);
  assert.match(dashboardCharts, /from "recharts"/);
  assert.match(deferredCharts, /dynamic<DashboardChartsProps>/);
  assert.match(deferredCharts, /new IntersectionObserver/);

  assert.match(createTab, /from "\.\/create\/lazy-creators"/);
  for (const creator of ["image", "video", "music", "tts", "formula"]) {
    assert.match(lazyCreators, new RegExp(`import\\("\\./${creator}-creator"\\)`));
  }
  assert.doesNotMatch(createTab, /from "\.\/create\/(?:image|video|music|tts|formula)-creator"/);

  assert.match(workspace, /import\("\.\/assets-tab"\)/);
  assert.match(workspace, /import\("\.\/tasks-tab"\)/);
  assert.doesNotMatch(workspace, /import \{ AssetsTab \} from "\.\/assets-tab"/);
  assert.doesNotMatch(workspace, /import \{ TasksTab \} from "\.\/tasks-tab"/);

  assert.match(lazyTaskDetails, /import\("\.\/task-details-drawer"\)/);
  assert.match(lazyTaskDetails, /lazy\(async \(\) =>/);
  assert.match(lazyTaskDetails, /<Suspense fallback=/);
  assert.match(lazyTaskDetails, /onOpenChange=\{onOpenChange\}/);
  assert.doesNotMatch(tasksTab, /from "\.\/task-details-drawer"/);
  assert.doesNotMatch(genHistory, /from "\.\/task-details-drawer"/);
  assert.match(tasksTab, /detailTaskId && \(/);
  assert.match(genHistory, /detailTaskId && \(/);
});
