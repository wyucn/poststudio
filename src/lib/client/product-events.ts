import { api } from "./api";

export type ClientProductEventAction = "reuse" | "regenerate";

/** 行为统计不得阻断创作动作；服务端仍会独立校验任务与项目访问权限。 */
export async function recordTaskProductEvent(
  taskId: string,
  action: ClientProductEventAction
): Promise<void> {
  try {
    await api(`/api/tasks/${taskId}/events`, {
      method: "POST",
      json: { action },
    });
  } catch {
    return;
  }
}
