import type {
  ImageCapability,
  VideoCapability,
} from "@/lib/ark/capabilities";

export type ManagedModelProvider = "ark" | "coze" | "modelscope";
export type ManagedModelKind =
  | "image"
  | "video"
  | "music"
  | "audio"
  | "edit"
  | "text";

export type ManagedModelHealthStatus =
  | "unknown"
  | "healthy"
  | "degraded"
  | "offline"
  | "unconfigured"
  | "disabled";

export type ManagedModelCapabilities =
  | ImageCapability
  | VideoCapability
  | Record<string, unknown>
  | null;

export interface ManagedModelPublicDto {
  /** 配置主键；Qwen 实例使用 modelKey:instance。 */
  key: string;
  /** 任务表和历史记录使用的稳定模型 key。 */
  modelKey: string;
  instanceKey: string | null;
  provider: ManagedModelProvider;
  kind: ManagedModelKind;
  label: string;
  description: string;
  default: boolean;
  enabled: boolean;
  capabilities: ManagedModelCapabilities;
  healthStatus: ManagedModelHealthStatus;
  healthMessage: string;
  healthCheckedAt: string | null;
}

export interface ManagedModelAdminDto extends ManagedModelPublicDto {
  endpoint: string | null;
  defaultEndpoint: string | null;
  endpointOverridden: boolean;
  credentialEnv: string | null;
  credentialConfigured: boolean;
  capabilityEditable: boolean;
  defaultCapabilities: ManagedModelCapabilities;
  capabilitiesOverridden: boolean;
  failureStreak: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ManagedModelCatalogResponse {
  items: ManagedModelPublicDto[];
  generatedAt: string;
}

export interface ManagedModelAdminResponse {
  items: ManagedModelAdminDto[];
  generatedAt: string;
}
