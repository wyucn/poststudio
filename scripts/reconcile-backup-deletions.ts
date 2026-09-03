import "dotenv/config";
import { reconcileBackupDeletions } from "../src/lib/backup";

async function main() {
  const record = process.argv.includes("--record");
  const metrics = await reconcileBackupDeletions({ record });
  console.log(
    JSON.stringify({ mode: record ? "record" : "dry-run", ...metrics }, null, 2)
  );
  if (metrics.missingRemoteBackups > 0) process.exitCode = 1;
}

void main().catch(() => {
  console.error(
    JSON.stringify(
      {
        error: "BACKUP_RECONCILIATION_FAILED",
        message: "备份删除对账失败，请确认应用迁移已完成且备份桶可读",
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
