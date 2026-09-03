import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("worker and UI keep automatic and manual generation retries explicit", async () => {
  const worker = await readFile(
    path.join(process.cwd(), "src/lib/tasks/worker.ts"),
    "utf8"
  );
  const retryRoute = await readFile(
    path.join(process.cwd(), "src/app/api/tasks/[id]/retry/route.ts"),
    "utf8"
  );
  const history = await readFile(
    path.join(process.cwd(), "src/components/workspace/gen-history.tsx"),
    "utf8"
  );
  const taskList = await readFile(
    path.join(process.cwd(), "src/components/workspace/tasks-tab.tsx"),
    "utf8"
  );

  assert.match(worker, /automaticTaskRetryDecision/);
  assert.match(worker, /taskAutomaticRetryReady/);
  assert.match(retryRoute, /supportsTaskManualRetry/);
  assert.match(retryRoute, /TASK_RETRY_CONFIRMATION_REQUIRED/);
  assert.match(retryRoute, /confirmDuplicateSpend/);
  assert.doesNotMatch(retryRoute, /task\.kind !== "video"/);
  assert.match(history, /重新执行同一任务并保留尝试次数/);
  assert.match(history, /可能产生重复费用/);
  assert.match(history, /t\.status === "succeeded"/);
  assert.doesNotMatch(history, /t\.status !== "failed"/);
  assert.match(taskList, /supportsTaskManualRetry/);
  assert.match(taskList, /已自动安排第/);
});
