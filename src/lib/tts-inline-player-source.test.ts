import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("TTS creator exposes the latest playable result in the main composer", async () => {
  const player = await readFile(
    path.join(
      process.cwd(),
      "src/components/workspace/tts-inline-player.tsx"
    ),
    "utf8"
  );
  const ttsCreator = await readFile(
    path.join(
      process.cwd(),
      "src/components/workspace/create/tts-creator.tsx"
    ),
    "utf8"
  );

  assert.match(player, /data-tts-inline-player/);
  assert.match(player, /aria-label="最新配音"/);
  assert.match(player, /aria-label="播放最新配音"/);
  assert.match(player, /preload="metadata"/);
  assert.match(player, /aria-label="复用最新配音参数"/);
  assert.match(player, /aria-label="下载最新配音"/);
  assert.match(ttsCreator, /latestSuccessfulCreatorTask\(ttsTasks, "audio"\)/);
  assert.match(
    ttsCreator,
    /<TtsInlinePlayer task=\{latestTtsTask\} onReuse=\{reuse\} \/>/
  );
});
