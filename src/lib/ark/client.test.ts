import assert from "node:assert/strict";
import test from "node:test";
import {
  ArkError,
  generateImageWithUsage,
  getVideoTask,
  submitVideoTask,
} from "./client";

test("video requests omit the default service tier", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ARK_API_KEY;
  const requestBodies: Record<string, unknown>[] = [];

  process.env.ARK_API_KEY = "test-api-key";
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ id: `task-${requestBodies.length}` });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = originalApiKey;
  });

  await submitVideoTask({
    endpointId: "doubao-seedance-2-0-fast-260128",
    prompt: "test prompt",
    serviceTier: "default",
  });
  await submitVideoTask({
    endpointId: "doubao-seedance-1-5-pro-251215",
    prompt: "test prompt",
    serviceTier: "flex",
  });

  assert.equal("service_tier" in requestBodies[0], false);
  assert.equal(requestBodies[1].service_tier, "flex");
});

test("video requests submit frames without duration", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ARK_API_KEY;
  let requestBody: Record<string, unknown> | undefined;

  process.env.ARK_API_KEY = "test-api-key";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ id: "task-frames" });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = originalApiKey;
  });

  await submitVideoTask({
    endpointId: "doubao-seedance-1-0-pro-250528",
    prompt: "fractional shot",
    frames: 57,
  });

  assert.equal(requestBody?.frames, 57);
  assert.equal("duration" in (requestBody ?? {}), false);
});

test("video requests reject conflicting or invalid length settings", async () => {
  await assert.rejects(
    submitVideoTask({
      endpointId: "doubao-seedance-1-0-pro-250528",
      prompt: "conflict",
      duration: 3,
      frames: 57,
    }),
    (error: unknown) =>
      error instanceof ArkError && error.code === "VIDEO_LENGTH_MODE_CONFLICT"
  );

  await assert.rejects(
    submitVideoTask({
      endpointId: "doubao-seedance-1-0-pro-250528",
      prompt: "invalid frames",
      frames: 58,
    }),
    (error: unknown) =>
      error instanceof ArkError && error.code === "VIDEO_FRAMES_INVALID"
  );
});

test("video task responses normalize supported FPS field spellings", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ARK_API_KEY;

  process.env.ARK_API_KEY = "test-api-key";
  globalThis.fetch = async () =>
    Response.json({
      id: "task-fps",
      status: "succeeded",
      frames: 57,
      frames_per_second: 24,
    });

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = originalApiKey;
  });

  const task = await getVideoTask("task-fps");
  assert.equal(task.frames, 57);
  assert.equal(task.framesPerSecond, 24);
});

test("streaming image responses preserve actual token and web-search usage", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ARK_API_KEY;
  process.env.ARK_API_KEY = "test-api-key";
  globalThis.fetch = async () =>
    new Response(
      [
        'data: {"type":"image_generation.partial_succeeded","image_index":0,"url":"https://example.test/image.png","size":"1024×1024"}',
        'data: {"type":"image_generation.completed","tools":[{"type":"web_search"}],"usage":{"generated_images":1,"output_tokens":1234,"total_tokens":1234,"tool_usage":{"web_search":2}}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
      { headers: { "content-type": "text/event-stream" } }
    );

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = originalApiKey;
  });

  const result = await generateImageWithUsage({
    endpointId: "doubao-seedream-5-0-lite-260128",
    prompt: "a test image",
    stream: true,
    webSearch: true,
  });

  assert.equal(result.images[0]?.size, "1024x1024");
  assert.deepEqual(result.usage, {
    generatedImages: 1,
    inputImages: undefined,
    outputTokens: 1234,
    totalTokens: 1234,
    webSearchCalls: 2,
  });
  assert.deepEqual(result.tools, ["web_search"]);
});

test("explicit transient image rejections are marked safe for bounded retry", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ARK_API_KEY;
  process.env.ARK_API_KEY = "test-api-key";
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: "ServiceUnavailable", message: "temporarily busy" } },
      { status: 503 }
    );

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = originalApiKey;
  });

  await assert.rejects(
    generateImageWithUsage({
      endpointId: "doubao-seedream-5-0-lite-260128",
      prompt: "retry test",
      stream: true,
    }),
    (error: unknown) =>
      error instanceof ArkError &&
      error.status === 503 &&
      error.retrySafe === true
  );
});
