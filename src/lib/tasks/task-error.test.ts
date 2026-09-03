import assert from "node:assert/strict";
import test from "node:test";
import { ArkError } from "@/lib/ark/client";
import { CozeError } from "@/lib/coze/client";
import { HttpError } from "@/lib/http-error";
import { classifyTaskFailure } from "./task-error";

const requestId = () => "trace-test";

test("expected task errors preserve safe actionable messages", () => {
  const failure = classifyTaskFailure(
    new HttpError(413, "参考音频超过 20 MB，请先裁剪", "REFERENCE_AUDIO_TOO_LARGE"),
    {},
    requestId
  );
  assert.equal(failure.userMessage, "参考音频超过 20 MB，请先裁剪");
  assert.equal(failure.code, "REFERENCE_AUDIO_TOO_LARGE");
  assert.equal(failure.requestId, "trace-test");
  assert.equal(failure.shouldLog, false);

  const musicLength = classifyTaskFailure(
    new HttpError(400, "歌词最多 700 字。", "MUSIC_TEXT_TOO_LONG"),
    {},
    requestId
  );
  assert.equal(musicLength.userMessage, "歌词最多 700 字。");
  assert.equal(musicLength.code, "MUSIC_TEXT_TOO_LONG");
  assert.equal(musicLength.shouldLog, false);
});

test("provider failures are converted to stable non-sensitive messages", () => {
  const auth = classifyTaskFailure(
    new ArkError("invalid api key sk-secret", 401, "Unauthorized"),
    {},
    requestId
  );
  assert.equal(auth.code, "ARK_AUTH_ERROR");
  assert.equal(auth.userMessage.includes("sk-secret"), false);

  const content = classifyTaskFailure(
    new ArkError("content moderation rejected", 400, "ContentRisk"),
    {},
    requestId
  );
  assert.equal(content.code, "ARK_CONTENT_REJECTED");
  assert.match(content.userMessage, /复用配置.*修改内容.*重新生成/);

  const coze = classifyTaskFailure(
    new Error('Coze MCP HTTP 500: {"token":"secret","url":"https://internal"}'),
    {},
    requestId
  );
  assert.equal(coze.code, "COZE_PROVIDER_ERROR");
  assert.equal(coze.userMessage.includes("secret"), false);

  const cozeRateLimit = classifyTaskFailure(
    new CozeError("Coze MCP HTTP 429", "initialize", 429, undefined, true),
    {},
    requestId
  );
  assert.equal(cozeRateLimit.code, "COZE_RATE_LIMITED");
  assert.match(cozeRateLimit.userMessage, /繁忙|额度/);
});

test("unknown task failures always include a trace id and generic message", () => {
  const failure = classifyTaskFailure(
    new Error("postgresql://admin:secret@internal/db"),
    {},
    requestId
  );
  assert.equal(failure.code, "TASK_FAILED");
  assert.equal(failure.requestId, "trace-test");
  assert.equal(failure.userMessage.includes("secret"), false);
});
