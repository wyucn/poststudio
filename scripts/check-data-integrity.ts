import "dotenv/config";
import { db } from "../src/db";
import { runDataIntegrityCheck } from "../src/lib/data-integrity";

async function main() {
  const repairSafe = process.argv.includes("--repair");
  const metrics = runDataIntegrityCheck(db, { repairSafe });
  console.log(JSON.stringify(metrics, null, 2));
  if (metrics.blockingIssueCount > 0) process.exitCode = 1;
}

void main().catch(() => {
  console.error(
    JSON.stringify(
      {
        error: "DATA_INTEGRITY_CHECK_FAILED",
        message: "巡检无法执行，请确认应用迁移已完成且 SQLite 数据库可读",
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
