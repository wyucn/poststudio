import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchBridgeWithRetry,
  isRetryableBridgeStatus,
} from "./bridge-retry";

const noSleep = async () => undefined;

test("bridge retry only classifies transient HTTP failures", () => {
  assert.equal(isRetryableBridgeStatus(429), true);
  assert.equal(isRetryableBridgeStatus(503), true);
  assert.equal(isRetryableBridgeStatus(413), false);
  assert.equal(isRetryableBridgeStatus(401), false);
});

test("bridge upload retries transient responses and network failures", async () => {
  let calls = 0;
  const response = await fetchBridgeWithRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("socket reset");
      if (calls === 2) return new Response("busy", { status: 503 });
      return new Response("ok", { status: 200 });
    },
    { sleep: noSleep }
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test("bridge upload does not retry permanent errors such as 413", async () => {
  let calls = 0;
  const response = await fetchBridgeWithRetry(
    async () => {
      calls += 1;
      return new Response("too large", { status: 413 });
    },
    { sleep: noSleep }
  );

  assert.equal(response.status, 413);
  assert.equal(calls, 1);
});
