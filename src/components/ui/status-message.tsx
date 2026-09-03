import type * as React from "react";
import {
  CheckCircle2,
  CircleAlert,
  CircleX,
  Info,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StatusTone = "info" | "success" | "warning" | "danger" | "neutral";
type StatusAppearance = "panel" | "strip" | "inline";

const TONE_STYLE: Record<StatusTone, { icon: LucideIcon; text: string; surface: string }> = {
  info: {
    icon: Info,
    text: "text-info",
    surface: "border-info/25 bg-info-muted",
  },
  success: {
    icon: CheckCircle2,
    text: "text-success",
    surface: "border-success/25 bg-success-muted",
  },
  warning: {
    icon: CircleAlert,
    text: "text-warning",
    surface: "border-warning/25 bg-warning-muted",
  },
  danger: {
    icon: CircleX,
    text: "text-destructive",
    surface: "border-destructive/25 bg-destructive-muted",
  },
  neutral: {
    icon: Info,
    text: "text-muted-foreground",
    surface: "border-border bg-muted/45",
  },
};

function StatusMessage({
  tone = "info",
  appearance = "panel",
  icon = true,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  tone?: StatusTone;
  appearance?: StatusAppearance;
  icon?: boolean;
}) {
  const style = TONE_STYLE[tone];
  const Icon = style.icon;
  const live = tone === "danger" ? "assertive" : "polite";

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live={live}
      aria-atomic="true"
      className={cn(
        "flex items-start gap-2 leading-5",
        style.text,
        appearance !== "inline" && style.surface,
        appearance === "panel" && "rounded-lg border px-3 py-2.5 text-sm",
        appearance === "strip" && "border-t px-4 py-2.5 text-xs",
        appearance === "inline" && "text-xs",
        className
      )}
      {...props}
    >
      {icon && <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export { StatusMessage, type StatusAppearance, type StatusTone };
