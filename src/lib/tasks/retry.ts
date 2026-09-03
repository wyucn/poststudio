export const MAX_AUTOMATIC_TASK_ATTEMPTS = 3;

const TTS_MODEL_KEYS = new Set(["coze-tts", "modelscope-qwen3-tts"]);

export interface RetryableTaskShape {
  kind: string;
  modelKey: string;
  errorCode?: string | null;
}

export interface AutomaticTaskRetryInfo {
  dueAt: number;
  nextAttempt: number;
  maxAttempts: number;
  reasonCode: string;
  message: string;
}

const AMBIGUOUS_RETRY_CODES = new Set([
  "ARK_TIMEOUT",
  "ARK_PROVIDER_ERROR",
  "COZE_TIMEOUT",
  "COZE_PROVIDER_ERROR",
  "PROVIDER_TIMEOUT",
  "QWEN_PROVIDER_ERROR",
  "TASK_FAILED",
]);

export function supportsTaskAutomaticRetry(
  task: RetryableTaskShape
): boolean {
  return (
    task.kind === "image" ||
    task.kind === "music" ||
    (task.kind === "audio" && TTS_MODEL_KEYS.has(task.modelKey))
  );
}

const INPUT_CHANGE_REQUIRED_CODES = new Map([
  [
    "ARK_CONTENT_REJECTED",
    "内容未通过模型安全检查，请先复用配置并修改提示词或参考素材。",
  ],
  [
    "ARK_REQUEST_REJECTED",
    "模型无法处理当前输入，请先复用配置并调整参数或参考素材。",
  ],
]);

export function manualRetryBlockReason(
  task: RetryableTaskShape
): string | null {
  return task.errorCode
    ? (INPUT_CHANGE_REQUIRED_CODES.get(task.errorCode) ?? null)
    : null;
}

export function supportsTaskManualRetry(task: RetryableTaskShape): boolean {
  return (
    !manualRetryBlockReason(task) &&
    (task.kind === "video" || supportsTaskAutomaticRetry(task))
  );
}

export function manualRetryNeedsConfirmation(
  errorCode: string | null | undefined,
  providerTaskId?: string | null
): boolean {
  return !!providerTaskId || (!!errorCode && AMBIGUOUS_RETRY_CODES.has(errorCode));
}

export function parseTaskContextJson(
  contextJson: string | null | undefined
): Record<string, unknown> {
  if (!contextJson) return {};
  try {
    const parsed = JSON.parse(contextJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function serializeTaskContextJson(
  context: Record<string, unknown>
): string | null {
  return Object.keys(context).length ? JSON.stringify(context) : null;
}

export function automaticTaskRetryInfo(
  contextJson: string | null | undefined
): AutomaticTaskRetryInfo | null {
  const value = parseTaskContextJson(contextJson).automaticRetry;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const retry = value as Record<string, unknown>;
  const dueAt = Number(retry.dueAt);
  const nextAttempt = Number(retry.nextAttempt);
  const maxAttempts = Number(retry.maxAttempts);
  const reasonCode = String(retry.reasonCode ?? "");
  const message = String(retry.message ?? "");
  if (
    !Number.isFinite(dueAt) ||
    !Number.isInteger(nextAttempt) ||
    !Number.isInteger(maxAttempts) ||
    nextAttempt < 2 ||
    maxAttempts < nextAttempt ||
    !reasonCode ||
    !message
  ) {
    return null;
  }
  return { dueAt, nextAttempt, maxAttempts, reasonCode, message };
}

export function withAutomaticTaskRetry(
  contextJson: string | null | undefined,
  retry: AutomaticTaskRetryInfo
): string {
  return JSON.stringify({
    ...parseTaskContextJson(contextJson),
    automaticRetry: retry,
  });
}

export function withoutAutomaticTaskRetry(
  contextJson: string | null | undefined
): string | null {
  const context = parseTaskContextJson(contextJson);
  delete context.automaticRetry;
  return serializeTaskContextJson(context);
}

export function taskAutomaticRetryReady(
  contextJson: string | null | undefined,
  now = Date.now()
): boolean {
  const retry = automaticTaskRetryInfo(contextJson);
  return !retry || retry.dueAt <= now;
}
