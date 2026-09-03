import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("stats route delegates SQL aggregation, caching, and paged rankings", async () => {
  const root = process.cwd();
  const [route, loader, dashboard] = await Promise.all([
    readFile(path.join(root, "src", "app", "api", "stats", "route.ts"), "utf8"),
    readFile(path.join(root, "src", "lib", "stats", "dashboard.ts"), "utf8"),
    readFile(path.join(root, "src", "app", "dashboard", "dashboard-client.tsx"), "utf8"),
  ]);

  assert.match(route, /TtlPromiseCache/);
  assert.match(route, /X-Stats-Cache/);
  assert.match(route, /loadDashboardStatsRankings/);
  assert.doesNotMatch(route, /\.all\(\)\s*\.filter/);

  assert.match(loader, /GROUP BY/);
  assert.match(loader, /ROW_NUMBER\(\) OVER/);
  assert.match(loader, /LIMIT \$\{pageInfo\.pageSize\} OFFSET/);
  assert.match(loader, /project_members_user_project_idx|scopedTasksCte/);

  assert.match(dashboard, /projectPage/);
  assert.match(dashboard, /userPage/);
  assert.match(dashboard, /上一页/);
  assert.match(dashboard, /下一页/);
});
