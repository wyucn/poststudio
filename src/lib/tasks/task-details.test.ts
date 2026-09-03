import assert from "node:assert/strict";
import test from "node:test";
import type { AssetDto, TaskDto } from "@/lib/client/types";
import { buildTaskDetailSnapshot } from "./task-details";

function asset(metaJson: string): AssetDto {
  return {
    id: "asset-1",
    projectId: "project-1",
    userId: "user-1",
    kind: "video",
    objectKey: "media/output.mp4",
    mime: "video/mp4",
    bytes: 1024,
    textContent: null,
    metaJson,
    sourceTaskId: "task-1",
    reviewStatus: null,
    favorite: false,
    createdAt: 1,
  };
}

function task(patch: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "task-1",
    projectId: "project-1",
    userId: "user-1",
    kind: "video",
    status: "succeeded",
    modelKey: "seedance-2.0",
    inputJson: JSON.stringify({
      prompt: "雨夜中的赛车",
      resolution: "720p",
      duration: 5,
      seed: -1,
      webSearch: true,
    }),
    arkTaskId: "ark-task-1",
    outputAssetId: "asset-1",
    contextJson: null,
    error: null,
    errorCode: null,
    errorRequestId: null,
    deletedAt: null,
    usageJson: JSON.stringify({
      tokens: 1_000_000,
      totalTokens: 1_100_000,
      webSearchCalls: 2,
      tools: ["web_search"],
      seed: 42,
      frames: 120,
      framesPerSecond: 24,
      serviceTier: "flex",
      source: "actual",
    }),
    attemptCount: 2,
    startedAt: 2,
    completedAt: 3,
    createdAt: 1,
    updatedAt: 3,
    outputAsset: asset(JSON.stringify({
      params: {
        actualResolution: "720p",
        actualDuration: 5,
        actualSeed: 42,
      },
    })),
    ...patch,
  };
}

test("task details prefer actual video usage and provider output", () => {
  const detail = buildTaskDetailSnapshot(task());

  assert.equal(detail.providerLabel, "火山方舟");
  assert.equal(detail.modelLabel, "Seedance 2.0");
  assert.equal(detail.tokens, 1_000_000);
  assert.equal(detail.totalTokens, 1_100_000);
  assert.equal(detail.seed, 42);
  assert.equal(detail.frames, 120);
  assert.equal(detail.framesPerSecond, 24);
  assert.equal(detail.resolution, "720p");
  assert.equal(detail.durationSeconds, 5);
  assert.equal(detail.serviceTier, "flex");
  assert.deepEqual(detail.tools, [{ id: "web_search", label: "联网搜索" }]);
  assert.deepEqual(detail.cost, { yuan: 46, accuracy: "actual" });
  assert.equal(detail.billing.webSearch.calls, 2);
  assert.equal(detail.billing.webSearch.listYuan, 0.008);
  assert.equal(detail.billing.total.yuan, 46.008);
  assert.match(detail.billing.serviceTier.note, /历史任务|Flex/);
  assert.equal(detail.attemptCount, 2);
});

test("task details explain the minimum token rule for video references", () => {
  const detail = buildTaskDetailSnapshot(task({
    inputJson: JSON.stringify({
      prompt: "延长视频",
      resolution: "720p",
      duration: 5,
      operation: "extend",
      referenceMediaKinds: ["video"],
    }),
    usageJson: JSON.stringify({
      source: "actual",
      tokens: 1_000_000,
      serviceTier: "default",
    }),
  }));

  assert.equal(detail.billing.minimumToken.applies, true);
  assert.match(detail.billing.minimumToken.note, /最低 token/);
  assert.equal(detail.billing.tokenRateYuanPerMillion, 28);
});

test("task details derive Coze plugin tools and asset specifications", () => {
  const detail = buildTaskDetailSnapshot(task({
    kind: "edit",
    modelKey: "coze-edit",
    inputJson: JSON.stringify({
      prompt: "视频裁剪",
      tool: "video_trim",
      params: { start_time: 1, end_time: 3 },
    }),
    usageJson: null,
    arkTaskId: null,
    outputAsset: asset(JSON.stringify({
      params: { tool: "video_trim", resolution: "1080p", fps: 30, duration: 2 },
    })),
  }));

  assert.equal(detail.providerLabel, "Coze");
  assert.equal(detail.modelLabel, "视频剪辑工具");
  assert.equal(detail.resolution, "1080p");
  assert.equal(detail.framesPerSecond, 30);
  assert.equal(detail.durationSeconds, 2);
  assert.deepEqual(detail.tools, [{ id: "video_trim", label: "视频裁剪" }]);
  assert.deepEqual(detail.cost, { yuan: null, accuracy: "none" });
});

test("task details tolerate old or damaged JSON records", () => {
  const detail = buildTaskDetailSnapshot(task({
    status: "failed",
    inputJson: "{broken",
    usageJson: "not-json",
    outputAsset: undefined,
    attemptCount: undefined,
  }));

  assert.equal(detail.prompt, "");
  assert.equal(detail.seed, null);
  assert.equal(detail.resolution, null);
  assert.deepEqual(detail.tools, []);
  assert.equal(detail.attemptCount, 1);
});
