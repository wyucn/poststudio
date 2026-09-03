import { eq } from "drizzle-orm";
import { db, operationHealth, type OperationHealth } from "@/db";
import { notifyWecom } from "@/lib/wecom";

export type OperationKey = "backup" | "bridge-sweep" | "data-integrity";
export type OperationStatus = OperationHealth["status"];
export type OperationNotification = "alert" | "recovery" | null;

export const OPERATION_LABEL: Record<OperationKey, string> = {
  backup: "每日数据备份",
  "bridge-sweep": "中转桶孤儿清理",
  "data-integrity": "数据库一致性巡检",
};

export function operationNotification(
  alertActive: boolean,
  nextStatus: OperationStatus
): OperationNotification {
  if (nextStatus === "failed") return alertActive ? null : "alert";
  if (nextStatus === "ok" && alertActive) return "recovery";
  return null;
}

function previous(key: OperationKey): OperationHealth | undefined {
  return db
    .select()
    .from(operationHealth)
    .where(eq(operationHealth.key, key))
    .get();
}

function writeHealth(row: OperationHealth): void {
  db.insert(operationHealth)
    .values(row)
    .onConflictDoUpdate({
      target: operationHealth.key,
      set: {
        status: row.status,
        metricsJson: row.metricsJson,
        errorRequestId: row.errorRequestId,
        alertActive: row.alertActive,
        lastRunAt: row.lastRunAt,
        lastSuccessAt: row.lastSuccessAt,
        lastFailureAt: row.lastFailureAt,
        updatedAt: row.updatedAt,
      },
    })
    .run();
}

export async function recordOperationSuccess(
  key: OperationKey,
  metrics: unknown
): Promise<void> {
  const old = previous(key);
  const now = new Date();
  const notification = operationNotification(old?.alertActive ?? false, "ok");
  writeHealth({
    key,
    status: "ok",
    metricsJson: JSON.stringify(metrics),
    errorRequestId: null,
    alertActive: false,
    lastRunAt: now,
    lastSuccessAt: now,
    lastFailureAt: old?.lastFailureAt ?? null,
    updatedAt: now,
  });
  if (notification === "recovery") {
    await notifyWecom(`${OPERATION_LABEL[key]}恢复\n最近成功：${now.toLocaleString("zh-CN")}`);
  }
}

export function recordOperationSkipped(
  key: OperationKey,
  metrics: unknown
): void {
  const old = previous(key);
  const now = new Date();
  writeHealth({
    key,
    status: "skipped",
    metricsJson: JSON.stringify(metrics),
    errorRequestId: null,
    alertActive: old?.alertActive ?? false,
    lastRunAt: now,
    lastSuccessAt: old?.lastSuccessAt ?? null,
    lastFailureAt: old?.lastFailureAt ?? null,
    updatedAt: now,
  });
}

export async function recordOperationFailure(input: {
  key: OperationKey;
  requestId: string;
  metrics?: unknown;
  action: string;
}): Promise<void> {
  const old = previous(input.key);
  const now = new Date();
  const notification = operationNotification(old?.alertActive ?? false, "failed");
  writeHealth({
    key: input.key,
    status: "failed",
    metricsJson: input.metrics === undefined ? null : JSON.stringify(input.metrics),
    errorRequestId: input.requestId,
    alertActive: true,
    lastRunAt: now,
    lastSuccessAt: old?.lastSuccessAt ?? null,
    lastFailureAt: now,
    updatedAt: now,
  });
  if (notification === "alert") {
    await notifyWecom(
      `${OPERATION_LABEL[input.key]}失败\n错误编号：${input.requestId}\n处理建议：${input.action}`
    );
  }
}
