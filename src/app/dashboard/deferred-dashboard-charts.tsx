"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardChartsProps } from "./dashboard-charts";

function DashboardChartsPlaceholder() {
  return (
    <div
      className="grid gap-4 lg:grid-cols-3"
      role="status"
      aria-label="正在加载统计图表"
      data-dashboard-charts-placeholder
    >
      <Card className="lg:col-span-2">
        <CardContent className="space-y-4 p-4">
          <div className="h-5 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-[220px] animate-pulse rounded-lg bg-muted/70 motion-reduce:animate-none" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="h-5 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="mx-auto size-[220px] max-w-full animate-pulse rounded-full bg-muted/70 motion-reduce:animate-none" />
        </CardContent>
      </Card>
    </div>
  );
}

const DashboardCharts = dynamic<DashboardChartsProps>(
  () => import("./dashboard-charts").then((module) => module.DashboardCharts),
  {
    ssr: false,
    loading: DashboardChartsPlaceholder,
  }
);

export function DeferredDashboardCharts(props: DashboardChartsProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || ready) return;
    if (typeof IntersectionObserver === "undefined") {
      const timeout = setTimeout(() => setReady(true), 0);
      return () => clearTimeout(timeout);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div ref={hostRef} data-dashboard-charts-deferred>
      {ready ? <DashboardCharts {...props} /> : <DashboardChartsPlaceholder />}
    </div>
  );
}
