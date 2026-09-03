import assert from "node:assert/strict";
import test from "node:test";
import { imageCap, videoCap } from "@/lib/ark/capabilities";
import { cozePluginUrl } from "@/lib/coze/config";
import {
  MANAGED_MODEL_DEFINITIONS,
  QWEN_SELF_HOSTED_CONFIG_KEY,
  managedModelDefinition,
} from "./catalog";
import {
  normalizeManagedEndpoint,
  validateManagedCapabilities,
} from "./runtime";

test("managed model catalog keeps stable unique keys without secret values", () => {
  const keys = MANAGED_MODEL_DEFINITIONS.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("seedream-5.0"));
  assert.ok(keys.includes("seedance-2.0"));
  assert.ok(keys.includes("coze-music"));
  assert.ok(keys.includes("modelscope-qwen3-tts:public"));
  assert.doesNotMatch(
    JSON.stringify(MANAGED_MODEL_DEFINITIONS),
    /Bearer\s|eyJhbGci|BEGIN OPENSSH PRIVATE KEY/i
  );
});

test("managed Ark capability overrides enforce structural safety", () => {
  const image = managedModelDefinition("seedream-5.0")!;
  const video = managedModelDefinition("seedance-2.0")!;
  assert.deepEqual(
    validateManagedCapabilities(image, imageCap(image.key)),
    imageCap(image.key)
  );
  assert.deepEqual(
    validateManagedCapabilities(video, videoCap(video.key)),
    videoCap(video.key)
  );
  assert.throws(
    () =>
      validateManagedCapabilities(image, {
        ...imageCap(image.key),
        tiers: [],
      }),
    /Array must contain at least 1 element|Too small/i
  );
  assert.throws(
    () =>
      validateManagedCapabilities(video, {
        ...videoCap(video.key),
        defaultResolution: "4k",
        resolutions: ["720p"],
      }),
    /默认分辨率必须包含/
  );
  assert.throws(
    () =>
      validateManagedCapabilities(video, {
        ...videoCap(video.key),
        frames: { min: 289, max: 29, step: 4, fps: 24 },
      }),
    /frames\.min 不能大于 frames\.max/
  );
});

test("Coze endpoint overrides accept plugin ids and full HTTPS URLs", () => {
  assert.equal(
    cozePluginUrl("music", "123456"),
    "https://mcp.coze.cn/v1/plugins/123456"
  );
  assert.equal(
    cozePluginUrl("tts", "https://example.com/mcp/"),
    "https://example.com/mcp"
  );
});

test("managed endpoints reject embedded credentials", () => {
  const qwen = managedModelDefinition(QWEN_SELF_HOSTED_CONFIG_KEY)!;
  const coze = managedModelDefinition("coze-music")!;
  assert.equal(
    normalizeManagedEndpoint(qwen, "http://127.0.0.1:7860/", {}),
    "http://127.0.0.1:7860"
  );
  assert.equal(normalizeManagedEndpoint(coze, "123456", {}), "123456");
  assert.throws(
    () =>
      normalizeManagedEndpoint(
        qwen,
        "https://user:password@example.com/gradio",
        {}
      ),
    /不得包含用户名、密码或访问令牌/
  );
  assert.throws(
    () =>
      normalizeManagedEndpoint(
        coze,
        "https://example.com/mcp?access_token=secret",
        {}
      ),
    /密钥只能通过服务器环境变量配置/
  );
});
