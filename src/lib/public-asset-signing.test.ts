import assert from "node:assert/strict";
import test from "node:test";
import {
  createSignedPublicAssetUrl,
  PUBLIC_ASSET_CACHE_MAX_AGE_SECONDS,
  PUBLIC_ASSET_URL_TTL_SECONDS,
  publicAssetCacheControl,
  signPublicAssetAccess,
  verifyPublicAssetAccess,
} from "./public-asset-signing";

const SECRET = "test-private-signing-secret-with-enough-entropy";
const NOW_MS = Date.UTC(2026, 6, 23, 10, 0, 0);

test("signed public asset URLs hide the long-term secret and verify", () => {
  const signed = createSignedPublicAssetUrl({
    baseUrl: "https://post-studio.example.com",
    assetId: "asset-123",
    variant: "thumbnail",
    secret: SECRET,
    nowMs: NOW_MS,
  });
  const url = new URL(signed);

  assert.equal(url.pathname, "/api/public/assets/asset-123/thumbnail");
  assert.equal(url.searchParams.has("key"), false);
  assert.equal(url.toString().includes(SECRET), false);

  const result = verifyPublicAssetAccess({
    assetId: "asset-123",
    variant: "thumbnail",
    expires: url.searchParams.get("expires"),
    signature: url.searchParams.get("signature"),
    secret: SECRET,
    nowMs: NOW_MS,
  });
  assert.deepEqual(result, {
    valid: true,
    expiresAt: Math.floor(NOW_MS / 1000) + PUBLIC_ASSET_URL_TTL_SECONDS,
  });
});

test("signatures cannot be reused for another asset or access variant", () => {
  const expiresAt = Math.floor(NOW_MS / 1000) + PUBLIC_ASSET_URL_TTL_SECONDS;
  const signature = signPublicAssetAccess({
    assetId: "asset-123",
    variant: "raw",
    expiresAt,
    secret: SECRET,
  });

  assert.deepEqual(
    verifyPublicAssetAccess({
      assetId: "asset-456",
      variant: "raw",
      expires: String(expiresAt),
      signature,
      secret: SECRET,
      nowMs: NOW_MS,
    }),
    { valid: false }
  );
  assert.deepEqual(
    verifyPublicAssetAccess({
      assetId: "asset-123",
      variant: "thumbnail",
      expires: String(expiresAt),
      signature,
      secret: SECRET,
      nowMs: NOW_MS,
    }),
    { valid: false }
  );
});

test("expired, extended, and malformed signatures are rejected", () => {
  const nowSeconds = Math.floor(NOW_MS / 1000);
  const expiredAt = nowSeconds - 1;
  const futureAt = nowSeconds + PUBLIC_ASSET_URL_TTL_SECONDS + 1;

  for (const expiresAt of [expiredAt, futureAt]) {
    assert.deepEqual(
      verifyPublicAssetAccess({
        assetId: "asset-123",
        variant: "raw",
        expires: String(expiresAt),
        signature: signPublicAssetAccess({
          assetId: "asset-123",
          variant: "raw",
          expiresAt,
          secret: SECRET,
        }),
        secret: SECRET,
        nowMs: NOW_MS,
      }),
      { valid: false }
    );
  }

  assert.deepEqual(
    verifyPublicAssetAccess({
      assetId: "asset-123",
      variant: "raw",
      expires: "not-a-time",
      signature: "not-a-signature",
      secret: SECRET,
      nowMs: NOW_MS,
    }),
    { valid: false }
  );
});

test("public asset cache lifetime never exceeds the short cache cap or signature", () => {
  const nowSeconds = Math.floor(NOW_MS / 1000);

  assert.equal(
    publicAssetCacheControl(nowSeconds + 600, NOW_MS),
    `private, max-age=${PUBLIC_ASSET_CACHE_MAX_AGE_SECONDS}, must-revalidate`
  );
  assert.equal(
    publicAssetCacheControl(nowSeconds + 12, NOW_MS),
    "private, max-age=12, must-revalidate"
  );
  assert.equal(
    publicAssetCacheControl(nowSeconds - 1, NOW_MS),
    "private, max-age=0, must-revalidate"
  );
});
