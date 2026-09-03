"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { AuthVisual } from "@/components/auth-visual";
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

export function LocalLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError("邮箱或密码错误");
    } else {
      window.location.assign("/");
    }
  }

  return (
    <div className="auth-experience">
      <AuthVisual />
      <section className="auth-form-panel" aria-labelledby="login-title">
        <Card className="auth-glass-card w-full max-w-sm">
          <CardHeader>
            <p className="auth-form-kicker">WELCOME BACK</p>
            <CardTitle id="login-title" className="auth-form-title">
              回到创作潮汐
            </CardTitle>
            <CardDescription>登录 HAITUN.POST，继续你的项目。</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              {error && <StatusMessage tone="danger">{error}</StatusMessage>}
              <Button
                type="submit"
                className="w-full"
                loading={loading}
                loadingText="登录中"
              >
                登录
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                还没有账号？{" "}
                <Link href="/register" className="text-primary hover:underline">
                  注册
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
