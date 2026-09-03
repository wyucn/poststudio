export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("@/db/migrate");
    runMigrations();
    if (process.env.E2E_MODE === "1") return;
    const { recoverOrphanTasks } = await import("@/lib/tasks/recovery");
    recoverOrphanTasks();
    const { startTaskWorker } = await import("@/lib/tasks/worker");
    startTaskWorker();
    const { startPoller } = await import("@/lib/tasks/poller");
    startPoller();
    const { startBackupScheduler } = await import("@/lib/backup");
    startBackupScheduler();
    const { startBridgeSweeper } = await import("@/lib/coze/media-bridge");
    startBridgeSweeper();
    const { startDataIntegrityScheduler } = await import(
      "@/lib/data-integrity"
    );
    startDataIntegrityScheduler();
    const { startTaskAlertScheduler } = await import("@/lib/tasks/task-alerts");
    startTaskAlertScheduler();
    const { startWecomBot } = await import("@/lib/wecom-bot");
    startWecomBot();
  }
}
