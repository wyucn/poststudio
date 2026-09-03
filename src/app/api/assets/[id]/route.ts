import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  assets,
  assetComments,
  assetTranscripts,
  backupMediaTombstones,
  characters,
  projects,
  storyboards,
  tasks,
} from "@/db";
import { createAssetBackupTombstone } from "@/lib/backup-retention";
import { errorDiagnostic } from "@/lib/error-safety";
import {
  errorResponse,
  HttpError,
  isAdmin,
  requireProjectMember,
} from "@/lib/services";
import { deleteObject } from "@/lib/storage";
import { deleteImageThumbnail } from "@/lib/thumbnails";

const patchSchema = z
  .object({
    /** 评审状态：approved 采用 / rejected 废弃 / null 取消评审 */
    reviewStatus: z.enum(["approved", "rejected"]).nullable().optional(),
    /** 收藏「可用备选」，与评审独立 */
    favorite: z.boolean().optional(),
  })
  .refine((v) => v.reviewStatus !== undefined || v.favorite !== undefined, {
    message: "缺少要更新的字段",
  });

function jsonReferencesAsset(value: string | null, assetId: string): boolean {
  if (!value) return false;
  try {
    const visit = (item: unknown): boolean => {
      if (item === assetId) return true;
      if (Array.isArray(item)) return item.some(visit);
      if (item && typeof item === "object") {
        return Object.values(item as Record<string, unknown>).some(visit);
      }
      return false;
    };
    return visit(JSON.parse(value));
  } catch {
    return false;
  }
}

function assetReferences(projectId: string, assetId: string): string[] {
  const refs: string[] = [];
  const character = db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId))
    .all()
    .find((item) => jsonReferencesAsset(item.assetIdsJson, assetId));
  if (character) refs.push(`角色「${character.name}」`);
  const storyboard = db
    .select()
    .from(storyboards)
    .where(eq(storyboards.projectId, projectId))
    .all()
    .find(
      (item) =>
        jsonReferencesAsset(item.refsJson, assetId) ||
        jsonReferencesAsset(item.shotsJson, assetId)
    );
  if (storyboard) refs.push(`分镜「${storyboard.title}」`);
  const activeTask = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        inArray(tasks.status, ["queued", "running"])
      )
    )
    .all()
    .find((item) => jsonReferencesAsset(item.inputJson, assetId));
  if (activeTask) refs.push("排队或执行中的生成任务");
  return refs;
}

/** 评审素材：项目内任意成员可标记采用 / 废弃 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!asset) throw new HttpError(404, "素材不存在");
    await requireProjectMember(asset.projectId);
    const body = patchSchema.parse(await req.json());
    const patch: Partial<typeof assets.$inferInsert> = {};
    if (body.reviewStatus !== undefined) patch.reviewStatus = body.reviewStatus;
    if (body.favorite !== undefined) patch.favorite = body.favorite;
    db.update(assets).set(patch).where(eq(assets.id, id)).run();
    return Response.json({ ok: true, ...patch });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return Response.json({ error: e.issues[0]?.message ?? "参数错误" }, { status: 400 });
    }
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!asset) throw new HttpError(404, "素材不存在");
    const user = await requireProjectMember(asset.projectId);

    // 只有素材创建者、项目创建者或平台管理员可删除
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, asset.projectId))
      .get();
    const allowed =
      isAdmin(user) || asset.userId === user.id || project?.createdBy === user.id;
    if (!allowed) throw new HttpError(403, "只能删除自己生成或上传的素材");

    const references = assetReferences(asset.projectId, asset.id);
    if (references.length) {
      throw new HttpError(
        409,
        `该素材正在被${references.slice(0, 3).join("、")}引用，请先解除引用`
      );
    }

    const deletedAt = new Date();
    db.transaction((tx) => {
      if (asset.objectKey) {
        const tombstone = createAssetBackupTombstone(asset, deletedAt);
        tx.insert(backupMediaTombstones)
          .values(tombstone)
          .onConflictDoUpdate({
            target: backupMediaTombstones.objectKey,
            set: {
              assetId: tombstone.assetId,
              assetJson: tombstone.assetJson,
              deletedAt: tombstone.deletedAt,
              purgeAfter: tombstone.purgeAfter,
              remotePurgedAt: null,
            },
          })
          .run();
      }
      tx.delete(assetComments).where(eq(assetComments.assetId, id)).run();
      tx.delete(assetTranscripts).where(eq(assetTranscripts.assetId, id)).run();
      tx.update(tasks)
        .set({ outputAssetId: null, updatedAt: deletedAt })
        .where(eq(tasks.outputAssetId, id))
        .run();
      tx.delete(assets).where(eq(assets.id, id)).run();
    });
    if (asset.objectKey) {
      await deleteObject(asset.objectKey).catch((error) =>
        console.error(`[assets] 删除媒体失败`, errorDiagnostic(error))
      );
    }
    await deleteImageThumbnail(asset.id).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
