import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("generation, UI, and admin routes share the managed runtime catalog", async () => {
  const root = process.cwd();
  const files = await Promise.all(
    [
      ["imageRoute", "src/app/api/projects/[id]/generate/image/route.ts"],
      ["videoRoute", "src/app/api/projects/[id]/generate/video/route.ts"],
      ["modelSelect", "src/components/workspace/model-select.tsx"],
      ["cozeClient", "src/lib/coze/client.ts"],
      ["adminRoute", "src/app/api/admin/models/route.ts"],
      ["adminPage", "src/app/dashboard/models/model-config-client.tsx"],
    ].map(async ([key, file]) => [
      key,
      await readFile(path.join(root, ...file.split("/")), "utf8"),
    ])
  );
  const source = Object.fromEntries(files) as Record<string, string>;

  assert.match(source.imageRoute, /runtimeImageModel/);
  assert.match(source.videoRoute, /runtimeVideoModel/);
  assert.match(source.modelSelect, /useManagedModelCatalog/);
  assert.match(source.cozeClient, /managedCozeEndpoint/);
  assert.match(source.adminRoute, /requireAdmin/);
  assert.match(source.adminPage, /能力配置 JSON/);
  assert.match(source.adminPage, /密钥仍只从服务器环境变量读取/);
});
