"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { SPRING_SNAPPY } from "@/lib/motion";

/* 每个 Tabs 根:
 * - value:当前激活项,让指示器只挂在激活 trigger 上(layoutId 才能弹簧滑动)
 * - pillId:该层专属的 layoutId,保证不同层级的指示器互相独立、不会跨层飞 */
type TabsCtx = { value: string | undefined; pillId: string };
const TabsContext = React.createContext<TabsCtx | null>(null);

function Tabs({
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const pillId = React.useId();
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue);
  const actual = isControlled ? value : internal;
  return (
    <TabsContext.Provider value={{ value: actual, pillId }}>
      <TabsPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(v) => {
          if (!isControlled) setInternal(v);
          onValueChange?.(v);
        }}
        {...props}
      />
    </TabsContext.Provider>
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "material-thin inline-flex h-10 items-center justify-center gap-0.5 rounded-lg border border-border/70 p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const ctx = React.useContext(TabsContext);
  const isActive = ctx?.value === value;
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "focus-ring relative isolate inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-4 py-1.5 text-ui font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-primary-foreground cursor-pointer",
        className
      )}
      {...props}
    >
      {isActive && (
        <motion.span
          layoutId={ctx?.pillId}
          transition={SPRING_SNAPPY}
          className="absolute inset-0 -z-10 rounded-[inherit] bg-primary shadow-[0_2px_10px_rgba(24,28,20,0.25)]"
        />
      )}
      {children}
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-4 focus-visible:outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
