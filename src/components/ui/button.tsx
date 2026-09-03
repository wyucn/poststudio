import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-ui font-semibold transition-all duration-200 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "border border-foreground/75 bg-primary text-primary-foreground shadow-[3px_3px_0_rgba(23,26,20,0.16)] hover:-translate-x-px hover:-translate-y-px hover:bg-primary/90 hover:shadow-[4px_4px_0_rgba(23,26,20,0.18)]",
        secondary: "border border-border bg-secondary text-secondary-foreground hover:border-foreground/45 hover:bg-accent",
        outline:
          "border border-foreground/30 bg-card hover:border-foreground/70 hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-secondary hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/85",
        magenta:
          "bg-magenta text-white font-semibold hover:bg-magenta/90 hover:-translate-y-px shadow-[0_3px_14px_rgba(242,92,25,0.30)]",
      },
      size: {
        default: "h-[var(--control-height)] px-4 py-2",
        sm: "h-[var(--control-height-sm)] rounded-md px-3 text-xs",
        lg: "h-[var(--control-height-lg)] rounded-md px-6",
        icon: "size-[var(--control-height-icon)]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingText = "处理中…",
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    loadingText?: React.ReactNode;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      aria-busy={loading || undefined}
      aria-disabled={asChild && (disabled || loading) ? true : undefined}
      disabled={asChild ? undefined : disabled || loading}
      data-loading={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          {size === "icon" ? <span className="sr-only">{loadingText}</span> : loadingText}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
