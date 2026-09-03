import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, modelConfigs, type ModelConfig, type Task } from "@/db";
import {
  type ImageCapability,
  type VideoCapability,
} from "@/lib/ark/capabilities";
import { getModel, type ArkModel } from "@/lib/ark/models";
import { HttpError } from "@/lib/http-error";
import {
  qwenTtsDefaultInstance,
  qwenTtsInstanceConfigs,
  type QwenTtsInstanceConfig,
} from "@/lib/modelscope/qwen-tts-runtime";
import type { QwenTtsInstanceKey } from "@/lib/modelscope/types";
import {
  MANAGED_MODEL_DEFINITIONS,
  QWEN_PUBLIC_CONFIG_KEY,
  QWEN_SELF_HOSTED_CONFIG_KEY,
  managedModelDefinition,
  type ManagedModelDefinition,
} from "./catalog";
import type {
  ManagedModelAdminDto,
  ManagedModelCapabilities,
  ManagedModelHealthStatus,
  ManagedModelPublicDto,
} from "./contracts";

type Env = Record<string, string | undefined>;

const imageCapabilitySchema = z
  .object({
    tiers: z.array(z.enum(["1K", "2K", "3K", "4K"])).min(1),
    defaultTier: z.enum(["1K", "2K", "3K", "4K"]),
    maxRefImages: z.number().int().min(0).max(14),
    supportsStream: z.boolean(),
    supportsSequential: z.boolean(),
    maxImagesPerGen: z.number().int().min(1).max(15),
    supportsFast: z.boolean(),
    supportsOutputFormat: z.boolean(),
    supportsWebSearch: z.boolean(),
    supportsInteractiveEdit: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.tiers.includes(value.defaultTier)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultTier"],
        message: "默认分辨率必须包含在 tiers 中",
      });
    }
  });

const videoFramesSchema = z
  .object({
    min: z.number().int().min(1),
    max: z.number().int().min(1),
    step: z.number().int().min(1),
    fps: z.number().int().min(1).max(120),
  })
  .superRefine((value, ctx) => {
    if (value.min > value.max) {
      ctx.addIssue({
        code: "custom",
        path: ["min"],
        message: "frames.min 不能大于 frames.max",
      });
    }
  });

const videoCapabilitySchema = z
  .object({
    resolutions: z
      .array(z.enum(["480p", "720p", "1080p", "4k"]))
      .min(1),
    defaultResolution: z.enum(["480p", "720p", "1080p", "4k"]),
    adaptiveRatio: z.boolean(),
    duration: z.object({
      min: z.number().int().min(1).max(60),
      max: z.number().int().min(1).max(60),
    }),
    smartDuration: z.boolean(),
    modes: z
      .array(
        z.enum(["t2v", "first_frame", "first_last", "reference", "extend"])
      )
      .min(1),
    maxRefImages: z.number().int().min(0).max(20),
    maxRefVideos: z.number().int().min(0).max(10),
    maxRefAudios: z.number().int().min(0).max(10),
    generateAudio: z.boolean(),
    cameraFixed: z.boolean(),
    returnLastFrame: z.boolean(),
    webSearch: z.boolean(),
    priority: z.boolean(),
    seed: z.boolean(),
    draft: z.boolean(),
    serviceTiers: z.array(z.enum(["default", "flex"])).min(1),
    frames: videoFramesSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.resolutions.includes(value.defaultResolution)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultResolution"],
        message: "默认分辨率必须包含在 resolutions 中",
      });
    }
    if (value.duration.min > value.duration.max) {
      ctx.addIssue({
        code: "custom",
        path: ["duration"],
        message: "duration.min 不能大于 duration.max",
      });
    }
    if (!value.modes.includes("t2v")) {
      ctx.addIssue({
        code: "custom",
        path: ["modes"],
        message: "视频模型至少保留 t2v 模式",
      });
    }
  });

function rowMap(): Map<string, ModelConfig> {
  return new Map(
    db
      .select()
      .from(modelConfigs)
      .all()
      .map((row) => [row.key, row])
  );
}

function qwenBaseConfig(
  definition: ManagedModelDefinition,
  env: Env
): QwenTtsInstanceConfig | null {
  if (definition.provider !== "modelscope" || !definition.instanceKey) {
    return null;
  }
  return (
    qwenTtsInstanceConfigs(env).find(
      (config) => config.key === definition.instanceKey
    ) ?? null
  );
}

function defaultEndpoint(
  definition: ManagedModelDefinition,
  env: Env
): string | null {
  return qwenBaseConfig(definition, env)?.url ?? definition.endpointDefault;
}

function credentialConfigured(
  definition: ManagedModelDefinition,
  env: Env
): boolean {
  const qwen = qwenBaseConfig(definition, env);
  if (qwen) {
    return !qwen.requiresAccessToken || !!qwen.accessToken;
  }
  return definition.credentialEnv
    ? !!env[definition.credentialEnv]?.trim()
    : true;
}

function parsedCapabilities(
  definition: ManagedModelDefinition,
  row: ModelConfig | undefined
): ManagedModelCapabilities {
  if (!row?.capabilitiesJson) return definition.capabilities;
  try {
    return validateManagedCapabilities(
      definition,
      JSON.parse(row.capabilitiesJson) as unknown
    );
  } catch {
    return definition.capabilities;
  }
}

function effectiveAdminItem(
  definition: ManagedModelDefinition,
  row: ModelConfig | undefined,
  env: Env
): ManagedModelAdminDto {
  const baseEndpoint = defaultEndpoint(definition, env);
  const endpoint = row?.endpointOverride?.trim() || baseEndpoint;
  const enabled = row?.enabled ?? true;
  const hasCredential = credentialConfigured(definition, env);
  const configured = !!endpoint && hasCredential;
  let healthStatus: ManagedModelHealthStatus = row?.healthStatus ?? "unknown";
  let healthMessage = row?.healthMessage ?? "尚无真实任务或主动检查结果。";
  if (!enabled) {
    healthStatus = "disabled";
    healthMessage = "管理员已下线，新的生成请求会被拦截。";
  } else if (!configured) {
    healthStatus = "unconfigured";
    healthMessage = !endpoint
      ? "尚未配置 Endpoint。"
      : `凭据 ${definition.credentialEnv ?? "（无需令牌）"} 尚未配置。`;
  } else if (healthStatus === "unconfigured") {
    healthStatus = "unknown";
    healthMessage = "配置已补齐，等待健康检查或真实任务验证。";
  }

  return {
    key: definition.key,
    modelKey: definition.modelKey,
    instanceKey: definition.instanceKey,
    provider: definition.provider,
    kind: definition.kind,
    label: definition.label,
    description: definition.description,
    default: definition.default,
    enabled,
    capabilities: parsedCapabilities(definition, row),
    healthStatus,
    healthMessage,
    healthCheckedAt: row?.healthCheckedAt?.toISOString() ?? null,
    endpoint,
    defaultEndpoint: baseEndpoint,
    endpointOverridden: !!row?.endpointOverride,
    credentialEnv: definition.credentialEnv,
    credentialConfigured: hasCredential,
    capabilityEditable: definition.capabilityEditable,
    defaultCapabilities: definition.capabilities,
    capabilitiesOverridden: !!row?.capabilitiesJson,
    failureStreak: row?.failureStreak ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

function publicItem(item: ManagedModelAdminDto): ManagedModelPublicDto {
  const healthMessage =
    item.healthStatus === "disabled"
      ? "该模型已暂时下线，请切换其他模型或稍后重试。"
      : item.healthStatus === "unconfigured"
        ? "模型服务尚未完成配置，请联系管理员。"
        : item.healthStatus === "offline"
          ? "模型服务暂时不可用，请切换其他模型或稍后重试。"
          : item.healthStatus === "degraded"
            ? "模型服务近期存在波动，任务可能需要更久时间。"
            : item.healthStatus === "healthy"
              ? "最近一次服务检查或真实任务正常。"
              : "尚无近期服务状态。";
  return {
    key: item.key,
    modelKey: item.modelKey,
    instanceKey: item.instanceKey,
    provider: item.provider,
    kind: item.kind,
    label: item.label,
    description: item.description,
    default: item.default,
    enabled: item.enabled,
    capabilities: item.capabilities,
    healthStatus: item.healthStatus,
    healthMessage,
    healthCheckedAt: item.healthCheckedAt,
  };
}

export function managedModelAdminCatalog(
  env: Env = process.env
): ManagedModelAdminDto[] {
  const rows = rowMap();
  return MANAGED_MODEL_DEFINITIONS.map((definition) =>
    effectiveAdminItem(definition, rows.get(definition.key), env)
  );
}

export function managedModelPublicCatalog(
  env: Env = process.env
): ManagedModelPublicDto[] {
  return managedModelAdminCatalog(env).map(publicItem);
}

export function managedModelAdminConfig(
  key: string,
  env: Env = process.env
): ManagedModelAdminDto {
  const definition = managedModelDefinition(key);
  if (!definition) throw new HttpError(404, "模型配置不存在", "MODEL_CONFIG_NOT_FOUND");
  const row = db.select().from(modelConfigs).where(eq(modelConfigs.key, key)).get();
  return effectiveAdminItem(definition, row, env);
}

export function validateManagedCapabilities(
  definition: ManagedModelDefinition,
  value: unknown
): ManagedModelCapabilities {
  if (!definition.capabilityEditable) {
    throw new HttpError(
      400,
      "当前服务的能力由插件或实例固定，不支持覆盖",
      "MODEL_CAPABILITY_READ_ONLY"
    );
  }
  const result =
    definition.kind === "image"
      ? imageCapabilitySchema.safeParse(value)
      : definition.kind === "video"
        ? videoCapabilitySchema.safeParse(value)
        : z.record(z.string(), z.unknown()).safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      result.error.issues[0]?.message ?? "模型能力配置无效",
      "MODEL_CAPABILITY_INVALID"
    );
  }
  return result.data as ImageCapability | VideoCapability | Record<string, unknown>;
}

function assertEndpointUrlHasNoCredentials(parsed: URL): void {
  if (parsed.username || parsed.password) {
    throw new HttpError(
      400,
      "Endpoint 不得包含用户名、密码或访问令牌",
      "MODEL_ENDPOINT_SECRET_FORBIDDEN"
    );
  }
  if (parsed.hash) {
    throw new HttpError(
      400,
      "Endpoint 不得包含 URL 片段",
      "MODEL_ENDPOINT_INVALID"
    );
  }
  const sensitiveQueryKey = [...parsed.searchParams.keys()].find((key) => {
    const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return [
      "apikey",
      "accesskey",
      "accesstoken",
      "authorization",
      "auth",
      "bearer",
      "clientsecret",
      "servicekey",
      "token",
      "secret",
      "password",
      "passwd",
      "signature",
      "credential",
    ].some((name) => compact === name || compact.endsWith(name));
  });
  if (sensitiveQueryKey) {
    throw new HttpError(
      400,
      "Endpoint 不得在查询参数中携带凭据，密钥只能通过服务器环境变量配置",
      "MODEL_ENDPOINT_SECRET_FORBIDDEN"
    );
  }
}

export function normalizeManagedEndpoint(
  definition: ManagedModelDefinition,
  endpoint: string | null,
  env: Env
): string | null {
  const value = endpoint?.trim() || null;
  if (!value) return null;
  if (definition.provider === "modelscope") {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new HttpError(400, "Endpoint 必须是有效 URL", "MODEL_ENDPOINT_INVALID");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new HttpError(
        400,
        "Endpoint 只支持 HTTP/HTTPS",
        "MODEL_ENDPOINT_INVALID"
      );
    }
    assertEndpointUrlHasNoCredentials(parsed);
    return parsed.toString().replace(/\/$/, "");
  }
  if (definition.provider === "coze" && /^https?:\/\//i.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new HttpError(400, "Endpoint 必须是有效 URL", "MODEL_ENDPOINT_INVALID");
    }
    if (parsed.protocol !== "https:") {
      throw new HttpError(
        400,
        "Coze 完整 Endpoint 必须使用 HTTPS",
        "MODEL_ENDPOINT_INVALID"
      );
    }
    assertEndpointUrlHasNoCredentials(parsed);
    return parsed.toString().replace(/\/$/, "");
  }
  const validIdentifier =
    definition.provider === "coze"
      ? /^\d{5,40}$/.test(value)
      : /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value);
  if (!validIdentifier) {
    throw new HttpError(400, "Endpoint 格式无效", "MODEL_ENDPOINT_INVALID");
  }
  const fallback = defaultEndpoint(definition, env);
  return value === fallback ? null : value;
}

export function updateManagedModelConfig(input: {
  key: string;
  enabled: boolean;
  endpoint: string | null;
  capabilities: unknown | null;
  updatedBy: string;
  env?: Env;
}): ManagedModelAdminDto {
  const env = input.env ?? process.env;
  const definition = managedModelDefinition(input.key);
  if (!definition) throw new HttpError(404, "模型配置不存在", "MODEL_CONFIG_NOT_FOUND");
  const endpointOverride = normalizeManagedEndpoint(
    definition,
    input.endpoint,
    env
  );
  let capabilitiesJson: string | null = null;
  if (input.capabilities !== null) {
    const parsed = validateManagedCapabilities(definition, input.capabilities);
    if (JSON.stringify(parsed) !== JSON.stringify(definition.capabilities)) {
      capabilitiesJson = JSON.stringify(parsed);
    }
  }
  const now = new Date();
  db.insert(modelConfigs)
    .values({
      key: input.key,
      enabled: input.enabled,
      endpointOverride,
      capabilitiesJson,
      healthStatus: "unknown",
      healthMessage: null,
      failureStreak: 0,
      healthCheckedAt: null,
      updatedBy: input.updatedBy,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: modelConfigs.key,
      set: {
        enabled: input.enabled,
        endpointOverride,
        capabilitiesJson,
        healthStatus: "unknown",
        healthMessage: null,
        failureStreak: 0,
        healthCheckedAt: null,
        updatedBy: input.updatedBy,
        updatedAt: now,
      },
    })
    .run();
  return managedModelAdminConfig(input.key, env);
}

export function assertManagedModelAvailable(
  key: string,
  env: Env = process.env
): ManagedModelAdminDto {
  const item = managedModelAdminConfig(key, env);
  if (!item.enabled) {
    throw new HttpError(
      503,
      `${item.label} 已由管理员暂时下线，请切换其他模型或稍后重试。`,
      "MODEL_DISABLED"
    );
  }
  if (!item.endpoint || !item.credentialConfigured) {
    throw new HttpError(
      503,
      `${item.label} 尚未完成服务配置，请联系管理员。`,
      "MODEL_NOT_CONFIGURED"
    );
  }
  return item;
}

function runtimeArkModel(
  modelKey: string,
  expectedKind: "image" | "video",
  env: Env
): ArkModel & { capability: ImageCapability | VideoCapability } {
  const base = getModel(modelKey);
  const item = assertManagedModelAvailable(modelKey, env);
  if (
    item.provider !== "ark" ||
    item.kind !== expectedKind ||
    !item.endpoint ||
    !item.capabilities
  ) {
    throw new HttpError(400, "模型类型配置无效", "MODEL_CONFIG_INVALID");
  }
  return {
    ...base,
    endpointId: item.endpoint,
    capability: item.capabilities as ImageCapability | VideoCapability,
  };
}

export function runtimeImageModel(
  modelKey: string,
  env: Env = process.env
): ArkModel & { capability: ImageCapability } {
  return runtimeArkModel(modelKey, "image", env) as ArkModel & {
    capability: ImageCapability;
  };
}

export function runtimeVideoModel(
  modelKey: string,
  env: Env = process.env
): ArkModel & { capability: VideoCapability } {
  return runtimeArkModel(modelKey, "video", env) as ArkModel & {
    capability: VideoCapability;
  };
}

export function managedCozeEndpoint(
  configKey: string,
  env: Env = process.env
): string {
  const item = assertManagedModelAvailable(configKey, env);
  if (item.provider !== "coze" || !item.endpoint) {
    throw new HttpError(400, "Coze Endpoint 配置无效", "MODEL_CONFIG_INVALID");
  }
  return item.endpoint;
}

export interface EffectiveQwenTtsInstanceConfig
  extends QwenTtsInstanceConfig {
  configKey: string;
  enabled: boolean;
}

function qwenConfigKey(key: QwenTtsInstanceKey): string {
  return key === "public"
    ? QWEN_PUBLIC_CONFIG_KEY
    : QWEN_SELF_HOSTED_CONFIG_KEY;
}

export function effectiveQwenTtsInstanceConfig(
  key: QwenTtsInstanceKey,
  env: Env = process.env
): EffectiveQwenTtsInstanceConfig {
  const base = qwenTtsInstanceConfigs(env).find((config) => config.key === key)!;
  const managed = managedModelAdminConfig(qwenConfigKey(key), env);
  return {
    ...base,
    url: managed.endpoint,
    configured:
      managed.enabled && !!managed.endpoint && managed.credentialConfigured,
    configKey: managed.key,
    enabled: managed.enabled,
  };
}

export function effectiveQwenTtsInstanceConfigs(
  env: Env = process.env
): EffectiveQwenTtsInstanceConfig[] {
  return (["public", "self-hosted"] as const).map((key) =>
    effectiveQwenTtsInstanceConfig(key, env)
  );
}

export function effectiveQwenTtsDefaultInstance(
  env: Env = process.env
): QwenTtsInstanceKey {
  const preferred = qwenTtsDefaultInstance(env);
  const preferredConfig = effectiveQwenTtsInstanceConfig(preferred, env);
  if (preferredConfig.configured) return preferred;
  const fallback = preferred === "public" ? "self-hosted" : "public";
  return effectiveQwenTtsInstanceConfig(fallback, env).configured
    ? fallback
    : preferred;
}

function taskConfigKey(task: Pick<Task, "modelKey" | "inputJson">): string {
  if (task.modelKey !== "modelscope-qwen3-tts") return task.modelKey;
  try {
    const input = JSON.parse(task.inputJson) as { instance?: unknown };
    return input.instance === "self-hosted"
      ? QWEN_SELF_HOSTED_CONFIG_KEY
      : QWEN_PUBLIC_CONFIG_KEY;
  } catch {
    return QWEN_PUBLIC_CONFIG_KEY;
  }
}

function upsertHealth(input: {
  key: string;
  status: Exclude<ManagedModelHealthStatus, "disabled">;
  message: string;
  failureStreak: number;
  checkedAt?: Date;
}): void {
  if (!managedModelDefinition(input.key)) return;
  const now = input.checkedAt ?? new Date();
  db.insert(modelConfigs)
    .values({
      key: input.key,
      enabled: true,
      endpointOverride: null,
      capabilitiesJson: null,
      healthStatus: input.status,
      healthMessage: input.message,
      failureStreak: input.failureStreak,
      healthCheckedAt: now,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: modelConfigs.key,
      set: {
        healthStatus: input.status,
        healthMessage: input.message,
        failureStreak: input.failureStreak,
        healthCheckedAt: now,
        updatedAt: now,
      },
    })
    .run();
}

export function recordManagedHealthCheck(input: {
  key: string;
  status:
    | "unknown"
    | "healthy"
    | "degraded"
    | "offline"
    | "unconfigured";
  message: string;
  checkedAt?: Date;
}): void {
  const current = db
    .select({ failureStreak: modelConfigs.failureStreak })
    .from(modelConfigs)
    .where(eq(modelConfigs.key, input.key))
    .get();
  upsertHealth({
    ...input,
    failureStreak:
      input.status === "healthy"
        ? 0
        : input.status === "unconfigured" || input.status === "unknown"
          ? 0
          : (current?.failureStreak ?? 0) + 1,
  });
}

export function recordManagedTaskSuccess(
  task: Pick<Task, "modelKey" | "inputJson">
): void {
  upsertHealth({
    key: taskConfigKey(task),
    status: "healthy",
    message: "最近一次真实任务已成功执行。",
    failureStreak: 0,
  });
}

const PROVIDER_HEALTH_FAILURE_CODES = new Set([
  "ARK_AUTH_ERROR",
  "ARK_RATE_LIMITED",
  "ARK_TIMEOUT",
  "ARK_PROVIDER_ERROR",
  "ARK_VIDEO_FAILED",
  "ARK_VIDEO_EXPIRED",
  "VIDEO_EXECUTION_TIMEOUT",
  "COZE_AUTH_ERROR",
  "COZE_RATE_LIMITED",
  "COZE_TIMEOUT",
  "COZE_PROVIDER_ERROR",
  "QWEN_INSTANCE_NOT_CONFIGURED",
  "QWEN_MODEL_LOAD_FAILED",
  "QWEN_PROVIDER_ERROR",
  "PROVIDER_TIMEOUT",
]);

export function recordManagedTaskFailure(
  task: Pick<Task, "modelKey" | "inputJson">,
  code: string
): void {
  if (!PROVIDER_HEALTH_FAILURE_CODES.has(code)) return;
  const key = taskConfigKey(task);
  const current = db
    .select({ failureStreak: modelConfigs.failureStreak })
    .from(modelConfigs)
    .where(eq(modelConfigs.key, key))
    .get();
  const failureStreak = (current?.failureStreak ?? 0) + 1;
  upsertHealth({
    key,
    status: failureStreak >= 3 ? "offline" : "degraded",
    message: `最近一次真实任务返回服务错误（${code}）。`,
    failureStreak,
  });
}
