import { randomUUID } from "node:crypto";
import { db, assets } from "@/db";
import {
  deleteObject,
  InvalidFileContentError,
  ObjectTooLargeError,
  putObjectStream,
  sniffKind,
} from "@/lib/storage";
import {
  ASSET_UPLOAD_MAX_BYTES,
  uploadKindForMime,
} from "@/lib/media-policy";
import { errorResponse, HttpError, requireProjectMember } from "@/lib/services";

function uploadFilename(req: Request): string {
  const encoded = req.headers.get("x-file-name");
  if (!encoded) return "upload";
  try {
    return decodeURIComponent(encoded).slice(0, 255);
  } catch {
    return encoded.slice(0, 255);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await requireProjectMember(id);
    const mime = (req.headers.get("content-type") || "").split(";")[0].trim();
    const kind = uploadKindForMime(mime);
    if (!kind) {
      throw new HttpError(400, "仅支持图片（PNG/JPEG/WebP）、视频（MP4/WebM/MOV/MKV）、音频（MP3/WAV/M4A/FLAC/OGG）");
    }
    const declaredBytes = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > ASSET_UPLOAD_MAX_BYTES[kind]) {
      throw new HttpError(
        413,
        `文件超限：${kind === "image" ? "图片 20MB" : kind === "audio" ? "音频 100MB" : "视频 500MB"}`,
        "MEDIA_UPLOAD_TOO_LARGE"
      );
    }
    if (!req.body) throw new HttpError(400, "缺少文件内容");

    const assetId = randomUUID();
    let objectKey: string;
    let bytes: number;
    try {
      ({ objectKey, bytes } = await putObjectStream(
        assetId,
        req.body,
        mime,
        ASSET_UPLOAD_MAX_BYTES[kind],
        // 校验真实文件头，防止把非媒体内容（html/js/可执行文件等）伪造成白名单 MIME。
        // unknown 一律拒绝；音视频共享容器（ISO-BMFF/RIFF）时不区分，避免误拒合法 m4a/mov。
        (head) => {
          const sniffed = sniffKind(head);
          if (sniffed === "unknown") return false;
          if (sniffed === kind) return true;
          return (sniffed === "audio" || sniffed === "video") &&
            (kind === "audio" || kind === "video");
        }
      ));
    } catch (error) {
      if (error instanceof ObjectTooLargeError) {
        throw new HttpError(
          413,
          `文件超限：${kind === "image" ? "图片 20MB" : kind === "audio" ? "音频 100MB" : "视频 500MB"}`,
          "MEDIA_UPLOAD_TOO_LARGE"
        );
      }
      if (error instanceof InvalidFileContentError) {
        throw new HttpError(400, "文件内容与其类型不符，请上传真实的图片 / 视频 / 音频文件");
      }
      throw error;
    }
    const asset = {
      id: assetId,
      projectId: id,
      userId: user.id,
      kind,
      objectKey,
      mime,
      bytes,
      textContent: null,
      metaJson: JSON.stringify({ uploaded: true, filename: uploadFilename(req) }),
      sourceTaskId: null,
      reviewStatus: null,
      createdAt: new Date(),
    };
    try {
      db.insert(assets).values(asset).run();
    } catch (error) {
      await deleteObject(objectKey);
      throw error;
    }
    return Response.json(asset);
  } catch (e) {
    return errorResponse(e);
  }
}
