"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Clock3,
  Eye,
  FolderArchive,
  FolderOpen,
  Globe,
  Lock,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  UserCheck,
  UserRoundCog,
} from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import type { ProjectDetailDto, ProjectListDto } from "@/lib/client/types";
import {
  PROJECT_NAME_DUPLICATE_CODE,
  type ProjectLifecycleAction,
} from "@/lib/projects/contracts";
import {
  filterAndSortProjects,
  type ProjectScope,
  type ProjectSort,
} from "@/lib/projects/discovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PROJECT_TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatProjectTime(value: number | string): string {
  return PROJECT_TIME_FORMAT.format(new Date(value));
}

function projectRoleLabel(role: ProjectListDto["currentUserRole"]): string {
  return role === "admin"
    ? "平台管理员"
    : role === "owner"
      ? "所有者"
      : role === "editor"
        ? "编辑者"
        : "查看者";
}

function VisibilityToggle({ project }: { project: ProjectListDto }) {
  const qc = useQueryClient();
  const isPublic = project.visibility !== "private";
  const toggle = useMutation({
    mutationFn: () =>
      api(`/api/projects/${project.id}`, {
        method: "PATCH",
        json: { visibility: isPublic ? "private" : "org" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate();
      }}
      loading={toggle.isPending}
      loadingText="更新中"
      aria-label={isPublic ? "当前全公司公开，点击改为私有" : "当前私有，点击改为全公司公开"}
      title={isPublic ? "全公司公开 · 点击改为私有" : "私有 · 点击改为全公司公开"}
      className={
        "rounded-full px-2.5 text-xs font-medium tracking-wide " +
        (isPublic
          ? "border-info/35 bg-info-muted text-info hover:bg-info-muted/70"
          : "border-border text-muted-foreground hover:bg-muted")
      }
    >
      {isPublic ? <Globe className="size-3" /> : <Lock className="size-3" />}
      {isPublic ? "公开" : "私有"}
    </Button>
  );
}

function FavoriteToggle({ project }: { project: ProjectListDto }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      api(`/api/projects/${project.id}/preference`, {
        method: "PATCH",
        json: { favorite: !project.favorite },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 rounded-full"
      aria-label={project.favorite ? `取消收藏项目${project.name}` : `收藏项目${project.name}`}
      aria-pressed={project.favorite}
      title={project.favorite ? "取消收藏" : "收藏项目"}
      loading={toggle.isPending}
      onClick={() => toggle.mutate()}
    >
      <Star className={project.favorite ? "fill-current text-favorite" : "text-muted-foreground"} />
    </Button>
  );
}

type ProjectView = "active" | "archived";

interface LifecycleIntent {
  project: ProjectListDto;
  action: ProjectLifecycleAction;
}

function isDuplicateNameError(error: Error | null): error is ApiError {
  return error instanceof ApiError && error.code === PROJECT_NAME_DUPLICATE_CODE;
}

function ProjectLifecycleMenu({
  project,
  onAction,
}: {
  project: ProjectListDto;
  onAction: (intent: LifecycleIntent) => void;
}) {
  if (!project.canManage) return null;
  const archived = !!project.archivedAt;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          aria-label={`管理项目${project.name}`}
          title="项目管理"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {archived ? (
          <DropdownMenuItem
            onSelect={() => onAction({ project, action: "restore" })}
          >
            <RotateCcw /> 恢复项目
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={() => onAction({ project, action: "archive" })}
          >
            <Archive /> 归档项目
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => onAction({ project, action: "transfer-owner" })}
        >
          <UserRoundCog /> 转移所有者
        </DropdownMenuItem>
        {archived && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onAction({ project, action: "delete" })}
            >
              <Trash2 /> 删除项目
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectLifecycleDialog({
  intent,
  onClose,
}: {
  intent: LifecycleIntent;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [confirmName, setConfirmName] = useState("");
  const [newOwnerId, setNewOwnerId] = useState("");
  const { project, action } = intent;
  const detail = useQuery<ProjectDetailDto>({
    queryKey: ["project", project.id],
    queryFn: () => api(`/api/projects/${project.id}`),
    enabled: action === "transfer-owner",
  });
  const transferCandidates =
    detail.data?.members.filter((member) => !member.isOwner) ?? [];
  const mutation = useMutation({
    mutationFn: ({
      allowDuplicate = false,
    }: {
      allowDuplicate?: boolean;
    }) =>
      api(`/api/projects/${project.id}/lifecycle`, {
        method: "PATCH",
        json:
          action === "transfer-owner"
            ? { action, userId: newOwnerId, allowDuplicate }
            : action === "delete"
              ? { action, confirmationName: confirmName }
              : { action },
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["project", project.id] }),
      ]);
      onClose();
    },
  });

  const copy = {
    archive: {
      title: "归档项目",
      description: "归档后项目会从活动列表移出并变为只读，之后可随时恢复。",
      confirm: "确认归档",
    },
    restore: {
      title: "恢复项目",
      description: "恢复后项目会回到活动列表，成员可以继续编辑和生成。",
      confirm: "确认恢复",
    },
    delete: {
      title: "删除项目",
      description: "项目会从列表和访问入口移除，页面内无法恢复。请输入项目名称确认。",
      confirm: "确认删除",
    },
    "transfer-owner": {
      title: "转移项目所有权",
      description: "新所有者将接管归档、删除、可见性和后续成员角色管理权限。",
      confirm: "确认转移",
    },
  }[action];
  const canSubmit =
    action === "delete"
      ? confirmName === project.name
      : action === "transfer-owner"
        ? !!newOwnerId
        : true;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/45 p-3">
            <p className="text-sm font-medium">{project.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {project.description || "暂无项目描述"}
            </p>
          </div>
          {action === "delete" && (
            <div className="space-y-2">
              <Label htmlFor="delete-project-confirmation">输入项目名称</Label>
              <Input
                id="delete-project-confirmation"
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder={project.name}
                autoFocus
              />
            </div>
          )}
          {action === "transfer-owner" && (
            <div className="space-y-2">
              <Label>新所有者</Label>
              {detail.isLoading ? (
                <LoadingState label="正在加载项目成员…" />
              ) : transferCandidates.length ? (
                <Select
                  value={newOwnerId}
                  onValueChange={(value) => {
                    setNewOwnerId(value);
                    if (isDuplicateNameError(mutation.error)) mutation.reset();
                  }}
                >
                  <SelectTrigger aria-label="选择新项目所有者">
                    <SelectValue placeholder="选择现有项目成员" />
                  </SelectTrigger>
                  <SelectContent>
                    {transferCandidates.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name} · {projectRoleLabel(member.role)} · {member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <StatusMessage tone="warning">
                  暂无可转移成员。请先在项目内添加成员，再转移所有权。
                </StatusMessage>
              )}
              {detail.isError && (
                <StatusMessage tone="danger">{detail.error.message}</StatusMessage>
              )}
            </div>
          )}
          {mutation.isError &&
            (action === "transfer-owner" &&
            isDuplicateNameError(mutation.error) ? (
              <div className="space-y-2">
                <StatusMessage tone="warning">
                  {mutation.error.message}
                </StatusMessage>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  loading={mutation.isPending}
                  onClick={() => mutation.mutate({ allowDuplicate: true })}
                >
                  仍然转移所有权
                </Button>
              </div>
            ) : (
              <StatusMessage tone="danger">
                {mutation.error.message}
              </StatusMessage>
            ))}
          <Button
            className="w-full"
            variant={action === "delete" ? "destructive" : "default"}
            disabled={!canSubmit}
            loading={mutation.isPending}
            loadingText="处理中"
            onClick={() => mutation.mutate({})}
          >
            {action === "delete" ? <Trash2 /> : action === "restore" ? <RotateCcw /> : action === "transfer-owner" ? <UserRoundCog /> : <Archive />}
            {copy.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsClient() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "org">("private");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<ProjectScope>("all");
  const [sort, setSort] = useState<ProjectSort>("recent");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [projectView, setProjectView] = useState<ProjectView>("active");
  const [lifecycleIntent, setLifecycleIntent] = useState<LifecycleIntent | null>(null);

  const { data: activeProjects, isLoading: activeLoading } = useQuery<ProjectListDto[]>({
    queryKey: ["projects"],
    queryFn: () => api("/api/projects"),
  });
  const { data: archivedProjects, isLoading: archivedLoading } = useQuery<
    ProjectListDto[]
  >({
    queryKey: ["projects", "archived"],
    queryFn: () => api("/api/projects?view=archived"),
  });
  const projects = projectView === "archived" ? archivedProjects : activeProjects;
  const isLoading = projectView === "archived" ? archivedLoading : activeLoading;
  const formalProjects = useMemo(
    () => projects?.filter((project) => !project.isDefault) ?? [],
    [projects]
  );
  const activeProjectCount =
    activeProjects?.filter((project) => !project.isDefault).length ?? 0;
  const archivedProjectCount =
    archivedProjects?.filter((project) => !project.isDefault).length ?? 0;
  const visibleProjects = useMemo(
    () =>
      filterAndSortProjects(formalProjects, {
        query: search,
        scope,
        sort,
        favoritesOnly,
      }),
    [favoritesOnly, formalProjects, scope, search, sort]
  );
  const createdCount = formalProjects.filter((project) => project.createdByMe).length;
  const participatingCount = formalProjects.filter(
    (project) => project.participating
  ).length;
  const favoriteCount = formalProjects.filter((project) => project.favorite).length;
  const filtersActive =
    !!search.trim() || scope !== "all" || favoritesOnly || sort !== "recent";

  const create = useMutation({
    mutationFn: ({ allowDuplicate = false }: { allowDuplicate?: boolean }) =>
      api("/api/projects", {
        method: "POST",
        json: { name, description, visibility, allowDuplicate },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      setName("");
      setDescription("");
      setVisibility("private");
      setProjectView("active");
    },
  });

  function clearFilters() {
    setSearch("");
    setScope("all");
    setSort("recent");
    setFavoritesOnly(false);
  }

  function changeProjectView(nextView: ProjectView) {
    setProjectView(nextView);
    clearFilters();
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-primary/75">
            {"//"} 项目空间 · {activeProjectCount} 个活动项目 · {archivedProjectCount} 个已归档
          </p>
          <h1 className="text-display mt-2 text-3xl font-extrabold">项目</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            默认创作无需选择项目；只有需要独立资产、成员权限或专题归档时，才在这里建立正式项目。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/">
              <Sparkles /> 返回默认创作
            </Link>
          </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <Plus /> 新建项目
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
              <DialogDescription>
                为需要独立资产、成员权限或专题归档的工作建立正式项目。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-project-name">项目名</Label>
                <Input
                  id="new-project-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (isDuplicateNameError(create.error)) create.reset();
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-project-description">描述（可选）</Label>
                <Textarea
                  id="new-project-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>可见性</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibility("private")}
                    aria-pressed={visibility === "private"}
                    className={
                      "focus-ring flex items-start gap-2 rounded-lg border p-3 text-left transition-colors " +
                      (visibility === "private"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted")
                    }
                  >
                    <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block text-sm font-medium">私有</span>
                      <span className="block text-xs text-muted-foreground">
                        仅项目成员可见可编辑
                      </span>
                    </span>
                    <SelectionIndicator
                      selected={visibility === "private"}
                      className="ml-auto mt-0.5 text-primary"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibility("org")}
                    aria-pressed={visibility === "org"}
                    className={
                      "focus-ring flex items-start gap-2 rounded-lg border p-3 text-left transition-colors " +
                      (visibility === "org"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted")
                    }
                  >
                    <Globe className="mt-0.5 size-4 shrink-0 text-info" />
                    <span>
                      <span className="block text-sm font-medium">全公司公开</span>
                      <span className="block text-xs text-muted-foreground">
                        所有同事可见，非成员只读
                      </span>
                    </span>
                    <SelectionIndicator
                      selected={visibility === "org"}
                      className="ml-auto mt-0.5 text-primary"
                    />
                  </button>
                </div>
              </div>
              {create.isError &&
                (isDuplicateNameError(create.error) ? (
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
                创建
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </section>

      <section aria-label="项目状态" className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={projectView === "active" ? "default" : "outline"}
          aria-pressed={projectView === "active"}
          onClick={() => changeProjectView("active")}
        >
          <FolderOpen /> 活动项目 {activeProjectCount}
        </Button>
        <Button
          type="button"
          variant={projectView === "archived" ? "default" : "outline"}
          aria-pressed={projectView === "archived"}
          onClick={() => changeProjectView("archived")}
        >
          <FolderArchive /> 已归档 {archivedProjectCount}
        </Button>
      </section>

      <section
        aria-label="项目查找与筛选"
        className="rounded-xl border border-border/75 bg-card/80 p-2.5 shadow-sm"
      >
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索项目"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索项目名或描述"
              className="pl-9"
            />
          </div>
          <Select value={sort} onValueChange={(value) => setSort(value as ProjectSort)}>
            <SelectTrigger aria-label="项目排序">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">最近使用</SelectItem>
              <SelectItem value="updated">最近更新</SelectItem>
              <SelectItem value="name">名称排序</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="项目参与范围"
            className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border/70 p-1"
          >
            {([
              ["all", "全部", formalProjects.length],
              ["created", "我创建", createdCount],
              ["participating", "我参与", participatingCount],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`focus-ring flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  scope === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <SelectionIndicator selected={scope === value} className="size-3.5" />
                {label} <span className="font-mono opacity-75">{count}</span>
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant={favoritesOnly ? "default" : "outline"}
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            <Star className={favoritesOnly ? "fill-current" : ""} />
            收藏 {favoriteCount}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            显示 {visibleProjects.length} / {formalProjects.length}
          </span>
        </div>
      </section>

      {isLoading ? (
        <LoadingState label="正在加载项目…" />
      ) : visibleProjects.length ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((p) => (
            <Card
              key={p.id}
              data-project-card={p.id}
              data-project-name={p.name}
              data-project-density="compact"
              className={`h-full border-border/80 transition-colors hover:border-primary/45 ${
                p.archivedAt ? "bg-muted/45" : "bg-card/90"
              }`}
            >
              <CardHeader className="space-y-0 p-3 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {p.createdByMe && (
                        <span className="flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-foreground">
                          <Sparkles className="size-3" /> 我创建
                        </span>
                      )}
                      {p.participating && (
                        <span className="flex items-center gap-1 rounded-full border border-info/30 bg-info-muted px-1.5 py-0.5 text-xs font-medium text-info">
                          <UserCheck className="size-3" /> 我参与
                        </span>
                      )}
                      <span className="flex items-center gap-1 rounded-full border border-border/70 bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {projectRoleLabel(p.currentUserRole)}
                      </span>
                      {p.archivedAt && (
                        <span className="flex items-center gap-1 rounded-full border border-warning/30 bg-warning-muted px-1.5 py-0.5 text-xs font-medium text-warning">
                          <Archive className="size-3" /> 已归档
                        </span>
                      )}
                      {p.canEdit === false && (
                        <span className="flex items-center gap-1 rounded-full border border-warning/30 bg-warning-muted px-1.5 py-0.5 text-xs font-medium text-warning">
                          <Eye className="size-3" /> 只读
                        </span>
                      )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <FavoriteToggle project={p} />
                    {!p.archivedAt && p.canManage ? (
                      <VisibilityToggle project={p} />
                    ) : (
                      p.visibility !== "private" && (
                        <span className="flex items-center gap-1 rounded-full border border-info/30 bg-info-muted px-1.5 py-0.5 text-xs font-medium text-info">
                          <Globe className="size-3" /> 公开
                        </span>
                      )
                    )}
                    <ProjectLifecycleMenu
                      project={p}
                      onAction={setLifecycleIntent}
                    />
                  </div>
                </div>
                <Link
                  href={`/projects/${p.id}`}
                  className="focus-ring group mt-2 block rounded-md"
                >
                  <CardTitle className="flex items-center gap-1.5 text-base group-hover:text-primary">
                    <FolderOpen className="size-4 text-primary" />
                    <span className="truncate" title={p.name}>
                      {p.name}
                    </span>
                  </CardTitle>
                  <CardDescription
                    className="mt-1 line-clamp-1 text-xs leading-5"
                    title={
                      p.description ||
                      (p.archivedAt
                        ? "已归档，只读查看历史资产与任务。"
                        : "暂无描述，进入项目后开始创作。")
                    }
                  >
                    {p.description ||
                      (p.archivedAt
                        ? "已归档，只读查看历史资产与任务。"
                        : "暂无描述，进入项目后开始创作。")}
                  </CardDescription>
                </Link>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-muted-foreground">
                  {p.archivedAt && (
                    <time dateTime={new Date(p.archivedAt).toISOString()}>
                      归档 {formatProjectTime(p.archivedAt)}
                    </time>
                  )}
                  {p.lastOpenedAt && (
                    <time
                      dateTime={new Date(p.lastOpenedAt).toISOString()}
                      className="flex items-center gap-1 text-foreground"
                    >
                      <Clock3 className="size-3" /> 最近使用 {formatProjectTime(p.lastOpenedAt)}
                    </time>
                  )}
                  <time dateTime={new Date(p.updatedAt).toISOString()}>
                    更新 {formatProjectTime(p.updatedAt)}
                  </time>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : formalProjects.length && filtersActive ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Search className="size-9 text-muted-foreground" />
            <div>
              <p className="font-medium">没有匹配的项目</p>
              <p className="mt-1 text-sm text-muted-foreground">
                尝试调整关键词、参与范围、收藏条件或排序方式。
              </p>
            </div>
            <Button type="button" variant="outline" onClick={clearFilters}>
              清除筛选
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            {projectView === "archived" ? (
              <FolderArchive className="size-9 text-muted-foreground" />
            ) : (
              <FolderOpen className="size-9 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium">
                {projectView === "archived" ? "还没有归档项目" : "还没有正式项目"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {projectView === "archived"
                  ? "归档后的项目会保留历史内容，并在这里提供恢复或删除操作。"
                  : "你仍然可以在默认创作空间直接生成；需要协作或归档时再创建项目。"}
              </p>
            </div>
            {projectView === "active" && (
              <Button onClick={() => setOpen(true)}>
                <Plus /> 新建第一个项目
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {lifecycleIntent && (
        <ProjectLifecycleDialog
          key={`${lifecycleIntent.project.id}-${lifecycleIntent.action}`}
          intent={lifecycleIntent}
          onClose={() => setLifecycleIntent(null)}
        />
      )}
    </div>
  );
}
