"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { AssetDto, TaskDto } from "@/lib/client/types";

export function creatorHistoryQueryKey(projectId: string, kinds: string) {
  return ["gen-history", projectId, kinds] as const;
}

export function useCreatorTasks(projectId: string, kinds: string) {
  return useQuery<TaskDto[]>({
    queryKey: creatorHistoryQueryKey(projectId, kinds),
    queryFn: () =>
      api(`/api/projects/${projectId}/tasks?mine=1&withAssets=1&kind=${kinds}`),
    refetchInterval: (query) =>
      query.state.data?.some(
        (task) => task.status === "queued" || task.status === "running"
      )
        ? 3000
        : false,
  });
}

export function latestFailedCreatorTask(items: TaskDto[] | undefined): {
  task: TaskDto;
  input: Record<string, unknown>;
} | null {
  const failed = (items ?? [])
    .filter((task) => task.status === "failed")
    .sort((a, b) => b.createdAt - a.createdAt);

  for (const task of failed) {
    try {
      return {
        task,
        input: JSON.parse(task.inputJson) as Record<string, unknown>,
      };
    } catch {
      // 跳过无法恢复的旧记录，继续寻找下一条有效失败任务。
    }
  }
  return null;
}

export function latestSuccessfulCreatorTask(
  items: TaskDto[] | undefined,
  outputKind: AssetDto["kind"]
): TaskDto | null {
  return (
    [...(items ?? [])]
      .filter(
        (task) =>
          task.status === "succeeded" && task.outputAsset?.kind === outputKind
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}
