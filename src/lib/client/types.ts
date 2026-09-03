import type { ProjectRole } from "@/lib/projects/roles";
import type { FormulaAssetState } from "@/lib/formula-assets";

export type {
  QwenTtsCapacityDto,
  QwenTtsHealthDto,
  QwenTtsHealthStatus,
  QwenTtsInstanceHealthDto,
  QwenTtsInstanceKey,
} from "@/lib/modelscope/types";

export interface AssetDto {
  id: string;
  projectId: string;
  userId: string;
  kind: "text" | "image" | "video" | "audio";
  objectKey: string | null;
  mime: string | null;
  bytes: number | null;
  textContent: string | null;
  metaJson: string;
  sourceTaskId: string | null;
  /** 评审状态：采用 / 废弃 */
  reviewStatus: "approved" | "rejected" | null;
  /** 收藏「可用备选」，独立于评审 */
  favorite: boolean;
  createdAt: number;
}

export interface AssetPageDto {
  items: AssetDto[];
  nextCursor: string | null;
}

export interface AssetCommentDto {
  id: string;
  assetId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: number;
}

export interface TaskDto {
  id: string;
  projectId: string;
  userId: string;
  kind: "text" | "image" | "video" | "audio" | "music" | "edit";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  modelKey: string;
  inputJson: string;
  arkTaskId: string | null;
  outputAssetId: string | null;
  contextJson: string | null;
  error: string | null;
  errorCode: string | null;
  errorRequestId: string | null;
  deletedAt: number | null;
  usageJson: string | null;
  /** worker 实际领取次数；旧接口或测试夹具可能不包含。 */
  attemptCount?: number;
  /** 首次开始执行、最近终态时间。 */
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  createdAt: number;
  updatedAt: number;
  /** tasks API withAssets=1 时内嵌的产物资产 */
  outputAsset?: AssetDto | null;
}

export interface AssetTranscriptDto {
  assetId: string;
  taskId: string | null;
  status: TaskDto["status"] | null;
  /** 供应商返回的原始识别纯文本，用于恢复自动识别版本。 */
  sourceText: string | null;
  /** 当前项目缓存的校对版本；未校对时与 sourceText 相同。 */
  text: string | null;
  error: string | null;
  errorCode: string | null;
  updatedAt: number | string;
}

/** 素材的展示名：设定名 > 上传文件名 > 提示词摘要 > 类型+短 ID */
export function assetLabel(a: AssetDto): string {
  const meta = assetMeta(a);
  if (meta.presetName) return meta.presetName;
  if (meta.filename) return meta.filename;
  if (meta.prompt) return meta.prompt.slice(0, 24);
  return `${a.kind}-${a.id.slice(0, 6)}`;
}

export interface ProjectDetailDto {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  visibility: "private" | "org" | "dept";
  archivedAt: number | string | null;
  /** 系统自动维护的个人创作空间，不作为正式项目展示。 */
  isDefault?: boolean;
  /** 当前用户是否可编辑（Owner/Editor/管理员 true；Viewer 与公开非成员只读） */
  canEdit: boolean;
  /** 当前用户是否可以执行项目生命周期管理。 */
  canManage: boolean;
  isMember: boolean;
  currentUserRole: ProjectRole | "admin";
  members: {
    id: string;
    name: string;
    email: string;
    online: boolean;
    role: ProjectRole;
    isOwner: boolean;
  }[];
}

export interface ProjectListDto {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  visibility: "private" | "org" | "dept";
  createdAt: number | string;
  updatedAt: number | string;
  archivedAt: number | string | null;
  mine: boolean;
  createdByMe: boolean;
  participating: boolean;
  favorite: boolean;
  lastOpenedAt: number | string | null;
  currentUserRole: ProjectRole | "admin";
  canEdit: boolean;
  canManage: boolean;
  isDefault: boolean;
}

export interface MeDto {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
}

/** 当前用户的身份信息（GET /api/me/ldap）；cas-ldap 仅能拿到账号，无完整档案 */
export interface LdapProfileDto {
  casMode: boolean;
  /** LDAP 登录名（本地模式为 null） */
  ldap: string | null;
  name: string | null;
  email: string | null;
  /** 部门：预留，需接公司目录服务后才有值 */
  department: string | null;
}

export function assetMeta(a: AssetDto): {
  modelName?: string;
  modelKey?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  uploaded?: boolean;
  filename?: string;
  /** 设定资产：角色 / 场景 / 风格 */
  preset?: "character" | "scene" | "style";
  presetName?: string;
  /** 公式 PNG 的可编辑配置（仅由公式资产接口写入）。 */
  formula?: FormulaAssetState;
  generated?: boolean;
} {
  try {
    return JSON.parse(a.metaJson);
  } catch {
    return {};
  }
}

export function assetRawUrl(id: string) {
  return `/api/assets/${id}/raw`;
}

/** 下载用 URL：带 download=1，后端会附带「时间_模型_提示词.ext」文件名 */
export function assetDownloadUrl(id: string) {
  return `/api/assets/${id}/raw?download=1`;
}

export function assetThumbnailUrl(id: string) {
  return `/api/assets/${id}/thumbnail`;
}
