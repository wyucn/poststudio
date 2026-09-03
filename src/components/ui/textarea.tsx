import * as React from "react";
import { cn } from "@/lib/utils";
import type { AccessibleControlName } from "@/components/ui/accessible-control";

type TextareaProps = React.ComponentProps<"textarea"> & AccessibleControlName;

function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "focus-ring flex min-h-[calc(var(--control-height)*1.8)] w-full rounded-md border border-input bg-card px-3.5 py-3 text-ui leading-6 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
