import "dotenv/config";
import { runBackupCycle } from "../src/lib/backup";
import {
  backupRemoteConfigured,
  backupRemoteWriteEnabled,
} from "../src/lib/backup-remote";

const CONFIRM_REMOTE_FLAG = "--confirm-remote";

async function main() {
  if (!process.argv.includes(CONFIRM_REMOTE_FLAG)) {
    console.error(
      JSON.stringify(
        {
          error: "BACKUP_REMOTE_CONFIRMATION_REQUIRED",
          message: `真实远端备份必须显式传入 ${CONFIRM_REMOTE_FLAG}`,
        },
        null,
        2
      )
    );
    process.exitCode = 2;
    return;
  }
  if (!backupRemoteWriteEnabled()) {
    console.error(
      JSON.stringify(
        {
          error: "BACKUP_REMOTE_WRITE_NOT_ENABLED",
          message:
            "当前环境未授权远端备份写入，请仅在生产服务器配置 BACKUP_REMOTE_WRITE_ENABLED=1",
        },
        null,
        2
      )
    );
    process.exitCode = 2;
    return;
  }
  if (!backupRemoteConfigured()) {
    console.error(
      JSON.stringify(
        {
          error: "BACKUP_REMOTE_NOT_CONFIGURED",
          message: "当前环境缺少 Supabase 备份连接配置",
        },
        null,
        2
      )
    );
    process.exitCode = 2;
    return;
  }
  // 一次性 CLI 不能启动只适用于常驻应用进程的企微 WebSocket；Webhook
  // 通知、健康记录和备份本身仍按原流程执行。
  delete process.env.WECOM_BOT_ID;
  delete process.env.WECOM_BOT_SECRET;
  const status = await runBackupCycle();
  console.log(JSON.stringify({ status }, null, 2));
  if (status === "failed") process.exitCode = 1;
}

void main().catch(() => {
  console.error(
    JSON.stringify(
      {
        error: "BACKUP_RUN_FAILED",
        message: "备份执行失败，请根据控制台错误编号检查脱敏服务端日志",
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
