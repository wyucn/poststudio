import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("voice clone exposes instance health and capacity feedback", async () => {
  const [runtime, route, creator, handler, player, env] = await Promise.all([
    readFile(
      path.join(process.cwd(), "src/lib/modelscope/qwen-tts-runtime.ts"),
      "utf8"
    ),
    readFile(
      path.join(
        process.cwd(),
        "src/app/api/integrations/qwen-tts/health/route.ts"
      ),
      "utf8"
    ),
    readFile(
      path.join(
        process.cwd(),
        "src/components/workspace/create/tts-creator.tsx"
      ),
      "utf8"
    ),
    readFile(
      path.join(process.cwd(), "src/app/api/projects/[id]/generate/tts/route.ts"),
      "utf8"
    ),
    readFile(
      path.join(process.cwd(), "src/components/workspace/tts-inline-player.tsx"),
      "utf8"
    ),
    readFile(path.join(process.cwd(), ".env.example"), "utf8"),
  ]);

  assert.match(runtime, /MODELSCOPE_QWEN_TTS_SELF_HOSTED_URL/);
  assert.match(runtime, /checkQwenTtsInstanceHealth/);
  assert.match(runtime, /qwenTtsCapacityHint/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /modelscope-qwen3-tts/);
  assert.match(creator, /\/api\/integrations\/qwen-tts\/health/);
  assert.match(creator, /实验性公共创空间/);
  assert.match(creator, /声音克隆服务实例/);
  assert.match(creator, /capacity\.hint/);
  assert.match(handler, /QWEN_TTS_INSTANCE_NOT_CONFIGURED/);
  assert.match(handler, /instance:/);
  assert.match(player, /公共创空间（实验）/);
  assert.match(env, /MODELSCOPE_QWEN_TTS_SELF_HOSTED_URL/);
});
