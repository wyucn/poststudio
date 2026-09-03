import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("all native audio players use one global playback coordinator", async () => {
  const root = process.cwd();
  const [coordinator, providers, wave] = await Promise.all([
    readFile(
      path.join(root, "src", "components", "exclusive-audio-playback.tsx"),
      "utf8"
    ),
    readFile(path.join(root, "src", "app", "providers.tsx"), "utf8"),
    readFile(path.join(root, "src", "components", "workspace", "audio-wave.tsx"), "utf8"),
  ]);

  assert.match(coordinator, /addEventListener\("play", pauseOtherAudio, true\)/);
  assert.match(coordinator, /querySelectorAll\("audio"\)/);
  assert.match(coordinator, /audio\.pause\(\)/);
  assert.match(providers, /ExclusiveAudioPlayback/);
  assert.match(wave, /audio\.play\(\)\.catch/);
});
