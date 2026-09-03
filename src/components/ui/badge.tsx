import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        info: "border-info/20 bg-info-muted text-info",
        success: "border-success/20 bg-success-muted text-success",
        warning: "border-warning/20 bg-warning-muted text-warning",
        destructive: "border-destructive/20 bg-destructive-muted text-destructive",
        favorite: "border-favorite/20 bg-favorite-muted text-favorite",
        magenta: "border-transparent bg-magenta/15 text-magenta",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
