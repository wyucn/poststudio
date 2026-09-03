import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    /** 用户部门（预留，需接公司目录服务后写入），用于 dept 可见性等 */
    department: text("department"),
    /** 最近一次活跃时间（在线状态判定用） */
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("users_last_seen_idx").on(t.lastSeenAt)]
);

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull(),
  usedBy: text("used_by"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: text("created_by").notNull(),
  /**
   * 可见性：
   * - private：仅项目成员（默认）
   * - org：全公司公开，非成员可只读浏览
   * - dept：仅本部门公开（预留，待接入公司目录服务获得部门数据后启用）
   */
  visibility: text("visibility", { enum: ["private", "org", "dept"] })
    .notNull()
    .default("private"),
  /** 归档后仍可只读查看，恢复后回到活动项目列表。 */
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  /** 软删除时间；保留数据以便备份与审计，不再对用户暴露。 */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    /** 项目成员角色；所有者由 projects.created_by 作为最终权威。 */
    role: text("role", { enum: ["owner", "editor", "viewer"] })
      .notNull()
      .default("viewer"),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user_project_idx").on(t.userId, t.projectId),
  ]
);

/** 用户个人的项目发现偏好；不等同于项目成员或权限关系。 */
export const projectPreferences = sqliteTable(
  "project_preferences",
  {
    userId: text("user_id").notNull(),
    projectId: text("project_id").notNull(),
    favorite: integer("favorite", { mode: "boolean" })
      .notNull()
      .default(false),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    index("project_preferences_user_favorite_idx").on(
      t.userId,
      t.favorite,
      t.updatedAt
    ),
    index("project_preferences_user_opened_idx").on(
      t.userId,
      t.lastOpenedAt
    ),
  ]
);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  userId: text("user_id").notNull(),
  kind: text("kind", {
    enum: ["text", "image", "video", "audio", "music", "edit"],
  }).notNull(),
  status: text("status", {
    enum: ["queued", "running", "succeeded", "failed", "cancelled"],
  }).notNull(),
  modelKey: text("model_key").notNull(),
  /** 生成参数快照（prompt、size、refs 等） */
  inputJson: text("input_json").notNull(),
  /** 方舟异步任务 ID（视频） */
  arkTaskId: text("ark_task_id"),
  outputAssetId: text("output_asset_id"),
  /** 关联流水线：{ storyboardId, shotId, slot: 'image'|'video' } */
  contextJson: text("context_json"),
  /** 面向用户的安全错误文案；供应商原始响应只记录在脱敏服务端日志。 */
  error: text("error"),
  /** 稳定错误分类，便于前端提示、统计和告警。 */
  errorCode: text("error_code"),
  /** 与脱敏服务端日志关联的错误编号。 */
  errorRequestId: text("error_request_id"),
  /** 用户从生成记录/任务列表移除的时间；软删除保留额度与审计数据。 */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  /** 真实用量快照：token、图片数、联网搜索次数、服务等级等；空则回退规格估算。 */
  usageJson: text("usage_json"),
  /** 实际执行尝试次数；首次领取为 1，失败后重试会继续累加。 */
  attemptCount: integer("attempt_count").notNull().default(0),
  /** 首次被 worker 领取的时间，用于区分排队与执行耗时。 */
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  /** 成功、失败或取消的最近终态时间；重新入队时清空。 */
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  index("tasks_created_idx").on(t.createdAt),
  index("tasks_status_created_idx").on(t.status, t.createdAt),
  index("tasks_project_created_idx").on(t.projectId, t.createdAt),
  index("tasks_user_status_created_idx").on(t.userId, t.status, t.createdAt),
  index("tasks_status_ark_idx").on(t.status, t.arkTaskId),
]);

export const operationHealth = sqliteTable("operation_health", {
  key: text("key").primaryKey(),
  status: text("status", { enum: ["ok", "failed", "skipped"] }).notNull(),
  metricsJson: text("metrics_json"),
  errorRequestId: text("error_request_id"),
  alertActive: integer("alert_active", { mode: "boolean" })
    .notNull()
    .default(false),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }).notNull(),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  lastFailureAt: integer("last_failure_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * 媒体删除后的备份保留记录。素材行删除前写入墓碑，备份任务只按墓碑和
 * purgeAfter 清理远端对象，绝不把本地文件暂时缺失直接解释为删除。
 */
export const backupMediaTombstones = sqliteTable(
  "backup_media_tombstones",
  {
    objectKey: text("object_key").primaryKey(),
    assetId: text("asset_id"),
    /** 删除时的素材快照，用于保留期内的管理员恢复；远端清理后会置空。 */
    assetJson: text("asset_json"),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }).notNull(),
    purgeAfter: integer("purge_after", { mode: "timestamp_ms" }).notNull(),
    remotePurgedAt: integer("remote_purged_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("backup_media_tombstones_purge_idx").on(
      t.remotePurgedAt,
      t.purgeAfter
    ),
  ]
);

/**
 * 模型运行时配置覆盖。代码注册表仍提供安全默认值；这里只保存管理员可变的
 * Endpoint、上下线、能力覆盖和脱敏健康结果，不保存任何 API Key/Token。
 */
export const modelConfigs = sqliteTable(
  "model_configs",
  {
    key: text("key").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    endpointOverride: text("endpoint_override"),
    capabilitiesJson: text("capabilities_json"),
    healthStatus: text("health_status", {
      enum: ["unknown", "healthy", "degraded", "offline", "unconfigured"],
    })
      .notNull()
      .default("unknown"),
    healthMessage: text("health_message"),
    failureStreak: integer("failure_streak").notNull().default(0),
    healthCheckedAt: integer("health_checked_at", { mode: "timestamp_ms" }),
    updatedBy: text("updated_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("model_configs_health_updated_idx").on(
      t.healthStatus,
      t.updatedAt
    ),
  ]
);

/**
 * 用户对生成结果的真实使用行为。只记录稳定的动作、归属和模型快照，不保存
 * 提示词或素材内容；统计按 source task 去重，重复点击不会抬高使用率。
 */
export const productEvents = sqliteTable(
  "product_events",
  {
    id: text("id").primaryKey(),
    action: text("action", {
      enum: ["download", "reuse", "regenerate"],
    }).notNull(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    taskId: text("task_id"),
    assetId: text("asset_id"),
    modelKey: text("model_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("product_events_project_created_idx").on(t.projectId, t.createdAt),
    index("product_events_task_action_idx").on(t.taskId, t.action),
    index("product_events_action_created_idx").on(t.action, t.createdAt),
  ]
);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  userId: text("user_id").notNull(),
  kind: text("kind", { enum: ["text", "image", "video", "audio"] }).notNull(),
  /** 媒体文件相对路径（data/media 下），文本资产为空 */
  objectKey: text("object_key"),
  mime: text("mime"),
  bytes: integer("bytes"),
  /** 文本资产内容 */
  textContent: text("text_content"),
  /** 溯源：{ modelKey, modelName, prompt, params, sourceAssetIds } */
  metaJson: text("meta_json").notNull(),
  sourceTaskId: text("source_task_id"),
  /** 评审状态：采用 / 废弃，空为未评审 */
  reviewStatus: text("review_status", { enum: ["approved", "rejected"] }),
  /** 收藏标记「可用备选」，独立于评审状态 */
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  index("assets_created_idx").on(t.createdAt),
  index("assets_project_created_idx").on(t.projectId, t.createdAt),
  index("assets_project_kind_created_idx").on(t.projectId, t.kind, t.createdAt),
]);

/**
 * 音频素材转写缓存。sourceText 保留供应商原始识别文本，correctedText
 * 保存项目成员校对后的版本；taskId 指向最近一次后台转写任务。
 */
export const assetTranscripts = sqliteTable(
  "asset_transcripts",
  {
    assetId: text("asset_id").primaryKey(),
    projectId: text("project_id").notNull(),
    taskId: text("task_id"),
    sourceText: text("source_text"),
    correctedText: text("corrected_text"),
    subtitleSrt: text("subtitle_srt"),
    updatedBy: text("updated_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("asset_transcripts_project_updated_idx").on(
      t.projectId,
      t.updatedAt
    ),
    index("asset_transcripts_task_idx").on(t.taskId),
  ]
);

export const assetComments = sqliteTable("asset_comments", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  userId: text("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("asset_comments_asset_created_idx").on(t.assetId, t.createdAt)]);

/** 角色库：把角色作为实体管理（名字 + 文字设定 + 多视图参考图），供分镜挂载保证全片一致性 */
export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  /** 外貌 / 性格文字设定（注入分镜 LLM 提示词） */
  description: text("description"),
  /** 参考图 asset id 列表（正面 / 侧面 / 背面等多视图） */
  assetIdsJson: text("asset_ids_json").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("characters_project_created_idx").on(t.projectId, t.createdAt)]);

export const storyboards = sqliteTable("storyboards", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  idea: text("idea").notNull(),
  style: text("style"),
  status: text("status", {
    enum: ["drafting", "ready", "generating", "done", "failed"],
  }).notNull().default("ready"),
  /** Shot[] 见 src/lib/pipeline/types.ts */
  shotsJson: text("shots_json").notNull(),
  /** 角色 / 场景 / 风格设定图引用：{ characterAssetIds, sceneAssetIds, styleAssetIds } */
  refsJson: text("refs_json"),
  /** 分镜级生成设置：{ ratio, imageTier, videoResolution } */
  settingsJson: text("settings_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("storyboards_project_created_idx").on(t.projectId, t.createdAt)]);

export type User = typeof users.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type AssetComment = typeof assetComments.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectPreference = typeof projectPreferences.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type OperationHealth = typeof operationHealth.$inferSelect;
export type BackupMediaTombstone = typeof backupMediaTombstones.$inferSelect;
export type ModelConfig = typeof modelConfigs.$inferSelect;
export type ProductEvent = typeof productEvents.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type AssetTranscript = typeof assetTranscripts.$inferSelect;
export type Storyboard = typeof storyboards.$inferSelect;
// (touch: ensure full sync)
