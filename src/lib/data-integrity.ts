import { randomUUID } from "node:crypto";
import { and, isNotNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { assets, db, tasks } from "@/db";
import * as schema from "@/db/schema";
import { errorDiagnostic } from "@/lib/error-safety";
import {
  recordOperationFailure,
  recordOperationSuccess,
} from "@/lib/operations/health";

export type DataIntegrityDatabase = BetterSQLite3Database<typeof schema>;

export const DATA_INTEGRITY_ISSUE_KEYS = [
  "orphanInviteCreators",
  "orphanInviteUsers",
  "orphanProjectOwners",
  "orphanMemberProjects",
  "orphanMemberUsers",
  "missingOwnerMembership",
  "conflictingOwnerRoles",
  "orphanPreferenceProjects",
  "orphanPreferenceUsers",
  "orphanTaskProjects",
  "orphanTaskUsers",
  "orphanTaskOutputs",
  "taskOutputProjectMismatch",
  "orphanAssetProjects",
  "orphanAssetUsers",
  "orphanAssetSourceTasks",
  "assetSourceProjectMismatch",
  "orphanTranscriptAssets",
  "orphanTranscriptProjects",
  "orphanTranscriptTasks",
  "transcriptTaskProjectMismatch",
  "orphanTranscriptUsers",
  "transcriptProjectMismatch",
  "orphanCommentAssets",
  "orphanCommentUsers",
  "orphanCharacterProjects",
  "orphanCharacterUsers",
  "orphanStoryboardProjects",
  "orphanStoryboardUsers",
  "orphanModelConfigUsers",
  "activeAssetBackupTombstones",
  "invalidTaskInputJson",
  "invalidTaskContextJson",
  "invalidTaskUsageJson",
  "invalidAssetMetaJson",
  "invalidCharacterAssetIdsJson",
  "invalidStoryboardShotsJson",
  "invalidStoryboardRefsJson",
  "invalidStoryboardSettingsJson",
  "invalidOperationMetricsJson",
  "invalidModelCapabilitiesJson",
  "invalidBackupTombstoneAssetJson",
  "invalidBackupTombstoneTimes",
] as const;

export type DataIntegrityIssueKey =
  (typeof DATA_INTEGRITY_ISSUE_KEYS)[number];
export type DataIntegrityIssueCounts = Record<DataIntegrityIssueKey, number>;

const ADVISORY_ISSUES = new Set<DataIntegrityIssueKey>([
  "orphanTaskOutputs",
]);

export interface DataIntegrityMetrics {
  checkedRelations: number;
  blockingIssueCount: number;
  advisoryIssueCount: number;
  repairedDanglingTaskOutputs: number;
  foreignKeyViolations: number;
  quickCheckFailures: number;
  issues: DataIntegrityIssueCounts;
  durationMs: number;
}

const ISSUE_COUNT_SQL = sql.raw(`
  SELECT
    (SELECT COUNT(*) FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE u.id IS NULL) AS orphanInviteCreators,
    (SELECT COUNT(*) FROM invites i LEFT JOIN users u ON u.id = i.used_by WHERE i.used_by IS NOT NULL AND u.id IS NULL) AS orphanInviteUsers,
    (SELECT COUNT(*) FROM projects p LEFT JOIN users u ON u.id = p.created_by WHERE u.id IS NULL) AS orphanProjectOwners,
    (SELECT COUNT(*) FROM project_members m LEFT JOIN projects p ON p.id = m.project_id WHERE p.id IS NULL) AS orphanMemberProjects,
    (SELECT COUNT(*) FROM project_members m LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL) AS orphanMemberUsers,
    (SELECT COUNT(*) FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = p.created_by AND m.role = 'owner' WHERE m.project_id IS NULL) AS missingOwnerMembership,
    (SELECT COUNT(*) FROM project_members m JOIN projects p ON p.id = m.project_id WHERE m.role = 'owner' AND m.user_id <> p.created_by) AS conflictingOwnerRoles,
    (SELECT COUNT(*) FROM project_preferences x LEFT JOIN projects p ON p.id = x.project_id WHERE p.id IS NULL) AS orphanPreferenceProjects,
    (SELECT COUNT(*) FROM project_preferences x LEFT JOIN users u ON u.id = x.user_id WHERE u.id IS NULL) AS orphanPreferenceUsers,
    (SELECT COUNT(*) FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE p.id IS NULL) AS orphanTaskProjects,
    (SELECT COUNT(*) FROM tasks t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL) AS orphanTaskUsers,
    (SELECT COUNT(*) FROM tasks t LEFT JOIN assets a ON a.id = t.output_asset_id WHERE t.output_asset_id IS NOT NULL AND a.id IS NULL) AS orphanTaskOutputs,
    (SELECT COUNT(*) FROM tasks t JOIN assets a ON a.id = t.output_asset_id WHERE t.project_id <> a.project_id) AS taskOutputProjectMismatch,
    (SELECT COUNT(*) FROM assets a LEFT JOIN projects p ON p.id = a.project_id WHERE p.id IS NULL) AS orphanAssetProjects,
    (SELECT COUNT(*) FROM assets a LEFT JOIN users u ON u.id = a.user_id WHERE u.id IS NULL) AS orphanAssetUsers,
    (SELECT COUNT(*) FROM assets a LEFT JOIN tasks t ON t.id = a.source_task_id WHERE a.source_task_id IS NOT NULL AND t.id IS NULL) AS orphanAssetSourceTasks,
    (SELECT COUNT(*) FROM assets a JOIN tasks t ON t.id = a.source_task_id WHERE a.project_id <> t.project_id) AS assetSourceProjectMismatch,
    (SELECT COUNT(*) FROM asset_transcripts x LEFT JOIN assets a ON a.id = x.asset_id WHERE a.id IS NULL) AS orphanTranscriptAssets,
    (SELECT COUNT(*) FROM asset_transcripts x LEFT JOIN projects p ON p.id = x.project_id WHERE p.id IS NULL) AS orphanTranscriptProjects,
    (SELECT COUNT(*) FROM asset_transcripts x LEFT JOIN tasks t ON t.id = x.task_id WHERE x.task_id IS NOT NULL AND t.id IS NULL) AS orphanTranscriptTasks,
    (SELECT COUNT(*) FROM asset_transcripts x JOIN tasks t ON t.id = x.task_id WHERE x.project_id <> t.project_id) AS transcriptTaskProjectMismatch,
    (SELECT COUNT(*) FROM asset_transcripts x LEFT JOIN users u ON u.id = x.updated_by WHERE x.updated_by IS NOT NULL AND u.id IS NULL) AS orphanTranscriptUsers,
    (SELECT COUNT(*) FROM asset_transcripts x JOIN assets a ON a.id = x.asset_id WHERE x.project_id <> a.project_id) AS transcriptProjectMismatch,
    (SELECT COUNT(*) FROM asset_comments c LEFT JOIN assets a ON a.id = c.asset_id WHERE a.id IS NULL) AS orphanCommentAssets,
    (SELECT COUNT(*) FROM asset_comments c LEFT JOIN users u ON u.id = c.user_id WHERE u.id IS NULL) AS orphanCommentUsers,
    (SELECT COUNT(*) FROM characters x LEFT JOIN projects p ON p.id = x.project_id WHERE p.id IS NULL) AS orphanCharacterProjects,
    (SELECT COUNT(*) FROM characters x LEFT JOIN users u ON u.id = x.user_id WHERE u.id IS NULL) AS orphanCharacterUsers,
    (SELECT COUNT(*) FROM storyboards x LEFT JOIN projects p ON p.id = x.project_id WHERE p.id IS NULL) AS orphanStoryboardProjects,
    (SELECT COUNT(*) FROM storyboards x LEFT JOIN users u ON u.id = x.user_id WHERE u.id IS NULL) AS orphanStoryboardUsers,
    (SELECT COUNT(*) FROM model_configs x LEFT JOIN users u ON u.id = x.updated_by WHERE x.updated_by IS NOT NULL AND u.id IS NULL) AS orphanModelConfigUsers,
    (SELECT COUNT(*) FROM backup_media_tombstones x JOIN assets a ON a.object_key = x.object_key) AS activeAssetBackupTombstones,
    (SELECT COUNT(*) FROM tasks WHERE CASE WHEN json_valid(input_json) = 0 THEN 1 WHEN json_type(input_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidTaskInputJson,
    (SELECT COUNT(*) FROM tasks WHERE context_json IS NOT NULL AND CASE WHEN json_valid(context_json) = 0 THEN 1 WHEN json_type(context_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidTaskContextJson,
    (SELECT COUNT(*) FROM tasks WHERE usage_json IS NOT NULL AND CASE WHEN json_valid(usage_json) = 0 THEN 1 WHEN json_type(usage_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidTaskUsageJson,
    (SELECT COUNT(*) FROM assets WHERE CASE WHEN json_valid(meta_json) = 0 THEN 1 WHEN json_type(meta_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidAssetMetaJson,
    (SELECT COUNT(*) FROM characters WHERE CASE WHEN json_valid(asset_ids_json) = 0 THEN 1 WHEN json_type(asset_ids_json) <> 'array' THEN 1 ELSE 0 END = 1) AS invalidCharacterAssetIdsJson,
    (SELECT COUNT(*) FROM storyboards WHERE CASE WHEN json_valid(shots_json) = 0 THEN 1 WHEN json_type(shots_json) <> 'array' THEN 1 ELSE 0 END = 1) AS invalidStoryboardShotsJson,
    (SELECT COUNT(*) FROM storyboards WHERE refs_json IS NOT NULL AND CASE WHEN json_valid(refs_json) = 0 THEN 1 WHEN json_type(refs_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidStoryboardRefsJson,
    (SELECT COUNT(*) FROM storyboards WHERE settings_json IS NOT NULL AND CASE WHEN json_valid(settings_json) = 0 THEN 1 WHEN json_type(settings_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidStoryboardSettingsJson,
    (SELECT COUNT(*) FROM operation_health WHERE metrics_json IS NOT NULL AND CASE WHEN json_valid(metrics_json) = 0 THEN 1 WHEN json_type(metrics_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidOperationMetricsJson,
    (SELECT COUNT(*) FROM model_configs WHERE capabilities_json IS NOT NULL AND CASE WHEN json_valid(capabilities_json) = 0 THEN 1 WHEN json_type(capabilities_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidModelCapabilitiesJson,
    (SELECT COUNT(*) FROM backup_media_tombstones WHERE asset_json IS NOT NULL AND CASE WHEN json_valid(asset_json) = 0 THEN 1 WHEN json_type(asset_json) <> 'object' THEN 1 ELSE 0 END = 1) AS invalidBackupTombstoneAssetJson,
    (SELECT COUNT(*) FROM backup_media_tombstones WHERE purge_after < deleted_at OR (remote_purged_at IS NOT NULL AND remote_purged_at < deleted_at)) AS invalidBackupTombstoneTimes
`);

function numberValue(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

export function inspectDataIntegrity(
  database: DataIntegrityDatabase = db
): {
  issues: DataIntegrityIssueCounts;
  foreignKeyViolations: number;
  quickCheckFailures: number;
} {
  const raw = database.get<Record<string, unknown>>(ISSUE_COUNT_SQL) ?? {};
  const issues = Object.fromEntries(
    DATA_INTEGRITY_ISSUE_KEYS.map((key) => [key, numberValue(raw[key])])
  ) as DataIntegrityIssueCounts;
  const foreignKeyViolations = database.all(
    sql.raw("PRAGMA foreign_key_check")
  ).length;
  const quickCheckFailures = database
    .all<Record<string, unknown>>(sql.raw("PRAGMA quick_check(1)"))
    .filter((row) => String(Object.values(row)[0] ?? "") !== "ok").length;
  return { issues, foreignKeyViolations, quickCheckFailures };
}

export function repairDanglingTaskOutputs(
  database: DataIntegrityDatabase = db,
  now = new Date()
): number {
  return database
    .update(tasks)
    .set({ outputAssetId: null, updatedAt: now })
    .where(
      and(
        isNotNull(tasks.outputAssetId),
        sql`NOT EXISTS (
          SELECT 1 FROM ${assets}
          WHERE ${assets.id} = ${tasks.outputAssetId}
        )`
      )
    )
    .run().changes;
}

function issueTotal(
  issues: DataIntegrityIssueCounts,
  predicate: (key: DataIntegrityIssueKey) => boolean
): number {
  return DATA_INTEGRITY_ISSUE_KEYS.reduce(
    (total, key) => total + (predicate(key) ? issues[key] : 0),
    0
  );
}

export function runDataIntegrityCheck(
  database: DataIntegrityDatabase = db,
  options: { repairSafe?: boolean; now?: Date } = {}
): DataIntegrityMetrics {
  const startedAt = Date.now();
  const initial = inspectDataIntegrity(database);
  const repairedDanglingTaskOutputs =
    options.repairSafe && initial.issues.orphanTaskOutputs > 0
      ? repairDanglingTaskOutputs(database, options.now)
      : 0;
  const final = repairedDanglingTaskOutputs
    ? inspectDataIntegrity(database)
    : initial;
  const advisoryIssueCount = issueTotal(final.issues, (key) =>
    ADVISORY_ISSUES.has(key)
  );
  const blockingIssueCount =
    final.foreignKeyViolations +
    final.quickCheckFailures +
    issueTotal(final.issues, (key) => !ADVISORY_ISSUES.has(key));
  return {
    checkedRelations: DATA_INTEGRITY_ISSUE_KEYS.length + 2,
    blockingIssueCount,
    advisoryIssueCount,
    repairedDanglingTaskOutputs,
    foreignKeyViolations: final.foreignKeyViolations,
    quickCheckFailures: final.quickCheckFailures,
    issues: final.issues,
    durationMs: Date.now() - startedAt,
  };
}

export async function runDataIntegrityCycle(): Promise<DataIntegrityMetrics | null> {
  const startedAt = Date.now();
  try {
    const metrics = runDataIntegrityCheck(db, { repairSafe: true });
    if (metrics.blockingIssueCount > 0) {
      const requestId = randomUUID();
      console.warn(`[data-integrity][${requestId}] 发现阻断级一致性问题`, {
        blockingIssueCount: metrics.blockingIssueCount,
        advisoryIssueCount: metrics.advisoryIssueCount,
      });
      await recordOperationFailure({
        key: "data-integrity",
        requestId,
        metrics,
        action: "请运行 npm run check:data-integrity 查看分类计数，并在备份后逐项修复；不要直接删除真实数据",
      });
    } else {
      await recordOperationSuccess("data-integrity", metrics);
    }
    return metrics;
  } catch (error) {
    const requestId = randomUUID();
    console.error(
      `[data-integrity][${requestId}] 巡检失败:`,
      errorDiagnostic(error)
    );
    await recordOperationFailure({
      key: "data-integrity",
      requestId,
      metrics: { durationMs: Date.now() - startedAt },
      action: "请检查 SQLite 文件可读性、迁移状态和服务器磁盘，再手动运行 npm run check:data-integrity",
    });
    return null;
  }
}

const BOOT_DELAY_MS = 2 * 60 * 1000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startDataIntegrityScheduler(): void {
  const globalState = globalThis as unknown as {
    __haitunDataIntegrity?: NodeJS.Timeout;
  };
  if (globalState.__haitunDataIntegrity) return;
  const run = () => void runDataIntegrityCycle();
  setTimeout(run, BOOT_DELAY_MS);
  globalState.__haitunDataIntegrity = setInterval(run, INTERVAL_MS);
  console.log("[haitun-post-studio] 数据一致性巡检调度器已启动");
}
