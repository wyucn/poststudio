"use client";

import { ImageIcon, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";

export interface DashboardChartsProps {
  trend: Array<{ date: string; count: number }>;
  byKind: Array<{ kind: string; count: number }>;
}

const KIND_LABEL: Record<string, string> = {
  text: "文案",
  image: "图像",
  video: "视频",
  audio: "音频",
  music: "音乐",
  edit: "剪辑",
};

const CHART_COLORS = [
  "var(--primary)",
  "var(--magenta)",
  "var(--cyan)",
  "var(--lime)",
  "#f59e0b",
  "#a855f7",
];

export function DashboardCharts({ trend, byKind }: DashboardChartsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-dashboard-charts>
      <Card className="lg:col-span-2">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="size-4 text-primary" /> 生成趋势
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 13 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 13 }} allowDecimals={false} width={36} />
              <Tooltip
                contentStyle={{
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                name="任务数"
                stroke="var(--primary)"
                fill="url(#trendFill)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <ImageIcon className="size-4 text-primary" /> 类型分布
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={byKind}
                dataKey="count"
                nameKey="kind"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                paddingAngle={2}
              >
                {byKind.map((entry, index) => (
                  <Cell
                    key={entry.kind}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [
                  `${value} 次`,
                  KIND_LABEL[String(name)] ?? String(name),
                ]}
                contentStyle={{
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-2">
            {byKind.map((entry, index) => (
              <span
                key={entry.kind}
                className="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                />
                {KIND_LABEL[entry.kind] ?? entry.kind} {entry.count}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
