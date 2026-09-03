"use client";

import { ArrowRight, type LucideIcon } from "lucide-react";

export interface EmptyWorkspaceAction {
  label: string;
  detail: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "recovery";
}

export function EmptyWorkspaceActions({
  actions,
}: {
  actions: EmptyWorkspaceAction[];
}) {
  if (!actions.length) return null;

  return (
    <div className="empty-workspace-actions" aria-label="快速开始">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            type="button"
            className={`empty-workspace-action ${
              action.tone === "recovery" ? "is-recovery" : ""
            }`}
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.detail}
            aria-label={action.label}
          >
            <Icon className="empty-workspace-action-icon" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <b>{action.label}</b>
              <small>{action.detail}</small>
            </span>
            <ArrowRight className="empty-workspace-action-arrow" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
