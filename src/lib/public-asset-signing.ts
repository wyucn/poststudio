import { createHmac, timingSafeEqual } from "node:crypto";

export const PUBLIC_ASSET_URL_TTL_SECONDS = 15 * 60;
export const PUBLIC_ASSET_CACHE_MAX_AGE_SECONDS = 60;

export type PublicAssetVariant = "raw" | "thumbnail";

const SIGNATURE_VERSION = "v1";
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EXPIRY_PATTERN = /^\d{1,12}$/;

function signingPayload(
  assetId: string,
  variant: PublicAssetVariant,
  expiresAt: number
): string {
  return `${SIGNATURE_VERSION}\n${variant}\n${assetId}\n${expiresAt}`;
}

export function getPublicAssetSigningSecret(): string | null {
  return process.env.PM_INTEGRATION_SECRET?.trim() || null;
}

export function signPublicAssetAccess(input: {
  assetId: string;
  variant: PublicAssetVariant;
  expiresAt: number;
  secret: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(signingPayload(input.assetId, input.variant, input.expiresAt))
    .digest("base64url");
}

export function createSignedPublicAssetUrl(input: {
  baseUrl: string;
  assetId: string;
  variant: PublicAssetVariant;
  secret: string;
  nowMs?: number;
}): string {
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const expiresAt = nowSeconds + PUBLIC_ASSET_URL_TTL_SECONDS;
  const signature = signPublicAssetAccess({
    assetId: input.assetId,
    variant: input.variant,
    expiresAt,
    secret: input.secret,
  });
  const url = new URL(
    `/api/public/assets/${encodeURIComponent(input.assetId)}/${input.variant}`,
    input.baseUrl
  );
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("signature", signature);
  return url.toString();
}

export type PublicAssetVerification =
  | { valid: true; expiresAt: number }
  | { valid: false };

export function verifyPublicAssetAccess(input: {
  assetId: string;
  variant: PublicAssetVariant;
  expires: string | null;
  signature: string | null;
  secret: string;
  nowMs?: number;
}): PublicAssetVerification {
  if (
    !input.secret ||
    !input.expires ||
    !EXPIRY_PATTERN.test(input.expires) ||
    !input.signature ||
    !SIGNATURE_PATTERN.test(input.signature)
  ) {
    return { valid: false };
  }

  const expiresAt = Number(input.expires);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < nowSeconds ||
    expiresAt > nowSeconds + PUBLIC_ASSET_URL_TTL_SECONDS
  ) {
    return { valid: false };
  }

  const expected = signPublicAssetAccess({
    assetId: input.assetId,
    variant: input.variant,
    expiresAt,
    secret: input.secret,
  });
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(input.signature);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return { valid: false };
  }

  return { valid: true, expiresAt };
}

export function publicAssetCacheControl(
  expiresAt: number,
  nowMs = Date.now()
): string {
  const nowSeconds = Math.floor(nowMs / 1000);
  const remaining = Math.max(0, expiresAt - nowSeconds);
  const maxAge = Math.min(PUBLIC_ASSET_CACHE_MAX_AGE_SECONDS, remaining);
  return `private, max-age=${maxAge}, must-revalidate`;
}
