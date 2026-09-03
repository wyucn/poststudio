"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  CircleX,
  Clock3,
  ListChecks,
  LoaderCircle,
  PanelRightOpen,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/client/api";
import type { TaskDto } from "@/lib/client/types";
import { getModel } from "@/lib/ark/models";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusMessage } from "@/components/ui/status-message";
import {
  automaticTaskRetryInfo,
  manualRetryNeedsConfirmation,
  supportsTaskManualRetry,
} from "@/lib/tasks/retry";
import { useProjectAccess } from "./read-only";
import { LazyTaskDetailsDrawer } from "./lazy-task-details-drawer";

const KIND_LABEL: Record<string, string> = {
  text: "文案",
  image: "图像",
  video: "视频",
  audio: "配音",
  music: "音乐",
  edit: "剪辑",
};

const COZE_MODEL_LABEL: Record<string, string> = {
  "coze-music": "音乐生成",
  "coze-tts": "语音合成",
  "coze-audio-transcription": "语音转写",
  "modelscope-qwen3-tts": "Qwen3-TTS 声音克隆",
  "coze-edit": "视频剪辑工具",
};

function taskKindLabel(task: TaskDto): string {
  return task.modelKey === "coze-audio-transcription"
    ? "转写"
    : KIND_LABEL[task.kind];
}

function StatusBadge({ status }: { status: TaskDto["status"] }) {
  switch (status) {
    case "queued":
      return <Badge variant="warning" className="gap-1"><Clock3 className="size-3" />排队中</Badge>;
    case "running":
      return <Badge variant="info" className="gap-1"><LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />生成中</Badge>;
    case "succeeded":
      return <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" />已完成</Badge>;
    case "failed":
      return <Badge variant="destructive" className="gap-1"><CircleX className="size-3" />失败</Badge>;
    case "cancelled":
      return <Badge variant="secondary" className="gap-1"><Ban className="size-3" />已取消</Badge>;
  }
}

export function TasksTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const access = useProjectAccess();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const { data: tasks, isLoading } = useQuery<TaskDto[]>({
    queryKey: ["tasks", projectId],
    queryFn: () => api(`/api/projects/${projectId}/tasks?withAssets=1`),
    refetchInterval: (q) =>
      q.state.data?.some((t) => t.status === "queued" || t.status === "running")
        ? 5000
        : 30000,
  });

  const retry = useMutation({
    mutationFn: (task: TaskDto) =>
      api(`/api/tasks/${task.id}/retry`, {
        method: "POST",
        json: {
          confirmDuplicateSpend: manualRetryNeedsConfirmation(
            task.errorCode,
            task.arkTaskId
          ),
        },
      }),
    onSuccess: (_result, task) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId] });
    },
  });
  function requestRetry(task: TaskDto) {
    if (
      manualRetryNeedsConfirmation(task.errorCode, task.arkTaskId) &&
      !window.confirm(
        "上一次请求可能已被外部服务受理。继续重试会再次调用模型，并可能产生重复费用。确认重新执行？"
      )
    ) {
      return;
    }
    retry.mutate(task);
  }
  const cancel = useMutation({
    mutationFn: (taskId: string) =>
      api(`/api/tasks/${taskId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId] });
    },
  });
  const canManageTaskRecord = (task: TaskDto) =>
    access.canManage ||
    (access.canEdit &&
      access.role === "editor" &&
      task.userId === access.userId);
  const deletableIds =
    tasks
      ?.filter(
        (task) =>
          task.status !== "queued" &&
          task.status !== "running" &&
          canManageTaskRecord(task)
      )
      .map((task) => task.id) ?? [];
  const allSelected =
    deletableIds.length > 0 && deletableIds.every((id) => selectedIds.has(id));
  const selectedCount = deletableIds.filter((id) => selectedIds.has(id)).length;
  const detailTask = tasks?.find((task) => task.id === detailTaskId) ?? null;
  const removeTasks = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ deleted: number }>(`/api/projects/${projectId}/tasks`, {
        method: "DELETE",
        json: { ids },
      }),
    onSuccess: (_result, ids) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId] });
    },
  });

  function requestDelete(ids: string[]) {
    if (!ids.length) return;
    const confirmed = window.confirm(
      `确认删除 ${ids.length} 条任务记录？\n\n只会移除记录，素材库中的产物会保留。`
    );
    if (confirmed) removeTasks.mutate(ids);
  }

  if (isLoading) return <LoadingState label="正在加载任务…" />;
  if (!tasks?.length) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-12">
          <ListChecks className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">还没有任务记录</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <div className="space-y-2">
      {deletableIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              aria-label="全选可删除的任务"
              className="size-4 accent-primary"
              onChange={(e) =>
                setSelectedIds(e.target.checked ? new Set(deletableIds) : new Set())
              }
            />
            全选已结束任务
          </label>
          <span className="font-mono text-xs text-muted-foreground">
            已选 {selectedCount} · {access.canManage ? "运行中的任务不可删除" : "仅自己创建的任务可删除"}
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            disabled={!selectedCount}
            loading={removeTasks.isPending}
            loadingText="删除中"
            onClick={() =>
              requestDelete(deletableIds.filter((id) => selectedIds.has(id)))
            }
          >
            <Trash2 /> 删除已选
          </Button>
        </div>
      )}
      {removeTasks.isError && (
        <StatusMessage tone="danger">{removeTasks.error.message}</StatusMessage>
      )}
      {retry.isError && (
        <StatusMessage tone="danger">{retry.error.message}</StatusMessage>
      )}
      {cancel.isError && (
        <StatusMessage tone="danger">{cancel.error.message}</StatusMessage>
      )}
      {tasks.map((t) => {
        const kindLabel = taskKindLabel(t);
        let modelLabel = COZE_MODEL_LABEL[t.modelKey] ?? t.modelKey;
        if (!COZE_MODEL_LABEL[t.modelKey]) {
          try {
            modelLabel = getModel(t.modelKey).label;
          } catch {}
        }
        let prompt = "";
        try {
          prompt = String((JSON.parse(t.inputJson) as { prompt?: string }).prompt ?? "");
        } catch {}
        const active = t.status === "queued" || t.status === "running";
        const automaticRetry =
          t.status === "queued" ? automaticTaskRetryInfo(t.contextJson) : null;
        return (
          <Card key={t.id}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {canManageTaskRecord(t) && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    disabled={active || removeTasks.isPending}
                    aria-label={`选择${kindLabel}任务`}
                    title={active ? "运行中的任务不可删除" : "选择任务"}
                    className="mt-1 size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-35"
                    onChange={(e) =>
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (e.target.checked) next.add(t.id);
                        else next.delete(t.id);
                        return next;
                      })
                    }
                  />
                )}
                <Badge variant="secondary" className="mt-0.5 shrink-0">
                  {kindLabel}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-ui">{prompt || "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {modelLabel} · {new Date(t.createdAt).toLocaleString("zh-CN")}
                  </p>
                  {active && <Progress indeterminate className="mt-2" aria-label={`${kindLabel}任务处理中`} />}
                  {t.error && (
                    <StatusMessage tone="danger" appearance="inline" className="mt-1 line-clamp-2">{t.error}</StatusMessage>
                  )}
                  {automaticRetry && (
                    <StatusMessage tone="info" appearance="inline" className="mt-1">
                      已自动安排第 {automaticRetry.nextAttempt}/{automaticRetry.maxAttempts} 次执行
                    </StatusMessage>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <StatusBadge status={t.status} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    detailTriggerRef.current = event.currentTarget;
                    setDetailTaskId(t.id);
                  }}
                >
                  <PanelRightOpen /> 详情
                </Button>
                {canManageTaskRecord(t) && t.status === "queued" && !t.arkTaskId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cancel.mutate(t.id)}
                    loading={cancel.isPending && cancel.variables === t.id}
                    loadingText="取消中"
                    disabled={cancel.isPending}
                    title="取消尚未开始的任务"
                  >
                    <CircleX /> 取消
                  </Button>
                )}
                {canManageTaskRecord(t) &&
                  t.status === "failed" &&
                  supportsTaskManualRetry(t) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestRetry(t)}
                    loading={retry.isPending && retry.variables?.id === t.id}
                    loadingText="重试中"
                    disabled={retry.isPending}
                  >
                    <RotateCcw /> 重试
                  </Button>
                  )}
                {canManageTaskRecord(t) && !active && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    title="删除任务记录"
                    aria-label="删除任务记录"
                    loading={removeTasks.isPending && removeTasks.variables?.includes(t.id)}
                    loadingText="删除中"
                    disabled={removeTasks.isPending}
                    onClick={() => requestDelete([t.id])}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
    {detailTaskId && (
      <LazyTaskDetailsDrawer
        task={detailTask}
        open
        restoreFocusRef={detailTriggerRef}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDetailTaskId(null);
        }}
      />
    )}
    </>
  );
}
