# 贡献指南

## 开发流程

1. Fork 仓库并从最新 `main` 创建功能分支。
2. 从 `.env.example` 创建本地 `.env`，不要提交真实密钥或数据。
3. 完成代码和与风险相称的测试。
4. 在提交 Pull Request 前运行：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

数据库 schema 变更需保持向后兼容，并通过 `npm run db:generate` 提交对应迁移。涉及 AI 供应商的长请求必须继续使用后台任务模式。

## 安全

禁止提交 `.env`、私钥、数据库、媒体文件、真实用户资料、供应商响应原文或任何访问令牌。示例统一使用 `example.com` 和明显的占位值。
