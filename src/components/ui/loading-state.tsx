import type * as React from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function LoadingState({
  label = "正在加载…",
  appearance = "panel",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  label?: string;
  appearance?: "panel" | "inline";
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-atomic="true"
      className={cn(
        "flex items-center justify-center gap-2 text-sm text-muted-foreground",
        appearance === "panel"
          ? "min-h-24 rounded-lg border border-dashed border-border bg-muted/35 px-4 py-8"
          : "min-h-9 py-1",
        className
      )}
      {...props}
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-4 shrink-0 animate-spin text-info motion-reduce:animate-none"
      />
      <span>{label}</span>
    </div>
  );
}

export { LoadingState };
