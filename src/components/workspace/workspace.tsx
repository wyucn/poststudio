"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  Film,
  FolderKanban,
  FolderOpen,
  Globe2,
  ImagePlus,
  Library,
  ListChecks,
  LockKeyhole,
  LogOut,
  LoaderCircle,
  Mic,
  Music,
  Pencil,
  Plus,
  Save,
  Search,
  Sigma,
  Sparkles,
  Star,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { DolphinMark } from "@/components/dolphin-mark";
import { api, ApiError } from "@/lib/client/api";
import type {
  AssetDto,
  ProjectDetailDto,
  ProjectListDto,
} from "@/lib/client/types";
import {
  filterAndSortProjects,
  type ProjectScope,
  type ProjectSort,
} from "@/lib/projects/discovery";
import { PROJECT_NAME_DUPLICATE_CODE } from "@/lib/projects/contracts";
import {
  PROJECT_ROLE_LABELS,
  type MemberRole,
} from "@/lib/projects/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState } from "@/components/ui/loading-state";
import { SelectionIndicator } from "@/components/ui/selection-indicator";
import { StatusMessage } from "@/components/ui/status-message";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogInlineContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CreateTab, type CreateTabKind } from "./create-tab";
import { CanEditProvider } from "./read-only";

function WorkspaceSectionLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-80 items-center justify-center" data-workspace-section-loading>
      <LoadingState label={label} />
    </div>
  );
}

const AssetsTab = dynamic(
  () => import("./assets-tab").then((module) => module.AssetsTab),
  {
    ssr: false,
    loading: () => <WorkspaceSectionLoading label="正在加载素材库…" />,
  }
);

const TasksTab = dynamic(
  () => import("./tasks-tab").then((module) => module.TasksTab),
  {
    ssr: false,
    loading: () => <WorkspaceSectionLoading label="正在加载任务中心…" />,
  }
);

function isDuplicateProjectNameError(error: Error | null): error is ApiError {
  return error instanceof ApiError && error.code === PROJECT_NAME_DUPLICATE_CODE;
}

function projectRoleLabel(
  role: ProjectDetailDto["currentUserRole"] | ProjectListDto["currentUserRole"]
): string {
  return role === "admin" ? "平台管理员" : PROJECT_ROLE_LABELS[role];
}

function ProjectMembersDialog({
  projectId,
  members,
}: {
  projectId: string;
  members: ProjectDetailDto["members"];
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const add = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/members`, {
        method: "POST",
        json: { email, role },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setEmail("");
      setRole("viewer");
    },
  });
  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
      api(`/api/projects/${projectId}/members`, {
        method: "PATCH",
        json: { userId, role },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/projects/${projectId}/members`, {
        method: "DELETE",
        json: { userId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const casMode = process.env.NEXT_PUBLIC_AUTH_MODE === "cas";
  return (
    <DialogContent className="max-h-[min(82vh,720px)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>项目成员与角色</DialogTitle>
        <DialogDescription>
          {casMode
            ? "输入同事的 LDAP 账号并选择初始角色；项目所有者或平台管理员可以继续调整成员权限。"
            : "输入对方注册邮箱并选择初始角色；项目所有者或平台管理员可以继续调整成员权限。"}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <Input
          aria-label={casMode ? "LDAP 账号" : "成员邮箱"}
          type={casMode ? "text" : "email"}
          placeholder={casMode ? "同事的 ldap，如 zhangsan" : "member@example.com"}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Select value={role} onValueChange={(value) => setRole(value as MemberRole)}>
          <SelectTrigger aria-label="新成员角色">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">查看者</SelectItem>
            <SelectItem value="editor">编辑者</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={() => add.mutate()}
          disabled={!email.trim()}
          loading={add.isPending}
          loadingText="添加中"
        >
          添加
        </Button>
      </div>
      {add.isError && <StatusMessage tone="danger">{add.error.message}</StatusMessage>}
      {add.isSuccess && <StatusMessage tone="success">成员已添加。</StatusMessage>}
      {updateRole.isError && (
        <StatusMessage tone="danger">{updateRole.error.message}</StatusMessage>
      )}
      {removeMember.isError && (
        <StatusMessage tone="danger">{removeMember.error.message}</StatusMessage>
      )}
      <div className="space-y-2 border-t border-border/70 pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">当前成员</p>
          <p className="text-xs text-muted-foreground">共 {members.length} 人</p>
        </div>
        {members.map((member) => (
          <div
            key={member.id}
            className="flex flex-col gap-3 rounded-lg border border-border/75 bg-muted/25 p-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium">{member.name}</p>
                {member.online && (
                  <span className="rounded-full border border-success/30 bg-success-muted px-2 py-0.5 text-xs text-success">
                    在线
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {member.email}
              </p>
            </div>
            {member.isOwner ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-3 text-sm font-medium">
                <ShieldCheck className="size-4" /> 所有者
              </span>
            ) : (
              <>
                <Select
                  value={member.role}
                  onValueChange={(value) =>
                    updateRole.mutate({
                      userId: member.id,
                      role: value as MemberRole,
                    })
                  }
                >
                  <SelectTrigger
                    aria-label={`成员${member.name}的项目角色`}
                    className="sm:w-32"
                  >
                    <SelectValue>{PROJECT_ROLE_LABELS[member.role]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">查看者</SelectItem>
                    <SelectItem value="editor">编辑者</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`移除成员${member.name}`}
                  title="移出项目"
                  loading={
                    removeMember.isPending && removeMember.variables === member.id
                  }
                  disabled={removeMember.isPending}
                  onClick={() => {
                    if (window.confirm(`确认将 ${member.name} 移出项目？`)) {
                      removeMember.mutate(member.id);
                    }
                  }}
                >
                  <UserMinus />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </DialogContent>
  );
}

function EditProjectDialog({ project }: { project: ProjectDetailDto }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const save = useMutation({
    mutationFn: ({ allowDuplicate = false }: { allowDuplicate?: boolean }) =>
      api(`/api/projects/${project.id}`, {
        method: "PATCH",
        json: { name, description, allowDuplicate },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="修改项目名称和描述"
          aria-label="修改项目名称和描述"
        >
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑项目信息</DialogTitle>
          <DialogDescription>项目成员都能看到更新后的名称和描述。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">项目名称</Label>
            <Input
              id="project-name"
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
                if (isDuplicateProjectNameError(save.error)) save.reset();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-description">项目描述</Label>
            <Textarea
              id="project-description"
              value={description}
              maxLength={200}
              rows={4}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {save.isError &&
            (isDuplicateProjectNameError(save.error) ? (
              <div className="space-y-2">
                <StatusMessage tone="warning">{save.error.message}</StatusMessage>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  loading={save.isPending}
                  onClick={() => save.mutate({ allowDuplicate: true })}
                >
                  仍然保存同名项目
                </Button>
              </div>
            ) : (
              <StatusMessage tone="danger">{save.error.message}</StatusMessage>
            ))}
          <Button
            className="w-full"
            onClick={() => save.mutate({})}
            disabled={!name.trim()}
            loading={save.isPending}
            loadingText="保存中"
          >
            <Save /> 保存修改
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type WorkspaceSection = CreateTabKind | "assets" | "tasks";

const PROJECT_SWITCHER_TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function ProjectSwitcher({
  currentProject,
  currentProjectId,
  open,
  onOpenChange,
  triggerRef,
}: {
  currentProject?: ProjectDetailDto;
  currentProjectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "org">("private");
  const [scope, setScope] = useState<ProjectScope>("all");
  const [sort, setSort] = useState<ProjectSort>("recent");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: activeProjects, isLoading } = useQuery<ProjectListDto[]>({
    queryKey: ["projects"],
    queryFn: () => api("/api/projects"),
    enabled: open,
  });
  const { data: archivedProjects } = useQuery<ProjectListDto[]>({
    queryKey: ["projects", "archived"],
    queryFn: () => api("/api/projects?view=archived"),
    enabled: open && !!currentProject?.archivedAt,
  });
  const projects = useMemo(() => {
    if (!currentProject?.archivedAt) return activeProjects;
    const currentArchived = archivedProjects?.find(
      (project) => project.id === currentProjectId
    );
    return currentArchived
      ? [...(activeProjects ?? []), currentArchived]
      : activeProjects;
  }, [activeProjects, archivedProjects, currentProject?.archivedAt, currentProjectId]);

  const create = useMutation({
    mutationFn: ({ allowDuplicate = false }: { allowDuplicate?: boolean }) =>
      api<{ id: string }>("/api/projects", {
        method: "POST",
        json: { name, description, visibility, allowDuplicate },
      }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setCreateOpen(false);
      setName("");
      setDescription("");
      setVisibility("private");
      onOpenChange(false);
      router.push(`/projects/${project.id}`);
    },
  });

  const filteredProjects = useMemo(
    () =>
      filterAndSortProjects(projects ?? [], {
        query: search,
        scope,
        sort,
        favoritesOnly,
      }),
    [favoritesOnly, projects, scope, search, sort]
  );
  const defaultProjects = filteredProjects.filter((project) => project.isDefault);
  const formalProjects = filteredProjects.filter((project) => !project.isDefault);
  const filtersActive =
    !!search.trim() || scope !== "all" || favoritesOnly || sort !== "recent";
  const navigateToProject = (id: string) => {
    onOpenChange(false);
    if (id !== currentProjectId) router.push(`/projects/${id}`);
  };

  const renderProject = (project: ProjectListDto) => {
    const active = project.id === currentProjectId;
    return (
      <button
        key={project.id}
        data-project-switcher-item={project.id}
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => navigateToProject(project.id)}
        className={`project-switcher-item group flex min-h-[52px] w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
          active ? "is-active bg-primary/10 text-foreground" : "hover:bg-muted/70"
        }`}
      >
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground group-hover:text-foreground"
          }`}
        >
          {project.isDefault ? <Sparkles className="size-3.5" /> : <FolderOpen className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className="truncate text-sm font-medium"
              title={project.isDefault ? "默认创作" : project.name}
            >
              {project.isDefault ? "默认创作" : project.name}
            </span>
            {project.favorite && (
              <Star
                aria-label="已收藏"
                className="size-3.5 shrink-0 fill-current text-favorite"
              />
            )}
            {project.archivedAt ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-warning-muted px-1.5 py-0.5 text-xs text-warning">
                <Archive className="size-3" /> 已归档
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span className="shrink-0">
              {project.isDefault ? "个人空间" : projectRoleLabel(project.currentUserRole)}
            </span>
            <span aria-hidden="true">·</span>
            {project.lastOpenedAt ? (
              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                <Clock3 className="size-3 shrink-0" /> 最近 {PROJECT_SWITCHER_TIME_FORMAT.format(new Date(project.lastOpenedAt))}
              </span>
            ) : project.isDefault ? (
              <span className="truncate">随时开始</span>
            ) : (
              <span className="truncate">
                {project.visibility === "private" ? "私有" : "公司内公开"}
              </span>
            )}
          </span>
        </span>
        {active ? (
          <Check className="size-4 shrink-0 text-success" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogInlineContent
        asChild
        id="project-switcher-panel"
        overlayClassName="project-switcher-backdrop absolute inset-0 z-40 bg-foreground/5 backdrop-blur-[1px]"
        className="project-switcher-panel absolute inset-y-0 left-0 z-50 flex w-[min(360px,calc(100vw-58px))] flex-col border-r border-border/70 bg-background/98 shadow-2xl shadow-foreground/10"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <aside>
        <div className="flex items-start justify-between gap-4 px-4 pb-3 pt-4">
          <div>
            <p className="project-switcher-eyebrow font-mono text-micro font-semibold uppercase tracking-[0.18em]">
              Workspaces / Select
            </p>
            <DialogTitle className="text-base font-semibold">
              切换项目
            </DialogTitle>
            <DialogDescription
              className="mt-1 text-xs text-muted-foreground"
            >
              不离开创作界面，直接切换工作空间
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-2 size-8"
              aria-label="关闭"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </div>

        <div className="px-3 pb-2">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                aria-label="搜索项目"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索项目"
                className="project-switcher-search h-10 rounded-lg border-border/70 bg-muted/40 pl-9"
              />
            </div>
            <Button
              type="button"
              variant={favoritesOnly ? "default" : "outline"}
              size="icon"
              className="size-10 shrink-0 rounded-lg"
              aria-label="只看收藏"
              title={favoritesOnly ? "显示全部项目" : "只看收藏项目"}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              <Star className={favoritesOnly ? "fill-current" : ""} />
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select value={scope} onValueChange={(value) => setScope(value as ProjectScope)}>
              <SelectTrigger aria-label="切换器项目范围" className="h-9 rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部项目</SelectItem>
                <SelectItem value="created">我创建</SelectItem>
                <SelectItem value="participating">我参与</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as ProjectSort)}>
              <SelectTrigger aria-label="切换器项目排序" className="h-9 rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">最近使用</SelectItem>
                <SelectItem value="updated">最近更新</SelectItem>
                <SelectItem value="name">名称排序</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {isLoading ? (
            <LoadingState
              appearance="inline"
              label="正在加载项目…"
              className="w-full py-8"
            />
          ) : (
            <div className="space-y-3" data-project-switcher-list>
              {(defaultProjects.length > 0 || (!projects && currentProject?.isDefault)) && (
                <section>
                  <p className="px-2.5 pb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    个人空间
                  </p>
                  {defaultProjects.length > 0
                    ? defaultProjects.map(renderProject)
                    : renderProject({
                        id: currentProjectId,
                        name: "默认创作",
                        description: null,
                        createdBy: "",
                        visibility: "private",
                        createdAt: 0,
                        updatedAt: 0,
                        isDefault: true,
                        mine: true,
                        canEdit: true,
                        canManage: true,
                        createdByMe: true,
                        participating: false,
                        favorite: false,
                        lastOpenedAt: null,
                        archivedAt: null,
                        currentUserRole: "owner",
                      })}
                </section>
              )}

              <section>
                <div className="flex items-center justify-between px-2.5 pb-1">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    正式项目
                  </p>
                  <span className="text-xs text-muted-foreground">{formalProjects.length} 个</span>
                </div>
                {formalProjects.length > 0 ? (
                  formalProjects.map(renderProject)
                ) : (
                  <p className="px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
                    {filtersActive ? "没有匹配的项目" : "还没有正式项目，可在下方新建"}
                  </p>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="border-t border-border/60 p-3">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="w-full justify-start rounded-xl" size="lg">
                <Plus className="size-4" /> 新建正式项目
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建正式项目</DialogTitle>
                <DialogDescription>
                  需要独立资产、成员权限或专题归档时，再建立正式项目。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="quick-project-name">项目名</Label>
                  <Input
                    id="quick-project-name"
                    value={name}
                    maxLength={60}
                    onChange={(event) => {
                      setName(event.target.value);
                      if (isDuplicateProjectNameError(create.error)) create.reset();
                    }}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quick-project-description">描述（可选）</Label>
                  <Textarea
                    id="quick-project-description"
                    value={description}
                    maxLength={200}
                    rows={3}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>可见性</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVisibility("private")}
                      aria-pressed={visibility === "private"}
                      className={`focus-ring relative rounded-xl border p-3 pr-10 text-left transition-colors ${
                        visibility === "private" ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                      }`}
                    >
                      <LockKeyhole className="mb-2 size-4 text-muted-foreground" />
                      <span className="block text-sm font-medium">私有</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">仅项目成员可见</span>
                      <SelectionIndicator
                        selected={visibility === "private"}
                        className="absolute right-3 top-3 text-primary"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibility("org")}
                      aria-pressed={visibility === "org"}
                      className={`focus-ring relative rounded-xl border p-3 pr-10 text-left transition-colors ${
                        visibility === "org" ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                      }`}
                    >
                      <Globe2 className="mb-2 size-4 text-muted-foreground" />
                      <span className="block text-sm font-medium">公司公开</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">非成员可只读</span>
                      <SelectionIndicator
                        selected={visibility === "org"}
                        className="absolute right-3 top-3 text-primary"
                      />
                    </button>
                  </div>
                </div>
                {create.isError &&
                  (isDuplicateProjectNameError(create.error) ? (
                    <div className="space-y-2">
                      <StatusMessage tone="warning">{create.error.message}</StatusMessage>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        loading={create.isPending}
                        onClick={() => create.mutate({ allowDuplicate: true })}
                      >
                        仍然创建同名项目
                      </Button>
                    </div>
                  ) : (
                    <StatusMessage tone="danger">{create.error.message}</StatusMessage>
                  ))}
                <Button
                  className="w-full"
                  onClick={() => create.mutate({})}
                  disabled={!name.trim()}
                  loading={create.isPending}
                  loadingText="创建中"
                >
                  创建并进入
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="ghost" className="mt-1 w-full justify-between text-muted-foreground" asChild>
            <Link href="/projects" onClick={() => onOpenChange(false)}>
              管理全部项目 <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
        </aside>
      </DialogInlineContent>
    </Dialog>
  );
}

export function Workspace({
  projectId,
  userId,
  userName,
  isAdmin,
  casMode,
}: {
  projectId: string;
  userId: string;
  userName: string;
  isAdmin: boolean;
  casMode: boolean;
}) {
  const {
    data: project,
    isError: projectIsError,
    error: projectError,
  } = useQuery<ProjectDetailDto>({
    queryKey: ["project", projectId],
    queryFn: () => api(`/api/projects/${projectId}`),
    refetchInterval: 30_000,
  });
  const onlineCount = project?.members.filter((member) => member.online).length ?? 0;
  const canEdit = project?.canEdit ?? false;
  const [section, setSection] = useState<WorkspaceSection>("video");
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const projectSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
  const [extendRequest, setExtendRequest] = useState<{
    asset: AssetDto;
    id: number;
  } | null>(null);
  const [formulaEditRequest, setFormulaEditRequest] = useState<{
    asset: AssetDto;
    id: number;
  } | null>(null);

  const creationTools = [
    ["image", "图像", ImagePlus],
    ["video", "视频", Film],
    ["music", "音乐", Music],
    ["tts", "配音", Mic],
    ["formula", "公式", Sigma],
  ] as const;

  if (projectIsError) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <StatusMessage tone="danger">
            {projectError.message || "项目暂时无法访问"}
          </StatusMessage>
          <Button asChild>
            <Link href="/projects">返回项目管理</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <CanEditProvider
      value={canEdit}
      canManage={project?.canManage ?? false}
      role={project?.currentUserRole ?? "viewer"}
      userId={userId}
    >
      <div
        data-workspace-shell
        className="workspace-shell grid h-full min-h-0 grid-cols-[58px_minmax(0,1fr)] overflow-hidden bg-background md:grid-cols-[68px_minmax(0,1fr)]"
      >
        <aside
          data-workspace-navigation
          className="workspace-rail relative z-40 flex min-h-0 flex-col items-center border-r border-border/60 bg-background px-2 py-3"
        >
          <Link
            href="/"
            className="workspace-brand-mark mb-10 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
            title="海豚创作"
          >
            <DolphinMark className="size-6" />
          </Link>

          <nav className="workspace-creation-nav flex w-full flex-col gap-1" aria-label="创作工具">
            {creationTools.map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  if (value === "formula") setFormulaEditRequest(null);
                  setSection(value);
                }}
                aria-pressed={section === value}
                className={`focus-ring workspace-nav-item relative flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs transition-colors ${
                  section === value
                    ? "is-active bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
                {label}
                <SelectionIndicator
                  selected={section === value}
                  className="absolute right-1 top-1 size-3.5"
                />
              </button>
            ))}
          </nav>

          <div className="workspace-rail-divider my-3 h-px w-8 bg-border/70" />
          <nav className="workspace-project-nav flex w-full flex-col gap-1" aria-label="项目工具">
            {([[
              "assets",
              "资产",
              Library,
            ], ["tasks", "任务", ListChecks]] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSection(value)}
                aria-pressed={section === value}
                className={`focus-ring workspace-nav-item relative flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs transition-colors ${
                  section === value
                    ? "is-active bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
                {label}
                <SelectionIndicator
                  selected={section === value}
                  className="absolute right-1 top-1 size-3.5"
                />
              </button>
            ))}
            <button
              ref={projectSwitcherTriggerRef}
              type="button"
              onClick={() => setProjectSwitcherOpen((value) => !value)}
              className={`focus-ring workspace-nav-item flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs transition-colors ${
                projectSwitcherOpen
                  ? "is-active bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              title="切换项目"
              aria-expanded={projectSwitcherOpen}
              aria-haspopup="dialog"
              aria-controls="project-switcher-panel"
            >
              <FolderKanban className="size-4" />
              项目
            </button>
          </nav>

          <div className="workspace-utility-nav mt-auto flex w-full flex-col gap-1">
            {isAdmin && (
              <Link
                href="/dashboard"
                className="workspace-nav-item flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <BarChart3 className="size-4" />
                控制台
              </Link>
            )}
            <Link
              href="/docs"
              className="workspace-nav-item flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <BookOpen className="size-4" />
              帮助
            </Link>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="focus-ring workspace-nav-item flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={`${userName}${casMode ? " · 公司账号" : ""}`}
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-muted font-semibold text-foreground">
                    {userName.trim().slice(0, 1) || "U"}
                  </span>
                  <span className="max-w-12 truncate">{userName}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="ml-2">
                <DropdownMenuLabel>{userName}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/projects"><FolderKanban className="size-4" /> 项目管理</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/docs"><BookOpen className="size-4" /> 使用文档</Link>
                </DropdownMenuItem>
                {!casMode && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => signOut({ callbackUrl: "/login" })}
                    >
                      <LogOut className="size-4" /> 退出登录
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        <div data-workspace-main className="workspace-main-surface relative min-h-0 min-w-0 overflow-hidden">
          {project?.archivedAt ? (
            <StatusMessage
              data-archived-notice
              tone="warning"
              icon={false}
              className="absolute left-4 right-4 top-3 z-50 bg-background/95 shadow-sm backdrop-blur"
            >
              <div className="flex items-center gap-2">
                <Archive className="size-4 shrink-0" />
                <span>
                  这个项目已归档，当前为<strong>只读查看</strong>。所有者或管理员可在
                  <Link href="/projects" className="ml-1 underline underline-offset-2">
                    项目管理
                  </Link>
                  中恢复。
                </span>
              </div>
            </StatusMessage>
          ) : project && !canEdit ? (
            <StatusMessage
              data-read-only-notice
              tone="warning"
              icon={false}
              className="absolute left-4 right-4 top-3 z-50 bg-background/95 shadow-sm backdrop-blur"
            >
              <div className="flex items-center gap-2">
                <Eye className="size-4 shrink-0" />
                <span>
                  {project.isMember ? (
                    <>
                      当前项目角色为<strong>查看者</strong>，仅可浏览项目内容。请联系项目所有者调整角色后再创作。
                    </>
                  ) : (
                    <>
                      你正在<strong>只读浏览</strong>这个公开项目。如需创作或编辑，请让项目所有者把你加入为编辑者。
                    </>
                  )}
                </span>
              </div>
            </StatusMessage>
          ) : null}

          {(section === "assets" || section === "tasks") && (
          <div className="absolute right-5 top-3 z-30 flex items-center gap-2 text-sm text-muted-foreground">
            <div className="hidden items-center gap-2 rounded-xl border border-border/60 bg-background/80 px-3 py-1.5 shadow-sm backdrop-blur md:flex">
              <span
                role="status"
                aria-live="polite"
                aria-busy={!project}
                className="flex max-w-40 items-center gap-1.5 truncate font-medium text-foreground"
              >
                {!project && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-info motion-reduce:animate-none" />}
                <span className="truncate">
                  {project?.isDefault ? "默认创作" : project?.name ?? "正在加载"}
                </span>
                {project && !project.isDefault && (
                  <span
                    data-project-role-badge
                    className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground"
                  >
                    {projectRoleLabel(project.currentUserRole)}
                  </span>
                )}
              </span>
              {project && canEdit && !project.isDefault && (
                <EditProjectDialog project={project} />
              )}
            </div>
            {project && !project.isDefault && (
              <div className="hidden items-center gap-2 rounded-xl border border-border/60 bg-background/80 px-3 py-1.5 shadow-sm backdrop-blur lg:flex">
                <Users className="size-4" />
                <span className="text-xs">{onlineCount} 在线</span>
                {project.canManage && canEdit && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        <UserPlus /> 成员管理
                      </Button>
                    </DialogTrigger>
                    <ProjectMembersDialog
                      projectId={projectId}
                      members={project.members}
                    />
                  </Dialog>
                )}
              </div>
            )}
            {project && !project.isDefault && project.canManage && canEdit && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9 lg:hidden"
                    aria-label="成员管理"
                    title="成员管理"
                  >
                    <UserPlus />
                  </Button>
                </DialogTrigger>
                <ProjectMembersDialog
                  projectId={projectId}
                  members={project.members}
                />
              </Dialog>
            )}
          </div>
          )}

          <div
            className={`h-full min-h-0 min-w-0 ${
              section === "assets" || section === "tasks"
                ? "overflow-y-auto px-5 pb-8 pt-20"
                : "overflow-hidden"
            }`}
          >
            {section !== "assets" && section !== "tasks" && (
              <CreateTab
                key={`${extendRequest?.id ?? 0}:${formulaEditRequest?.id ?? 0}`}
                projectId={projectId}
                extendAsset={extendRequest?.asset}
                initialFormulaAsset={formulaEditRequest?.asset}
                value={section}
                onValueChange={setSection}
                projectName={project?.isDefault ? "默认创作" : project?.name}
              />
            )}
            {section === "assets" && (
              <AssetsTab
                projectId={projectId}
                onExtend={(asset) => {
                  setExtendRequest({ asset, id: Date.now() });
                  setSection("video");
                }}
                onEditFormula={(asset) => {
                  setFormulaEditRequest({ asset, id: Date.now() });
                  setSection("formula");
                }}
              />
            )}
            {section === "tasks" && <TasksTab projectId={projectId} />}
          </div>

          <ProjectSwitcher
            currentProject={project}
            currentProjectId={projectId}
            open={projectSwitcherOpen}
            onOpenChange={setProjectSwitcherOpen}
            triggerRef={projectSwitcherTriggerRef}
          />
        </div>
      </div>
    </CanEditProvider>
  );
}
