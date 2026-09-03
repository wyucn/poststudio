"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
      {/* 外层 flex 居中容器:定位不用 translate,避免 filter+fixed 首帧定位错乱(左上角闪现) */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <DialogPrimitive.Content
          className={cn(
            "dialog-content card-frame material-thick pointer-events-auto relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl border border-border shadow-[var(--shadow-float)]",
            className
          )}
          {...props}
        >
          {/* 内层滚动容器:滚动条只在内容超高时出现,不受角标 -1px 溢出影响 */}
          <div className="grid gap-4 overflow-y-auto rounded-2xl p-[var(--space-dialog)]">
            {children}
          </div>
          <DialogPrimitive.Close className="focus-ring absolute right-4 top-4 z-10 rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 cursor-pointer">
            <X className="size-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

function DialogInlineContent({
  className,
  overlayClassName,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
}) {
  return (
    <>
      {overlayClassName && (
        <DialogPrimitive.Overlay className={cn("dialog-overlay", overlayClassName)} />
      )}
      <DialogPrimitive.Content
        className={cn("outline-none", className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </>
  );
}

/** 右侧任务详情抽屉：保留 Radix Dialog 的焦点陷阱与 Escape 语义。 */
function DialogDrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "dialog-drawer card-frame material-thick fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-[34rem] flex-col border-l border-border bg-background shadow-[var(--shadow-float)] outline-none",
          className
        )}
        {...props}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-[var(--space-dialog)]">
          {children}
        </div>
        <DialogPrimitive.Close className="focus-ring absolute right-4 top-4 z-10 rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 cursor-pointer">
          <X className="size-4" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogDrawerContent,
  DialogInlineContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
};
