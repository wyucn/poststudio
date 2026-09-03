import * as React from "react";
import { cn } from "@/lib/utils";
import type { AccessibleControlName } from "@/components/ui/accessible-control";

type InputProps = React.ComponentProps<"input"> & AccessibleControlName;

function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        "focus-ring flex h-[var(--control-height)] w-full rounded-md border border-input bg-card px-3 py-1.5 text-ui shadow-sm transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}

export { Input };
