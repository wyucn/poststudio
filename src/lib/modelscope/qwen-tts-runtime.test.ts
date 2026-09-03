import assert from "node:assert/strict";
import test from "node:test";
import {
  checkQwenTtsInstanceHealth,
  qwenTtsCapacityHint,
  qwenTtsDefaultInstance,
  qwenTtsInstanceConfigs,
} from "./qwen-tts-runtime";

test("Qwen TTS runtime separates public and self-hosted configuration", () => {
  const instances = qwenTtsInstanceConfigs({
    MODELSCOPE_QWEN_TTS_URL: "https://public.example.com/",
    MODELSCOPE_ACCESS_TOKEN: " public-token ",
    MODELSCOPE_QWEN_TTS_SELF_HOSTED_URL: "http://127.0.0.1:7860/",
    MODELSCOPE_QWEN_TTS_SELF_HOSTED_TOKEN: " self-token ",
  });

  assert.deepEqual(
    instances.map((instance) => ({
      key: instance.key,
      url: instance.url,
      token: instance.accessToken,
      configured: instance.configured,
      experimental: instance.experimental,
    })),
    [
      {
        key: "public",
        url: "https://public.example.com",
        token: "public-token",
        configured: true,
        experimental: true,
      },
      {
        key: "self-hosted",
        url: "http://127.0.0.1:7860",
        token: "self-token",
        configured: true,
        experimental: false,
      },
    ]
  );
  assert.equal(
    qwenTtsDefaultInstance({
      MODELSCOPE_QWEN_TTS_DEFAULT_INSTANCE: "self-hosted",
    }),
    "self-hosted"
  );
  const anonymousSelfHosted = qwenTtsInstanceConfigs({
    MODELSCOPE_QWEN_TTS_SELF_HOSTED_URL: "http://127.0.0.1:7860",
    MODELSCOPE_ACCESS_TOKEN: "public-only-token",
  })[1];
  assert.equal(anonymousSelfHosted.configured, true);
  assert.equal(anonymousSelfHosted.accessToken, null);
});

test("Qwen TTS health check verifies config and Gradio API metadata", async () => {
  const config = qwenTtsInstanceConfigs({
    MODELSCOPE_QWEN_TTS_URL: "https://public.example.com",
    MODELSCOPE_ACCESS_TOKEN: "token",
  })[0];
  const requested: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await checkQwenTtsInstanceHealth(config, {
    timeoutMs: 1_000,
    fetcher,
  });

  assert.equal(result.status, "healthy");
  assert.deepEqual(requested, [
    "https://public.example.com/config",
    "https://public.example.com/gradio_api/info",
  ]);
});

test("Qwen TTS health and capacity feedback stays actionable", async () => {
  const selfHosted = qwenTtsInstanceConfigs({})[1];
  const health = await checkQwenTtsInstanceHealth(selfHosted, {
    fetcher: (() => {
      throw new Error("fetch should not run for an unconfigured instance");
    }) as typeof fetch,
  });

  assert.equal(health.status, "unconfigured");
  assert.match(health.message, /尚未配置自建实例地址/);
  assert.match(
    qwenTtsCapacityHint({
      instance: "public",
      queued: 2,
      running: 1,
      limit: 1,
    }),
    /3 个本站任务.*0\.6B.*自建实例/
  );
});
