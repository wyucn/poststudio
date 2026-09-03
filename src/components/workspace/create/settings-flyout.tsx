"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogInlineContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { X } from "lucide-react";

export function StudioSettingsFlyout({
  open,
  id,
  title,
  description,
  onClose,
  triggerRef,
  children,
}: {
  open: boolean;
  id: string;
  title: string;
  description: string;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} modal={false}>
      <DialogInlineContent
        asChild
        id={id}
        className="studio-settings-flyout absolute right-4 top-[74px] z-50 flex max-h-[calc(100%-94px)] w-[min(390px,calc(100%-2rem))] flex-col overflow-hidden"
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <aside>
          <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
            <div>
              <p className="studio-settings-eyebrow font-mono text-micro font-semibold uppercase tracking-[0.16em]">Canvas controls</p>
              <DialogTitle className="mt-1 text-base font-semibold">
                {title}
              </DialogTitle>
              <DialogDescription
                className="mt-1 text-xs leading-5 text-muted-foreground"
              >
                {description}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon" className="-mr-2 -mt-2 size-8 shrink-0" aria-label="关闭设置">
                <X className="size-4" />
              </Button>
            </DialogClose>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </aside>
      </DialogInlineContent>
    </Dialog>
  );
}
