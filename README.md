# Post Studio

面向小型创意与后期团队的项目制 AI 创作工作站。它把图像、视频、音乐、配音、公式素材、项目协作、资产管理和异步任务整合在一个 Next.js 应用中。

## 功能

- 图像：文生图、参考图、局部编辑与角色 / 场景 / 风格预设
- 视频：文生视频、首帧、首尾帧、全能参考、精确帧数与视频延长
- 音频：歌曲、BGM、TTS 与实验性的 Qwen3-TTS 声音克隆
- 公式：本地 MathJax 渲染、STIX2 字体、本机字体、SVG / PNG 导出和项目资产保存
- 协作：Owner / Editor / Viewer、评论、评审、收藏与项目生命周期管理
- 任务：后台异步生成、状态轮询、失败重试、成本与运行质量统计
- 存储：SQLite、本地媒体、可选 Supabase 中转和备份

## 技术栈

Next.js 16、React 19、TypeScript、Tailwind CSS 4、Radix UI、TanStack Query、Drizzle ORM、SQLite、Auth.js、FFmpeg、MathJax。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
git clone https://github.com/wyucn/poststudio.git
cd poststudio
npm install
cp .env.example .env
npm run dev
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
npm run dev
```

打开 <http://localhost:3000>。默认 `AUTH_MODE=local`，首位注册用户会成为管理员；SQLite 和媒体文件默认保存在 `./data`。

图像 / 视频需要火山方舟密钥。音乐、TTS、声音克隆、媒体中转、企业通知和 CAS 都是可选集成；相关配置见 `.env.example`。所有密钥只应保存在本地或部署平台的环境变量中。

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

端到端测试会使用隔离数据目录：

```bash
npm run test:e2e
```

## 配置与部署

- `AUTH_MODE=local` 可直接使用；`AUTH_MODE=cas` 需要配置 `CAS_AUTH_URL`、`CAS_LOGIN_URL`、`NEXT_PUBLIC_CAS_LOGIN_URL` 和 `ORG_EMAIL_DOMAIN`。
- Coze 集成需要令牌及对应的插件 ID，公开仓库不提供任何账号专属 ID。
- `APP_PUBLIC_URL` 用于通知中的项目链接。
- 可使用仓库内 `Dockerfile` / `docker-compose.yml`，或自行部署到支持 Node.js 与持久化目录的平台。
- 生产环境必须为 `DATA_DIR` 提供持久化存储，并使用随机强 `AUTH_SECRET`。

## 文档

- [产品范围](PRD.md)
- [贡献指南](CONTRIBUTING.md)
- [数据一致性](docs/DATA-INTEGRITY.md)
- [备份与恢复](docs/BACKUP-RESTORE.md)

## 安全与隐私

这个公开仓库是经过脱敏的源码快照，不包含原始内部 Git 历史、部署凭据、真实数据、内部域名、账号专属插件 ID 或含真实用户信息的截图。

- 不要提交 `.env`、数据库、媒体目录、私钥、Cookie 或访问令牌。
- 声音克隆仅用于本人声音或已取得明确授权的声音。
- 部署到公网前，请自行完成鉴权、存储、CSP、限流和供应商数据合规审查。

## License

No license has been granted yet. Unless a license file is added later, all rights are reserved by the repository owner. Third-party assets keep their own licenses under `public/vendor/`.
