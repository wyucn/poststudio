import { randomUUID } from "node:crypto";
import { db, assets } from "@/db";
import { ASSET_UPLOAD_MAX_BYTES } from "@/lib/media-policy";
import { formulaAssetMeta, FORMULA_ASSET_MAX_METADATA_CHARS, parseFormulaAssetState } from "@/lib/formula-assets";
import { deleteObject, putObject, sniffKind } from "@/lib/storage";
import { errorResponse, HttpError, requireProjectMember } from "@/lib/services";

const MAX_FORMULA_PNG_BYTES = ASSET_UPLOAD_MAX_BYTES.image;
const MAX_FORMULA_REQUEST_BYTES = MAX_FORMULA_PNG_BYTES + FORMULA_ASSET_MAX_METADATA_CHARS + 256 * 1024;

function safeFilename(value: string) {
  const normalized = value.replace(/[\\/\r\n\0]/gu, "_").trim();
  const filename = normalized.toLowerCase().endsWith(".png") ? normalized : `${normalized || "haitun-formula"}.png`;
  return filename.slice(0, 255);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireProjectMember(id);
    const declaredBytes = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_FORMULA_REQUEST_BYTES) {
      throw new HttpError(413, "公式素材请求超过 20MB 上限", "MEDIA_UPLOAD_TOO_LARGE");
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "公式素材请求格式不正确");
    }
    const fileEntry = form.get("file");
    const metadataEntry = form.get("metadata");
    if (!fileEntry || typeof fileEntry === "string" || typeof fileEntry.arrayBuffer !== "function") {
      throw new HttpError(400, "缺少公式 PNG 文件");
    }
    if (typeof metadataEntry !== "string" || metadataEntry.length > FORMULA_ASSET_MAX_METADATA_CHARS) {
      throw new HttpError(400, "公式配置内容过大或缺失");
    }
    let state: ReturnType<typeof parseFormulaAssetState>;
    try {
      state = parseFormulaAssetState(JSON.parse(metadataEntry));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "公式配置不合法");
    }
    const file = fileEntry as Blob & { name?: string; type?: string };
    if (file.size < 1 || file.size > MAX_FORMULA_PNG_BYTES) {
      throw new HttpError(413, "公式 PNG 超过 20MB 上限", "MEDIA_UPLOAD_TOO_LARGE");
    }
    const mime = (file.type || "").split(";")[0].trim().toLowerCase();
    if (mime !== "image/png") throw new HttpError(400, "公式素材必须是 PNG 文件");
    const buffer = Buffer.from(await file.arrayBuffer());
    if (sniffKind(buffer.subarray(0, 64)) !== "image" || !buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      throw new HttpError(400, "公式素材不是有效的 PNG 文件");
    }

    const assetId = randomUUID();
    const filename = safeFilename(typeof file.name === "string" ? file.name : "haitun-formula.png");
    const { objectKey, bytes } = await putObject(assetId, buffer, "image/png");
    const asset = {
      id: assetId,
      projectId: id,
      userId: user.id,
      kind: "image" as const,
      objectKey,
      mime: "image/png",
      bytes,
      textContent: null,
      metaJson: JSON.stringify(formulaAssetMeta(state, filename)),
      sourceTaskId: null,
      reviewStatus: null,
      favorite: false,
      createdAt: new Date(),
    };
    try {
      db.insert(assets).values(asset).run();
    } catch (error) {
      await deleteObject(objectKey);
      throw error;
    }
    return Response.json(asset);
  } catch (error) {
    return errorResponse(error);
  }
}
