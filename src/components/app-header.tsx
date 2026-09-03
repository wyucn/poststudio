"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  LogOut,
  Ticket,
  Copy,
  Pencil,
  ShieldCheck,
  User,
  Building2,
  Mail,
  IdCard,
} from "lucide-react";
import { DolphinMark } from "@/components/dolphin-mark";
import { api } from "@/lib/client/api";
import type { MeDto, LdapProfileDto } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusMessage } from "@/components/ui/status-message";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Invite {
  id: string;
  code: string;
  usedBy: string | null;
}

function InviteDialog() {
  const qc = useQueryClient();
  const { data: invites, isLoading } = useQuery<Invite[]>({
    queryKey: ["invites"],
    queryFn: () => api("/api/invites"),
  });
  const create = useMutation({
    mutationFn: () => api("/api/invites", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites"] }),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>邀请码管理</DialogTitle>
        <DialogDescription>生成邀请码发给团队成员，注册时填写即可加入</DialogDescription>
      </DialogHeader>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {isLoading && <LoadingState appearance="inline" label="正在加载邀请码…" className="py-6" />}
        {!isLoading && invites?.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2"
          >
            <code className="font-mono text-sm">{inv.code}</code>
            <div className="flex items-center gap-2">
              {inv.usedBy ? (
                <Badge variant="secondary">已使用</Badge>
              ) : (
                <>
                  <Badge variant="success">可用</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigator.clipboard.writeText(inv.code)}
                  >
                    <Copy />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
        {!isLoading && !invites?.length && (
          <p className="text-sm text-muted-foreground">还没有邀请码</p>
        )}
      </div>
      <Button
        onClick={() => create.mutate()}
        loading={create.isPending}
        loadingText="生成中"
      >
        生成新邀请码
      </Button>
      {create.isError && <StatusMessage tone="danger">{create.error.message}</StatusMessage>}
    </DialogContent>
  );
}

/** 身份信息区：展示姓名 / LDAP 账号 / 部门 / 邮箱 */
function LdapProfile() {
  const { data, isLoading } = useQuery<LdapProfileDto>({
    queryKey: ["me-ldap"],
    queryFn: () => api("/api/me/ldap"),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return <LoadingState appearance="inline" label="读取账号信息…" className="justify-start py-2" />;
  }
  if (!data) return null;

  const rows: { icon: ReactNode; label: string; value: string | null }[] = [
    { icon: <User className="size-3.5" />, label: "姓名", value: data.name },
    { icon: <IdCard className="size-3.5" />, label: "LDAP 账号", value: data.ldap },
    { icon: <Building2 className="size-3.5" />, label: "部门", value: data.department },
    { icon: <Mail className="size-3.5" />, label: "邮箱", value: data.email },
  ].filter((r) => r.value);

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <dl className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-sm">
            <span className="flex w-20 shrink-0 items-center gap-1.5 text-muted-foreground">
              {r.icon}
              {r.label}
            </span>
            <dd className="truncate font-medium" title={r.value ?? undefined}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ProfileDialog({ currentName }: { currentName: string }) {
  const [name, setName] = useState(currentName);
  const save = useMutation({
    mutationFn: () => api("/api/me", { method: "PATCH", json: { name: name.trim() } }),
    // 昵称会出现在服务端渲染的页面里，直接整页刷新最稳妥
    onSuccess: () => window.location.reload(),
  });
  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>账号信息</DialogTitle>
        <DialogDescription>
          昵称仅用于展示；登录与添加成员仍以 LDAP / 邮箱识别
        </DialogDescription>
      </DialogHeader>
      <LdapProfile />
      <div className="space-y-1.5">
        <Label
          htmlFor="profile-display-name"
          className="text-xs font-medium text-muted-foreground"
        >
          修改展示昵称
        </Label>
        <div className="flex gap-2">
          <Input
            id="profile-display-name"
            value={name}
            maxLength={24}
            placeholder="输入新昵称"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) save.mutate();
            }}
          />
          <Button
            onClick={() => save.mutate()}
            disabled={!name.trim()}
            loading={save.isPending}
            loadingText="保存中"
          >
            保存
          </Button>
        </div>
      </div>
      {save.isError && <StatusMessage tone="danger">{save.error.message}</StatusMessage>}
    </DialogContent>
  );
}

export function AppHeader({
  userName,
  isAdmin,
  casMode = false,
}: {
  userName: string;
  isAdmin: boolean;
  casMode?: boolean;
}) {
  // 从 /api/me 拿最新昵称（本地模式下会话里的 name 可能过期）
  const { data: me } = useQuery<MeDto>({
    queryKey: ["me"],
    queryFn: () => api("/api/me"),
    staleTime: 60_000,
  });
  const displayName = me?.name ?? userName;
  const adminBadge = me ? me.role === "admin" : isAdmin;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const initial = displayName.trim().slice(0, 1).toUpperCase() || "U";

  return (
    <header className="scroll-edge-fade sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link href="/projects" className="group flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
            <DolphinMark className="size-5" />
          </span>
          <span className="leading-tight">
            <span className="block font-mono text-sm font-semibold tracking-[0.08em]">
              HAITUN<span className="text-primary">.</span>POST
            </span>
            <span className="hidden font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground sm:block">
              海豚后期 / AIGC Studio
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {/* 主栏只保留高频入口：控制台 */}
          {adminBadge && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">
                <BarChart3 /> 控制台
              </Link>
            </Button>
          )}
          {/* 次要项收纳进头像下拉 */}
          {/* modal={false}:非模态下拉不锁 body,避免与从菜单项打开的对话框
           * 争抢 body 的 pointer-events 清理(Radix 已知冲突,radix #1241) */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                className="focus-ring flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2 text-sm transition-colors hover:border-primary/40"
                title="账号与菜单"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-primary font-mono text-xs text-primary-foreground">
                  {initial}
                </span>
                <span className="hidden max-w-24 truncate sm:block">{displayName}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel className="flex items-center gap-1.5">
                {displayName}
                {adminBadge && (
                  <span className="flex items-center gap-0.5 font-mono text-xs uppercase tracking-wider text-primary">
                    <ShieldCheck className="size-3" /> admin
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                <Pencil className="size-4 text-muted-foreground" /> 账号信息
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/docs">
                  <BookOpen className="size-4 text-muted-foreground" /> 使用文档
                </Link>
              </DropdownMenuItem>
              {isAdmin && !casMode && (
                <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
                  <Ticket className="size-4 text-muted-foreground" /> 邀请码
                </DropdownMenuItem>
              )}
              {!casMode && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => signOut({ callbackUrl: "/login" })}
                  >
                    <LogOut className="size-4" /> 退出登录
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 受控弹窗：由下拉项触发 */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <InviteDialog />
      </Dialog>
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <ProfileDialog currentName={displayName} />
      </Dialog>
    </header>
  );
}
