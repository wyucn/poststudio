"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, RotateCcw, Save, ServerCog } from "lucide-react";
import { api } from "@/lib/client/api";
import type {
  ManagedModelAdminDto,
  ManagedModelAdminResponse,
  ManagedModelHealthStatus,
} from "@/lib/models/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusMessage } from "@/components/ui/status-message";
import { Textarea } from "@/components/ui/textarea";

const HEALTH_LABEL: Record<ManagedModelHealthStatus, string> = {
  unknown: "待验证",
  healthy: "健康",
  degraded: "降级",
  offline: "离线",
  unconfigured: "未配置",
  disabled: "已下线",
};

function healthVariant(
  status: ManagedModelHealthStatus
): "success" | "warning" | "destructive" | "secondary" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "offline") return "destructive";
  return "secondary";
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function ModelConfigCard({ item }: { item: ManagedModelAdminDto }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(item.enabled);
  const [endpoint, setEndpoint] = useState(item.endpoint ?? "");
  const [capabilities, setCapabilities] = useState(prettyJson(item.capabilities));
  const [localError, setLocalError] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-model-configs"] });
    qc.invalidateQueries({ queryKey: ["managed-model-catalog"] });
    qc.invalidateQueries({ queryKey: ["qwen-tts-health"] });
  };

  const save = useMutation({
    mutationFn: () => {
      setLocalError(null);
      let parsedCapabilities: unknown | null = null;
      if (item.capabilityEditable) {
        try {
          parsedCapabilities = JSON.parse(capabilities) as unknown;
        } catch {
          throw new Error("能力配置不是有效 JSON");
        }
      }
      return api<{ item: ManagedModelAdminDto }>("/api/admin/models", {
        method: "PATCH",
        json: {
          key: item.key,
          enabled,
          endpoint: endpoint.trim() || null,
          capabilities: parsedCapabilities,
        },
      });
    },
    onSuccess: refresh,
    onError: (error) => setLocalError(error.message),
  });

  const health = useMutation({
    mutationFn: () =>
      api<{ item: ManagedModelAdminDto }>("/api/admin/models/health", {
        method: "POST",
        json: { key: item.key },
      }),
    onSuccess: refresh,
  });

  const endpointId = `model-endpoint-${item.key.replace(/[^a-z0-9_-]/gi, "-")}`;
  const capabilitiesId = `model-capabilities-${item.key.replace(/[^a-z0-9_-]/gi, "-")}`;

  return (
    <Card data-model-config={item.key}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{item.label}</h2>
              <Badge variant={healthVariant(item.healthStatus)}>
                {HEALTH_LABEL[item.healthStatus]}
              </Badge>
              <Badge variant="secondary">{item.provider}</Badge>
              <Badge variant="outline">{item.kind}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{item.key}</p>
          </div>
          <label className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            接受新任务
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-1.5">
            <Label htmlFor={endpointId}>Endpoint</Label>
            <Input
              id={endpointId}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={item.defaultEndpoint ?? "输入 HTTP/HTTPS Endpoint"}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {item.endpointOverridden
                ? "当前使用数据库覆盖；留空并保存可恢复代码/环境默认值。"
                : "当前使用代码或环境默认值。"}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            <p>
              凭据：{item.credentialEnv ?? "无需独立令牌"} · {item.credentialConfigured ? "已配置" : "缺失"}
            </p>
            <p className="mt-1">连续服务失败：{item.failureStreak}</p>
            <p className="mt-1">最近检查：{item.healthCheckedAt ? new Date(item.healthCheckedAt).toLocaleString("zh-CN") : "尚无"}</p>
          </div>
        </div>

        {item.capabilityEditable && (
          <details
            className="rounded-md border border-border bg-muted/20 px-3 py-2"
            open={item.capabilitiesOverridden}
          >
            <summary className="focus-ring cursor-pointer rounded-sm text-sm font-medium">
              能力配置 JSON{item.capabilitiesOverridden ? "（已覆盖）" : ""}
            </summary>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor={capabilitiesId}>能力配置 JSON</Label>
              <Textarea
                id={capabilitiesId}
                value={capabilities}
                onChange={(event) => setCapabilities(event.target.value)}
                className="min-h-52 font-mono text-xs"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                保存时执行结构、范围和默认值校验；无效配置不会写入数据库。
              </p>
            </div>
          </details>
        )}

        <StatusMessage
          tone={
            item.healthStatus === "healthy"
              ? "success"
              : item.healthStatus === "offline"
                ? "danger"
                : "info"
          }
        >
          {item.healthMessage}
        </StatusMessage>

        {(localError || health.isError) && (
          <StatusMessage tone="danger">
            {localError ?? health.error?.message}
          </StatusMessage>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            loadingText="保存中"
          >
            <Save /> 保存配置
          </Button>
          <Button
            variant="outline"
            onClick={() => health.mutate()}
            loading={health.isPending}
            loadingText="检查中"
            disabled={!enabled}
          >
            <RefreshCw /> 刷新健康
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEnabled(true);
              setEndpoint(item.defaultEndpoint ?? "");
              setCapabilities(prettyJson(item.defaultCapabilities));
              setLocalError(null);
            }}
          >
            <RotateCcw /> 恢复默认值
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ModelConfigClient() {
  const query = useQuery<ManagedModelAdminResponse>({
    queryKey: ["admin-model-configs"],
    queryFn: () => api("/api/admin/models"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-primary/70">
            {"// model runtime"}
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <ServerCog className="size-6 text-primary" /> 模型运行时配置
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            管理能力、Endpoint、上下线和脱敏健康状态。密钥仍只从服务器环境变量读取，不会保存到数据库或返回浏览器。
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">
            <ArrowLeft /> 返回控制台
          </Link>
        </Button>
      </div>

      {query.isLoading ? (
        <LoadingState label="正在加载模型配置…" />
      ) : query.isError || !query.data ? (
        <StatusMessage tone="danger">
          模型配置加载失败，请稍后重试。
        </StatusMessage>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {query.data.items.map((item) => (
            <ModelConfigCard
              key={`${item.key}:${item.updatedAt ?? "default"}:${item.healthCheckedAt ?? "unchecked"}`}
              item={item}
            />
          ))}
        </div>
      )}
    </div>
  );
}
