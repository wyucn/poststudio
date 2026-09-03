import assert from "node:assert/strict";
import test from "node:test";
import type { AssetDto, TaskDto } from "@/lib/client/types";
import {
  latestFailedCreatorTask,
  latestSuccessfulCreatorTask,
} from "./use-creator-history";

function task(
  id: string,
  createdAt: number,
  status: TaskDto["status"],
  inputJson: string
): TaskDto {
  return {
    id,
    projectId: "project-1",
    userId: "user-1",
    kind: "image",
    status,
    modelKey: "seedream-5.0",
    inputJson,
    arkTaskId: null,
    outputAssetId: null,
    contextJson: null,
    error: status === "failed" ? "生成失败" : null,
    errorCode: null,
    errorRequestId: null,
    deletedAt: null,
    usageJson: null,
    createdAt,
    updatedAt: createdAt,
  };
}

test("latest failed creator task restores the newest parseable input", () => {
  const recovery = latestFailedCreatorTask([
    task("older", 100, "failed", JSON.stringify({ prompt: "older" })),
    task("success", 300, "succeeded", JSON.stringify({ prompt: "success" })),
    task("broken", 400, "failed", "{broken-json"),
    task("newest-valid", 350, "failed", JSON.stringify({ prompt: "newest" })),
  ]);

  assert.equal(recovery?.task.id, "newest-valid");
  assert.equal(recovery?.input.prompt, "newest");
});

test("latest failed creator task returns null without a recoverable failure", () => {
  assert.equal(
    latestFailedCreatorTask([
      task("success", 200, "succeeded", JSON.stringify({ prompt: "ok" })),
      task("broken", 300, "failed", "not-json"),
    ]),
    null
  );
});

function audioAsset(id: string): AssetDto {
  return {
    id,
    projectId: "project-1",
    userId: "user-1",
    kind: "audio",
    objectKey: `media/${id}.wav`,
    mime: "audio/wav",
    bytes: 1024,
    textContent: null,
    metaJson: "{}",
    sourceTaskId: null,
    reviewStatus: null,
    favorite: false,
    createdAt: 100,
  };
}

test("latest successful creator task keeps the newest matching playable result", () => {
  const older = {
    ...task("older-audio", 100, "succeeded", "{}"),
    kind: "audio" as const,
    outputAssetId: "asset-older",
    outputAsset: audioAsset("asset-older"),
  };
  const newest = {
    ...task("newest-audio", 300, "succeeded", "{}"),
    kind: "audio" as const,
    outputAssetId: "asset-newest",
    outputAsset: audioAsset("asset-newest"),
  };
  const newerQueued = {
    ...task("queued-audio", 400, "queued", "{}"),
    kind: "audio" as const,
  };
  const imageResult = {
    ...task("image-result", 500, "succeeded", "{}"),
    outputAssetId: "image-asset",
    outputAsset: { ...audioAsset("image-asset"), kind: "image" as const },
  };

  assert.equal(
    latestSuccessfulCreatorTask(
      [older, newerQueued, newest, imageResult],
      "audio"
    )?.id,
    "newest-audio"
  );
  assert.equal(latestSuccessfulCreatorTask([newerQueued], "audio"), null);
});
