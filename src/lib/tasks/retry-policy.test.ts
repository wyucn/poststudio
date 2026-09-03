import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@/db";
import { ArkError } from "@/lib/ark/client";
import { CozeError } from "@/lib/coze/client";
import {
  automaticTaskRetryInfo,
  manualRetryBlockReason,
  manualRetryNeedsConfirmation,
  supportsTaskAutomaticRetry,
  supportsTaskManualRetry,
  taskAutomaticRetryReady,
  withAutomaticTaskRetry,
  withoutAutomaticTaskRetry,
} from "./retry";
import { automaticTaskRetryDecision } from "./retry-policy";

function task(patch: Partial<Task> = {}): Task {
  const now = new Date(0);
  return {
    id: "task-retry-test",
    projectId: "project-retry-test",
    userId: "user-retry-test",
    kind: "image",
    status: "running",
    modelKey: "seedream-5.0",
    inputJson: "{}",
    arkTaskId: null,
    outputAssetId: null,
    contextJson: null,
    error: null,
    errorCode: null,
    errorRequestId: null,
    deletedAt: null,
    usageJson: null,
    attemptCount: 1,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

test("manual retry covers image, music, TTS, and the existing video flow", () => {
  assert.equal(supportsTaskManualRetry(task({ kind: "image" })), true);
  assert.equal(supportsTaskManualRetry(task({ kind: "music" })), true);
  assert.equal(
    supportsTaskManualRetry(
      task({ kind: "audio", modelKey: "coze-tts" })
    ),
    true
  );
  assert.equal(
    supportsTaskManualRetry(
      task({ kind: "audio", modelKey: "modelscope-qwen3-tts" })
    ),
    true
  );
  assert.equal(supportsTaskManualRetry(task({ kind: "video" })), true);
  const contentRejected = task({
    kind: "video",
    status: "failed",
    errorCode: "ARK_CONTENT_REJECTED",
  });
  assert.equal(supportsTaskManualRetry(contentRejected), false);
  assert.match(manualRetryBlockReason(contentRejected) ?? "", /修改提示词或参考素材/);
  const requestRejected = task({
    kind: "video",
    status: "failed",
    errorCode: "ARK_REQUEST_REJECTED",
  });
  assert.equal(supportsTaskManualRetry(requestRejected), false);
  assert.match(manualRetryBlockReason(requestRejected) ?? "", /调整参数或参考素材/);
  assert.equal(
    supportsTaskManualRetry(
      task({ kind: "text", modelKey: "coze-audio-transcription" })
    ),
    false
  );
  assert.equal(supportsTaskAutomaticRetry(task({ kind: "video" })), false);
});

test("automatic retry accepts only explicitly safe transient failures", () => {
  const now = 1_000;
  const ark = automaticTaskRetryDecision(
    task(),
    new ArkError("方舟繁忙", 503, "ServiceUnavailable", true),
    now
  );
  assert.deepEqual(ark, {
    dueAt: 3_000,
    nextAttempt: 2,
    maxAttempts: 3,
    reasonCode: "ARK_PROVIDER_ERROR",
    message: "模型生成暂时失败，请稍后重试。",
  });

  const coze = automaticTaskRetryDecision(
    task({ kind: "music", modelKey: "coze-music", attemptCount: 2 }),
    new CozeError("Coze MCP 握手请求超时", "initialize", 504, undefined, true),
    now
  );
  assert.equal(coze?.dueAt, 11_000);
  assert.equal(coze?.nextAttempt, 3);

  const qwen = automaticTaskRetryDecision(
    task({ kind: "audio", modelKey: "modelscope-qwen3-tts" }),
    new Error("Cannot copy out of meta tensor; no data!"),
    now
  );
  assert.equal(qwen?.reasonCode, "QWEN_MODEL_LOAD_FAILED");
  assert.equal(qwen?.nextAttempt, 2);

  assert.equal(
    automaticTaskRetryDecision(
      task(),
      new ArkError("本地等待超时", 504, undefined, false),
      now
    ),
    null
  );
  assert.equal(
    automaticTaskRetryDecision(
      task({ kind: "music", modelKey: "coze-music" }),
      new CozeError("工具调用超时", "tool", 504, undefined, false),
      now
    ),
    null
  );
  assert.equal(
    automaticTaskRetryDecision(
      task({ attemptCount: 3 }),
      new ArkError("方舟繁忙", 503, undefined, true),
      now
    ),
    null
  );
});

test("automatic retry context survives polling and clears before execution", () => {
  const contextJson = withAutomaticTaskRetry(
    JSON.stringify({ slot: "image" }),
    {
      dueAt: 5_000,
      nextAttempt: 2,
      maxAttempts: 3,
      reasonCode: "ARK_RATE_LIMITED",
      message: "模型服务当前繁忙或额度受限，请稍后重试。",
    }
  );
  assert.equal(taskAutomaticRetryReady(contextJson, 4_999), false);
  assert.equal(taskAutomaticRetryReady(contextJson, 5_000), true);
  assert.equal(automaticTaskRetryInfo(contextJson)?.nextAttempt, 2);
  assert.equal(withoutAutomaticTaskRetry(contextJson), JSON.stringify({ slot: "image" }));
});

test("ambiguous failures require an explicit manual retry confirmation", () => {
  assert.equal(manualRetryNeedsConfirmation("COZE_TIMEOUT"), true);
  assert.equal(manualRetryNeedsConfirmation("ARK_PROVIDER_ERROR"), true);
  assert.equal(manualRetryNeedsConfirmation("ARK_RATE_LIMITED"), false);
  assert.equal(
    manualRetryNeedsConfirmation(null, "provider-task-already-created"),
    true
  );
  assert.equal(manualRetryNeedsConfirmation(null), false);
});
