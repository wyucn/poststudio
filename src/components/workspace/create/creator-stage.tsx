"use client";

import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Settings2 } from "lucide-react";
import { useRef } from "react";
import {
  EmptyWorkspaceActions,
  type EmptyWorkspaceAction,
} from "../empty-workspace-actions";
import {
  CreatorWorkspaceShell,
  type CreatorWorkspaceKind,
} from "./creator-workspace";
import { StudioSettingsFlyout } from "./settings-flyout";

export function CreationWorkspace({
  kind,
  index,
  label,
  projectName,
  headline,
  description,
  icon: Icon,
  history,
  starters,
  actions,
  settings,
  stageContent,
  stageSidebar,
  composerLayout = "overlay",
  children,
}: {
  kind: Exclude<CreatorWorkspaceKind, "video">;
  index: string;
  label: string;
  projectName?: string;
  headline: string;
  description: string;
  icon: typeof ImageIcon;
  history: React.ReactNode;
  starters?: React.ReactNode;
  actions?: EmptyWorkspaceAction[];
  settings?: {
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    title: string;
    description: string;
    content: React.ReactNode;
  };
  stageContent?: React.ReactNode;
  stageSidebar?: React.ReactNode;
  composerLayout?: "overlay" | "side";
  children: React.ReactNode;
}) {
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsPanelId = `${kind}-settings-panel`;

  return (
    <CreatorWorkspaceShell
      kind={kind}
      index={index}
      label={label}
      projectName={projectName}
      history={history}
    >
      <section
        data-composer-layout={composerLayout}
        className={`creation-stage relative col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden min-[1100px]:col-start-2 ${stageContent ? "has-interactive-canvas" : ""
          } ${composerLayout === "side" ? "is-side-composer" : ""
          }`}
        aria-label={`${label}舞台`}
      >
        <div className="creation-stage-canvas absolute inset-0 overflow-hidden">
          {settings && (
            <Button
              ref={settingsTriggerRef}
              type="button"
              variant="outline"
              size="sm"
              className={`creation-canvas-settings absolute right-4 top-4 z-30 h-10 ${stageContent ? "interactive-stage-settings-button" : ""
                }`}
              onClick={settings.onToggle}
              aria-expanded={settings.open}
              aria-haspopup="dialog"
              aria-controls={settingsPanelId}
            >
              <Settings2 /> 更多设置
            </Button>
          )}
          {stageContent ? (
            <div className={`creation-interactive-stage ${stageSidebar ? "has-sidebar" : "is-full-width"}`}>
              <div className="creation-interactive-stage-main">{stageContent}</div>
              {stageSidebar && (
                <aside className="creation-interactive-stage-sidebar" aria-label="参数与标记">
                  {stageSidebar}
                </aside>
              )}
            </div>
          ) : (
            <div className="creation-stage-empty absolute inset-x-0 top-[12%] z-10 mx-auto flex max-w-2xl flex-col items-center px-8 text-center text-muted-foreground">
              <p className="creation-stage-kicker font-mono text-micro font-semibold uppercase tracking-[0.18em]">
                {"//"} {label} · {index.split("/")[1]?.trim()}
              </p>
              <div className="creation-stage-mark mb-4 mt-3 flex size-12 items-center justify-center">
                <Icon className="size-5" />
              </div>
              <p className="text-2xl font-bold leading-tight text-foreground">{headline}</p>
              <p className="creation-stage-description mt-2 max-w-sm text-ui leading-6 text-muted-foreground">{description}</p>
              {starters}
              {actions && <EmptyWorkspaceActions actions={actions} />}
            </div>
          )}
        </div>
        <div
          className={`creation-composer-zone relative z-20 mt-auto flex min-h-0 justify-center px-4 pb-5 pt-32 lg:px-8 ${stageContent ? "is-interactive" : ""
            }`}
        >
          {children}
        </div>
      </section>
      {settings && (
        <StudioSettingsFlyout
          open={settings.open}
          id={settingsPanelId}
          title={settings.title}
          description={settings.description}
          onClose={settings.onClose}
          triggerRef={settingsTriggerRef}
        >
          {settings.content}
        </StudioSettingsFlyout>
      )}
    </CreatorWorkspaceShell>
  );
}
