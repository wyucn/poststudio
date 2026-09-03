"use client";

import { lazy, Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import {
  Dialog,
  DialogDescription,
  DialogDrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TaskDetailsDrawerProps } from "./task-details-drawer";

const TaskDetailsDrawer = lazy(async () => {
  const loaded = await import("./task-details-drawer");
  return { default: loaded.TaskDetailsDrawer };
});

function TaskDetailsLoading({
  open,
  onOpenChange,
  restoreFocusRef,
}: Pick<
  TaskDetailsDrawerProps,
  "open" | "onOpenChange" | "restoreFocusRef"
>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogDrawerContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = restoreFocusRef?.current;
          if (target) window.requestAnimationFrame(() => target.focus());
        }}
      >
        <DialogHeader>
          <DialogTitle>任务详情</DialogTitle>
          <DialogDescription>正在准备实际用量和执行信息。</DialogDescription>
        </DialogHeader>
        <LoadingState label="正在加载任务详情…" />
      </DialogDrawerContent>
    </Dialog>
  );
}

export function LazyTaskDetailsDrawer(props: TaskDetailsDrawerProps) {
  return (
    <Suspense fallback={<TaskDetailsLoading {...props} />}>
      <TaskDetailsDrawer {...props} />
    </Suspense>
  );
}
