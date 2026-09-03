import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("creator and task details expose the billing rules users need before and after generation", async () => {
  const creator = (
    await Promise.all(
      ["image-creator.tsx", "video-creator.tsx"].map((file) =>
        readFile(
          path.join(process.cwd(), "src/components/workspace/create", file),
          "utf8"
        )
      )
    )
  ).join("\n");
  const details = await readFile(
    path.join(process.cwd(), "src/components/workspace/task-details-drawer.tsx"),
    "utf8"
  );

  assert.match(creator, /每月前 2 万次免费/);
  assert.match(creator, /最低 token 用量门槛/);
  assert.match(creator, /公开价约为在线的 50%/);

  assert.match(details, /计费拆分/);
  assert.match(details, /服务等级计价/);
  assert.match(details, /最低 token 规则/);
  assert.match(details, /公开标价/);
});
