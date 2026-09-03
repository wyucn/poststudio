import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("model distributions stay inside the cached stats snapshot", async () => {
  const server = await readFile(
    path.join(process.cwd(), "src/lib/stats/dashboard.ts"),
    "utf8"
  );
  const client = await readFile(
    path.join(process.cwd(), "src/app/dashboard/dashboard-client.tsx"),
    "utf8"
  );

  assert.match(server, /const MODEL_DISTRIBUTION_LIMIT = 5/);
  assert.equal(
    server.match(/loadModelDimensionMetrics\(database, context,/g)?.length,
    2
  );
  assert.match(server, /distribution:\s*\{\s*projects: buildModelDistribution/);

  const panel = client.match(
    /function ModelDistributionPanel[\s\S]*?function ModelTable/
  )?.[0];
  assert.ok(panel, "missing the model distribution panel");
  assert.match(panel, /data-model-distribution/);
  assert.match(
    panel,
    /const label = value === "project" \? "按项目" : "按成员"/
  );
  assert.match(
    panel,
    /aria-label=\{`\$\{label\}查看 \$\{model\.label\} 分布`\}/
  );
  assert.doesNotMatch(panel, /\bapi\(/);
  assert.doesNotMatch(client, /按项目\/成员的分布将在下一版展开/);
});
