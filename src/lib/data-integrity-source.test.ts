import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("data integrity audit stays scheduled, visible, and manually runnable", async () => {
  const root = process.cwd();
  const [instrumentation, dashboard, packageJson, assetRoute, command] =
    await Promise.all([
      readFile(path.join(root, "src", "instrumentation.ts"), "utf8"),
      readFile(
        path.join(root, "src", "app", "dashboard", "dashboard-client.tsx"),
        "utf8"
      ),
      readFile(path.join(root, "package.json"), "utf8"),
      readFile(
        path.join(root, "src", "app", "api", "assets", "[id]", "route.ts"),
        "utf8"
      ),
      readFile(
        path.join(root, "scripts", "check-data-integrity.ts"),
        "utf8"
      ),
    ]);

  assert.match(instrumentation, /startDataIntegrityScheduler/);
  assert.match(dashboard, /数据库一致性巡检/);
  assert.match(dashboard, /repairedDanglingTaskOutputs/);
  assert.match(packageJson, /check:data-integrity/);
  assert.match(command, /--repair/);
  assert.doesNotMatch(command, /runMigrations/);
  assert.match(assetRoute, /outputAssetId:\s*null/);
  assert.ok(
    assetRoute.indexOf("outputAssetId: null") <
      assetRoute.indexOf("tx.delete(assets)")
  );
});
