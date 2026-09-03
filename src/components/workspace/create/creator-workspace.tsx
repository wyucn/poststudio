"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  ArrowRight,
  History,
  Lightbulb,
  ShieldCheck
} from "lucide-react";
import { useRef, useState } from "react";

/* ---------------- 通用小组件 ---------------- */

export function ParamSummary({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
      {children}
    </p>
  );
}

export function ComposerSteps({ finalLabel }: { finalLabel: string }) {
  return (
    <div className="composer-steps" aria-label="创作流程">
      <span><b>1</b> 写下想法</span>
      <ArrowRight aria-hidden="true" />
      <span><b>2</b> 选择参数或素材</span>
      <ArrowRight aria-hidden="true" />
      <span><b>3</b> {finalLabel}</span>
    </div>
  );
}

export function StarterPrompts({
  items,
  onSelect,
}: {
  items: Array<{ label: string; value: string; action?: () => void }>;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="starter-prompts">
      <span className="starter-prompts-label"><Lightbulb className="size-3.5" /> 不知道怎么写？试试</span>
      <div className="starter-prompts-list">
        {items.map((item) => (
          <button key={item.label} type="button" onClick={() => item.action ? item.action() : onSelect(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StudioHeader({
  index,
  projectName,
  label,
  onHistoryOpen,
  historyTriggerRef,
}: {
  index: string;
  projectName?: string;
  label: string;
  onHistoryOpen: () => void;
  historyTriggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="creation-workspace-header col-start-1 row-start-1 flex min-w-0 items-center justify-between border-b border-border/55 px-4 sm:px-5 min-[1100px]:col-start-2 min-[1100px]:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="creation-workspace-index hidden rounded-sm border border-foreground/70 bg-primary px-2 py-1 font-mono text-micro font-bold text-primary-foreground lg:inline">
          {index}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-bold">{projectName ?? label}</h2>
          <span className="creation-workspace-mode-label shrink-0 text-xs text-muted-foreground">· {label}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="creator-history-trigger h-9 px-2 min-[1100px]:hidden sm:px-3"
          ref={historyTriggerRef}
          onClick={onHistoryOpen}
          aria-label={`打开${label}历史记录`}
        >
          <History aria-hidden="true" className="size-3.5" />
          <span className="hidden sm:inline">历史</span>
        </Button>
        <span
          role="status"
          aria-label="已自动保存"
          className="creation-autosave flex items-center gap-1.5"
        >
          <ShieldCheck aria-hidden="true" className="size-3.5 text-success" />
          <span className="hidden sm:inline">已自动保存</span>
        </span>
      </div>
    </header>
  );
}

export type CreatorWorkspaceKind = "image" | "video" | "music" | "tts" | "formula";

export function CreatorWorkspaceShell({
  kind,
  index,
  label,
  projectName,
  history,
  children,
}: {
  kind: CreatorWorkspaceKind;
  index: string;
  label: string;
  projectName?: string;
  history: React.ReactNode;
  children: React.ReactNode;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const handleHistoryOpenChange = (open: boolean) => {
    setHistoryOpen(open);
    if (!open) {
      window.requestAnimationFrame(() => {
        const trigger = historyTriggerRef.current;
        if (trigger?.offsetParent) trigger.focus();
      });
    }
  };

  return (
    <div
      data-creator-workspace={kind}
      className={`creation-workspace creation-workspace-${kind} relative grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[54px_minmax(0,1fr)] overflow-hidden bg-background sm:grid-rows-[60px_minmax(0,1fr)] min-[1100px]:grid-cols-[248px_minmax(0,1fr)] min-[1100px]:grid-rows-[62px_minmax(0,1fr)]`}
    >
      <StudioHeader
        index={index}
        projectName={projectName}
        label={label}
        onHistoryOpen={() => setHistoryOpen(true)}
        historyTriggerRef={historyTriggerRef}
      />
      <aside className="creation-history-rail col-start-1 row-span-2 row-start-1 hidden min-h-0 min-w-0 flex-col border-r border-border/55 min-[1100px]:flex">
        {history}
      </aside>
      {children}
      <Dialog open={historyOpen} onOpenChange={handleHistoryOpenChange}>
        <DialogContent className="creator-history-dialog min-[1100px]:hidden">
          <DialogHeader className="creator-history-dialog-header">
            <DialogTitle>{label}历史记录</DialogTitle>
            <DialogDescription>查看、复用或管理最近的生成任务与结果。</DialogDescription>
          </DialogHeader>
          <div className="creator-history-dialog-body">{history}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CreatorComposer({
  kind,
  children,
}: {
  kind: CreatorWorkspaceKind;
  children: React.ReactNode;
}) {
  return (
    <Card
      data-creator-composer={kind}
      className="creation-composer-card is-compact card-frame w-[min(1120px,100%)]"
    >
      <CardContent className="space-y-0 p-0">{children}</CardContent>
    </Card>
  );
}
