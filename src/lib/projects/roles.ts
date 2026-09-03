export const PROJECT_ROLE_VALUES = ["owner", "editor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLE_VALUES)[number];

export const MEMBER_ROLE_VALUES = ["editor", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLE_VALUES)[number];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "所有者",
  editor: "编辑者",
  viewer: "查看者",
};

export function resolveProjectRole(
  projectOwnerId: string,
  userId: string,
  storedRole: string | null | undefined
): ProjectRole {
  if (projectOwnerId === userId) return "owner";
  return storedRole === "editor" || storedRole === "viewer" ? storedRole : "viewer";
}

export function canEditProjectRole(role: ProjectRole): boolean {
  return role === "owner" || role === "editor";
}

export function canManageProjectMembers(role: ProjectRole): boolean {
  return role === "owner";
}

export function canManageTask(
  role: ProjectRole,
  taskUserId: string,
  currentUserId: string
): boolean {
  return role === "owner" || (role === "editor" && taskUserId === currentUserId);
}

export function canDeleteAnyTask(role: ProjectRole): boolean {
  return role === "owner";
}
