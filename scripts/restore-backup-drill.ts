import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupRemoteConfigured } from "../src/lib/backup-remote";
import { runBackupRestoreDrill } from "../src/lib/backup-restore";

function mediaSampleCount(): number {
  const argument = process.argv.find((value) =>
    value.startsWith("--media-samples=")
  );
  if (!argument) return 2;
  const parsed = Number(argument.slice("--media-samples=".length));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
    throw new Error("媒体恢复样本数必须是 0–10 的整数");
  }
  return parsed;
}

async function main() {
  if (!backupRemoteConfigured()) throw new Error("未配置 Supabase 备份连接");
  const keep = process.argv.includes("--keep");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haitun-backup-drill-"));
  const targetDir = path.join(root, "restore");
  try {
    const metrics = await runBackupRestoreDrill({
      targetDir,
      mediaSamples: mediaSampleCount(),
    });
    console.log(
      JSON.stringify(
        { ...metrics, retainedArtifacts: keep ? targetDir : null },
        null,
        2
      )
    );
    if (
      metrics.objectives.rpoOverdue ||
      metrics.objectives.withinRto === false
    ) {
      process.exitCode = 1;
    }
  } finally {
    if (!keep) await fs.rm(root, { recursive: true, force: true });
  }
}

void main().catch(() => {
  console.error(
    JSON.stringify(
      {
        error: "BACKUP_RESTORE_DRILL_FAILED",
        message: "恢复演练失败，请检查备份清单、对象完整性和临时磁盘空间",
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
