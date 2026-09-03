/**
 * 生成完成后回调海豚制片管理工具，把 AIGC 素材同步到其管线视图。
 * 需配置 PM_CALLBACK_URL + PM_CALLBACK_SECRET；未配置则静默跳过，绝不影响生成主流程。
 * 失败只记日志、不抛出（镜像 wecom.ts 的容错约定）。
 */
import { errorDiagnostic } from "@/lib/error-safety";
import {
  createSignedPublicAssetUrl,
  getPublicAssetSigningSecret,
} from "@/lib/public-asset-signing";

export interface PmAssetPayload {
  /** post-studio 的项目ID，对应制片工具里手填的“关联后期AIGC项目” */
  postProjectId: string;
  /** post-studio 的素材ID */
  assetId: string;
  /** image | video | audio | text */
  kind: string;
  /** 是否为“一键成片”成品（决定落到后期剪辑还是 AI 动画阶段） */
  isFinal?: boolean;
  prompt?: string;
  title?: string;
  /** 用于生成缩略图的图片素材ID（视频用其尾帧图；图片用自身）。缺省则无缩略图 */
  thumbnailAssetId?: string | null;
}

function baseUrl(): string {
  return (process.env.AUTH_URL || "").replace(/\/+$/, "");
}

export async function notifyPmAsset(payload: PmAssetPayload): Promise<void> {
  const url = process.env.PM_CALLBACK_URL;
  const secret = process.env.PM_CALLBACK_SECRET;
  if (!url || !secret) return; // 未配置集成，跳过

  const site = baseUrl();
  const signingSecret = getPublicAssetSigningSecret();
  const signedAt = Date.now();
  const deepLinkUrl = site ? `${site}/projects/${payload.postProjectId}` : "";
  const thumbnailUrl =
    site && signingSecret && payload.thumbnailAssetId
      ? createSignedPublicAssetUrl({
          baseUrl: site,
          assetId: payload.thumbnailAssetId,
          variant: "thumbnail",
          secret: signingSecret,
          nowMs: signedAt,
        })
      : undefined;
  // 短时签名下载链接绕过登录鉴权，但不会暴露长期集成密钥。
  const downloadUrl = site && signingSecret
    ? createSignedPublicAssetUrl({
        baseUrl: site,
        assetId: payload.assetId,
        variant: "raw",
        secret: signingSecret,
        nowMs: signedAt,
      })
    : undefined;

  if (!deepLinkUrl) {
    console.warn("[pm-callback] AUTH_URL 未配置，无法构造深链，跳过回调");
    return;
  }
  if (!signingSecret) {
    console.warn(
      "[pm-callback] PM_INTEGRATION_SECRET 未配置，回调将不包含素材访问链接"
    );
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PM-Secret": secret,
      },
      body: JSON.stringify({
        postProjectId: payload.postProjectId,
        assetId: payload.assetId,
        kind: payload.kind,
        isFinal: Boolean(payload.isFinal),
        prompt: payload.prompt,
        title: payload.title,
        deepLinkUrl,
        thumbnailUrl,
        downloadUrl,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("[pm-callback] 回调制片工具失败:", errorDiagnostic(e));
  }
}
