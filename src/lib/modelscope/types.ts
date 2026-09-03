export const QWEN_TTS_INSTANCE_KEYS = ["public", "self-hosted"] as const;

export type QwenTtsInstanceKey = (typeof QWEN_TTS_INSTANCE_KEYS)[number];

export const QWEN_TTS_HEALTH_STATUSES = [
  "healthy",
  "degraded",
  "offline",
  "unconfigured",
  "disabled",
] as const;

export type QwenTtsHealthStatus = (typeof QWEN_TTS_HEALTH_STATUSES)[number];

export interface QwenTtsCapacityDto {
  queued: number;
  running: number;
  limit: number;
  /** 0–1，便于前端显示当前实例的排队压力。 */
  utilization: number;
  hint: string;
}

export interface QwenTtsInstanceHealthDto {
  key: QwenTtsInstanceKey;
  label: string;
  experimental: boolean;
  configured: boolean;
  status: QwenTtsHealthStatus;
  message: string;
  latencyMs: number | null;
  capacity: QwenTtsCapacityDto;
}

export interface QwenTtsHealthDto {
  defaultInstance: QwenTtsInstanceKey;
  checkedAt: string;
  instances: QwenTtsInstanceHealthDto[];
}
