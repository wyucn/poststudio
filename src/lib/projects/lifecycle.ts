import { and, eq, isNull } from "drizzle-orm";
import { db, projects, type Project } from "@/db";
import { isDefaultProject } from "@/lib/projects/default-project";
import {
  PROJECT_DELETE_CONFIRMATION_CODE,
  PROJECT_NAME_DUPLICATE_CODE,
  type ProjectLifecycleAction,
} from "@/lib/projects/contracts";
import { HttpError } from "@/lib/services";

export function normalizeProjectName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

export function duplicateProjectNameInList(
  candidates: readonly Pick<
    Project,
    "id" | "name" | "createdBy" | "archivedAt" | "deletedAt"
  >[],
  ownerId: string,
  name: string,
  excludeId?: string
): Pick<Project, "id" | "name"> | null {
  const normalized = normalizeProjectName(name);
  return (
    candidates.find(
      (project) =>
        project.createdBy === ownerId &&
        project.id !== excludeId &&
        project.deletedAt === null &&
        normalizeProjectName(project.name) === normalized
    ) ?? null
  );
}

export function findDuplicateProjectName(
  ownerId: string,
  name: string,
  excludeId?: string
): Pick<Project, "id" | "name"> | null {
  const candidates = db
    .select({
      id: projects.id,
      name: projects.name,
      createdBy: projects.createdBy,
      archivedAt: projects.archivedAt,
      deletedAt: projects.deletedAt,
    })
    .from(projects)
    .where(and(eq(projects.createdBy, ownerId), isNull(projects.deletedAt)))
    .all();
  return duplicateProjectNameInList(candidates, ownerId, name, excludeId);
}

export function assertLifecycleAction(
  project: Pick<Project, "id" | "createdBy" | "archivedAt" | "deletedAt">,
  action: ProjectLifecycleAction
): void {
  if (isDefaultProject(project)) {
    throw new HttpError(400, "默认创作空间由系统管理，不能执行项目生命周期操作", "DEFAULT_PROJECT_LIFECYCLE");
  }
  if (project.deletedAt) {
    throw new HttpError(404, "项目不存在");
  }
  if (action === "archive" && project.archivedAt) {
    throw new HttpError(409, "项目已经归档", "PROJECT_ALREADY_ARCHIVED");
  }
  if (action === "restore" && !project.archivedAt) {
    throw new HttpError(409, "项目当前未归档", "PROJECT_NOT_ARCHIVED");
  }
  if (action === "delete" && !project.archivedAt) {
    throw new HttpError(409, "请先归档项目，再执行删除", "PROJECT_DELETE_REQUIRES_ARCHIVE");
  }
}

export function assertDeleteConfirmation(
  projectName: string,
  confirmationName: string
): void {
  if (confirmationName !== projectName) {
    throw new HttpError(
      400,
      "请输入完全一致的项目名称，确认后才能删除",
      PROJECT_DELETE_CONFIRMATION_CODE
    );
  }
}

export { PROJECT_NAME_DUPLICATE_CODE };
