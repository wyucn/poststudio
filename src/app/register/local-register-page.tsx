"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { AuthVisual } from "@/components/auth-visual";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusMessage } from "@/components/ui/status-message";

export function LocalRegisterPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    inviteCode: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateField(key: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/register", { method: "POST", json: form });
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (result?.error) {
        throw new Error("注册成功，但自动登录失败，请前往登录页");
      }
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-experience">
      <AuthVisual />
      <section className="auth-form-panel" aria-labelledby="register-title">
        <Card className="auth-glass-card w-full max-w-sm">
          <CardHeader>
            <p className="auth-form-kicker">JOIN THE CURRENT</p>
            <CardTitle id="register-title" className="auth-form-title">
              创建你的空间
            </CardTitle>
            <CardDescription>首位注册用户将自动成为管理员，无需邀请码</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">昵称</Label>
                <Input
                  id="name"
                  required
                  value={form.name}
                  onChange={updateField("name")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={updateField("email")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码（至少 6 位）</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={form.password}
                  onChange={updateField("password")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inviteCode">邀请码（首位用户留空）</Label>
                <Input
                  id="inviteCode"
                  value={form.inviteCode}
                  onChange={updateField("inviteCode")}
                />
              </div>
              {error && <StatusMessage tone="danger">{error}</StatusMessage>}
              <Button
                type="submit"
                className="w-full"
                loading={loading}
                loadingText="注册中"
              >
                注册
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                已有账号？{" "}
                <Link href="/login" className="text-primary hover:underline">
                  登录
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
