import "dotenv/config";
import { collectBackupReadiness } from "../src/lib/backup-policy";

async function main() {
  const readiness = await collectBackupReadiness();
  console.log(JSON.stringify(readiness, null, 2));
  if (
    readiness.freshness.overdue ||
    readiness.capacity.status === "critical"
  ) {
    process.exitCode = 1;
  }
}

void main().catch(() => {
  console.error(
    JSON.stringify(
      {
        error: "BACKUP_READINESS_CHECK_FAILED",
        message: "备份目标检查失败，请确认数据库和数据目录可读",
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
