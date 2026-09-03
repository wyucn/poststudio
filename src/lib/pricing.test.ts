import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskBilling, estimateTaskCost } from "./pricing";

function task(patch: Record<string, unknown> = {}) {
  return {
    kind: "video",
    modelKey: "seedance-2.0",
    inputJson: JSON.stringify({ resolution: "720p", duration: 5 }),
    usageJson: JSON.stringify({ source: "actual", tokens: 1_000_000 }),
    ...patch,
  };
}

test("Seedance input-video pricing uses the official with-input token rate", () => {
  const row = task({
    inputJson: JSON.stringify({
      resolution: "720p",
      duration: 5,
      operation: "extend",
      webSearch: true,
    }),
    usageJson: JSON.stringify({
      source: "actual",
      tokens: 1_000_000,
      webSearchCalls: 2,
      serviceTier: "default",
    }),
  });

  assert.deepEqual(estimateTaskCost(row), { yuan: 28, accuracy: "actual" });
  const billing = buildTaskBilling(row);
  assert.equal(billing.minimumToken.applies, true);
  assert.equal(billing.webSearch.calls, 2);
  assert.equal(billing.webSearch.listYuan, 0.008);
  assert.equal(billing.total.yuan, 28.008);
  assert.equal(billing.total.accuracy, "approx");
});

test("Flex applies the 50% public-price multiplier only to supported video models", () => {
  const row = task({
    modelKey: "seedance-1.5-pro",
    inputJson: JSON.stringify({ resolution: "720p", generateAudio: true, serviceTier: "flex" }),
    usageJson: JSON.stringify({ source: "actual", tokens: 1_000_000, serviceTier: "flex" }),
  });

  assert.deepEqual(estimateTaskCost(row), { yuan: 8, accuracy: "actual" });
  const billing = buildTaskBilling(row);
  assert.equal(billing.serviceTier.priceMultiplier, 0.5);
  assert.match(billing.serviceTier.note, /50%/);
});

test("Seedream 5.0 Pro includes the free first reference image and the current pixel tier", () => {
  const row = {
    kind: "image",
    modelKey: "seedream-5.0-pro",
    inputJson: JSON.stringify({ size: "2048x1536", refAssetIds: ["a", "b", "c"] }),
    usageJson: JSON.stringify({
      source: "actual",
      generatedImages: 1,
      inputImages: 3,
    }),
  };

  assert.deepEqual(estimateTaskCost(row), { yuan: 0.64, accuracy: "actual" });
});

test("damaged usage falls back without exposing a fake final bill", () => {
  const row = task({
    usageJson: "not-json",
    inputJson: JSON.stringify({ resolution: "720p", duration: 5 }),
  });
  const billing = buildTaskBilling(row);
  assert.equal(billing.webSearch.calls, null);
  assert.equal(billing.minimumToken.applies, false);
  assert.equal(billing.total.accuracy, "approx");
});
