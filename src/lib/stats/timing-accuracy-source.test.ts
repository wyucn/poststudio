import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("dashboard timing stays exact and keeps legacy fallbacks out of percentiles", async () => {
  const server = await readFile(
    path.join(process.cwd(), "src/lib/stats/dashboard.ts"),
    "utf8"
  );
  const client = await readFile(
    path.join(process.cwd(), "src/app/dashboard/dashboard-client.tsx"),
    "utf8"
  );
  const metrics = await readFile(
    path.join(process.cwd(), "src/lib/tasks/task-metrics.ts"),
    "utf8"
  );

  assert.match(server, /started_at IS NOT NULL[\s\S]*completed_at IS NOT NULL/);
  assert.match(server, /MAX\(0, started_at - created_at\)/);
  assert.match(server, /MAX\(0, completed_at - started_at\)/);
  assert.doesNotMatch(
    server,
    /COALESCE\(completed_at, updated_at\)[\s\S]*COALESCE\(started_at, created_at\)/
  );

  assert.match(client, /label="执行 P95"/);
  assert.match(client, /历史回退不进入耗时分位数/);
  assert.match(client, /排队 P50/);
  assert.match(client, /执行 P50/);
  assert.doesNotMatch(client, /端到端执行耗时/);

  assert.match(metrics, /task\.startedAt === null/);
  assert.match(metrics, /task\.completedAt === null/);
  assert.doesNotMatch(metrics, /task\.startedAt \?\? task\.createdAt/);
  assert.doesNotMatch(metrics, /task\.completedAt \?\? task\.updatedAt/);
});
