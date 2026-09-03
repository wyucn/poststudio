import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/http-error";
import {
  MAX_TRANSCRIPTION_SUBTITLE_BYTES,
  downloadSubtitleText,
  plainTextFromSubtitle,
  subtitleUrlFromResult,
} from "@/lib/transcription";

test("subtitle parser removes cue metadata while preserving editable lines", () => {
  const srt = `
1
00:00:00,360 --> 00:00:03,460
海豚创作工作台

2
00:00:03,500 --> 00:00:05,200
<b>语音转文字</b>测试
`;
  assert.equal(
    plainTextFromSubtitle(srt),
    "海豚创作工作台\n语音转文字测试"
  );

  const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
First line

00:00:01.000 --> 00:00:02.000
Second &amp; final`;
  assert.equal(plainTextFromSubtitle(vtt), "First line\nSecond & final");
});

test("transcription result URL supports direct and nested Coze payloads", () => {
  assert.equal(
    subtitleUrlFromResult({ url: "https://example.com/result.srt" }),
    "https://example.com/result.srt"
  );
  assert.equal(
    subtitleUrlFromResult({ data: { subtitle_url: "https://example.com/a.srt" } }),
    "https://example.com/a.srt"
  );
  assert.equal(subtitleUrlFromResult({ url: "javascript:alert(1)" }), null);
});

test("subtitle download validates provider response and size", async () => {
  const text = await downloadSubtitleText(
    "https://example.com/result.srt",
    async () => new Response("1\n00:00:00,000 --> 00:00:01,000\n测试")
  );
  assert.match(text, /测试/);

  await assert.rejects(
    () =>
      downloadSubtitleText(
        "https://example.com/large.srt",
        async () =>
          new Response("", {
            headers: {
              "content-length": String(
                MAX_TRANSCRIPTION_SUBTITLE_BYTES + 1
              ),
            },
          })
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === "TRANSCRIPTION_RESULT_TOO_LARGE"
  );
});
