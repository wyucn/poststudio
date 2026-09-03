import { config } from "dotenv";

config({ path: ".env" });

async function main() {
  const [{ assets, db }, { ensureAssetThumbnail }] = await Promise.all([
    import("../src/db"),
    import("../src/lib/thumbnails"),
  ]);
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
  const rows = db
    .select()
    .from(assets)
    .all()
    .filter((asset) => asset.kind === "video" && asset.objectKey)
    .slice(0, Number.isSafeInteger(limit) && limit > 0 ? limit : Infinity);

  let ready = 0;
  let failed = 0;
  console.log(`[thumbnail-backfill] 待检查 ${rows.length} 个视频`);
  for (const [index, asset] of rows.entries()) {
    try {
      const result = await ensureAssetThumbnail(asset);
      if (result) ready++;
      else failed++;
    } catch (error) {
      failed++;
      console.error(`[thumbnail-backfill] ${asset.id} 失败:`, error);
    }
    if ((index + 1) % 25 === 0 || index + 1 === rows.length) {
      console.log(`[thumbnail-backfill] ${index + 1}/${rows.length}，可用 ${ready}，失败 ${failed}`);
    }
  }
  if (failed) process.exitCode = 1;
}

void main();
