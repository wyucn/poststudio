import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

function SelectionIndicator({
  selected,
  className,
}: {
  selected: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-selection-indicator
      data-selected={selected ? "true" : "false"}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-current transition-[opacity,transform] motion-reduce:transition-none",
        selected ? "scale-100 opacity-100" : "invisible scale-75 opacity-0",
        className
      )}
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

export { SelectionIndicator };
