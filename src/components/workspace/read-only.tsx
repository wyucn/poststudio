"use client";

import { createContext, useContext } from "react";
import type { ProjectRole } from "@/lib/projects/roles";

interface ProjectAccessValue {
  canEdit: boolean;
  canManage: boolean;
  role: ProjectRole | "admin";
  userId: string;
}

const ProjectAccessContext = createContext<ProjectAccessValue>({
  canEdit: false,
  canManage: false,
  role: "viewer",
  userId: "",
});

export function CanEditProvider({
  value,
  canManage,
  role,
  userId,
  children,
}: {
  value: boolean;
  canManage: boolean;
  role: ProjectRole | "admin";
  userId: string;
  children: React.ReactNode;
}) {
  return (
    <ProjectAccessContext.Provider
      value={{ canEdit: value, canManage, role, userId }}
    >
      {children}
    </ProjectAccessContext.Provider>
  );
}

export function useCanEdit(): boolean {
  return useContext(ProjectAccessContext).canEdit;
}

export function useProjectAccess(): ProjectAccessValue {
  return useContext(ProjectAccessContext);
}
