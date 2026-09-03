"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  indeterminate,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { indeterminate?: boolean }) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      {indeterminate ? (
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-info" />
      ) : (
        <ProgressPrimitive.Indicator
          className="h-full w-full flex-1 bg-primary transition-transform motion-reduce:transition-none"
          style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
        />
      )}
    </ProgressPrimitive.Root>
  );
}

export { Progress };
