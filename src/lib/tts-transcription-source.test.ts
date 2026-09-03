import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("voice clone reference audio uses a cached background transcription flow", async () => {
  const [route, handlers, creator] = await Promise.all([
    readFile(
      path.join(
        process.cwd(),
        "src/app/api/assets/[id]/transcript/route.ts"
      ),
      "utf8"
    ),
    readFile(
      path.join(process.cwd(), "src/lib/tasks/basic-handlers.ts"),
      "utf8"
    ),
    readFile(
      path.join(
        process.cwd(),
        "src/components/workspace/create/tts-creator.tsx"
      ),
      "utf8"
    ),
  ]);

  assert.match(route, /requireProjectViewer\(asset\.projectId\)/);
  assert.match(route, /requireProjectEditor\(asset\.projectId\)/);
  assert.match(route, /kind: "text"/);
  assert.match(route, /AUDIO_TRANSCRIPTION_MODEL_KEY/);
  assert.match(route, /existing\?\.sourceText/);
  assert.match(route, /correctedText: body\.text/);

  assert.match(handlers, /"audio_to_subtitle"/);
  assert.match(handlers, /bridgeReferenceAudio/);
  assert.match(handlers, /plainTextFromSubtitle/);
  assert.match(handlers, /subtitleSrt/);

  assert.match(creator, /"asset-transcript"/);
  assert.match(creator, /refetchInterval/);
  assert.match(creator, /"语音转文字"/);
  assert.match(creator, /<Save \/> 保存校对/);
  assert.match(creator, /转写与校对/);
  assert.match(creator, /readOnly=\{!canEdit\}/);
});
