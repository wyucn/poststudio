import assert from "node:assert/strict";
import test from "node:test";
import { notifyPmAsset } from "./pm-callback";
import { verifyPublicAssetAccess } from "./public-asset-signing";

test("PM callbacks expose short-lived signed asset links without the signing secret", async (t) => {
  const originalFetch = globalThis.fetch;
  const envNames = [
    "AUTH_URL",
    "PM_CALLBACK_URL",
    "PM_CALLBACK_SECRET",
    "PM_INTEGRATION_SECRET",
  ] as const;
  const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]])
  );
  const signingSecret = "private-signing-secret-with-enough-entropy";
  const captured: {
    body?: Record<string, unknown>;
    headers?: Headers;
  } = {};

  process.env.AUTH_URL = "https://post-studio.example.com";
  process.env.PM_CALLBACK_URL = "https://pm.example.com/callback";
  process.env.PM_CALLBACK_SECRET = "shared-callback-secret";
  process.env.PM_INTEGRATION_SECRET = signingSecret;
  globalThis.fetch = async (_input, init) => {
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    captured.headers = new Headers(init?.headers);
    return new Response(null, { status: 204 });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const value = originalEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  await notifyPmAsset({
    postProjectId: "project-123",
    assetId: "asset-raw",
    thumbnailAssetId: "asset-thumbnail",
    kind: "video",
  });

  assert.ok(captured.body);
  assert.equal(captured.headers?.get("x-pm-secret"), "shared-callback-secret");
  assert.equal(JSON.stringify(captured.body).includes(signingSecret), false);

  for (const [field, assetId, variant] of [
    ["downloadUrl", "asset-raw", "raw"],
    ["thumbnailUrl", "asset-thumbnail", "thumbnail"],
  ] as const) {
    const value: unknown = captured.body[field];
    assert.equal(typeof value, "string");
    const url = new URL(value as string);
    assert.equal(url.searchParams.has("key"), false);
    assert.equal(
      verifyPublicAssetAccess({
        assetId,
        variant,
        expires: url.searchParams.get("expires"),
        signature: url.searchParams.get("signature"),
        secret: signingSecret,
      }).valid,
      true
    );
  }
});
