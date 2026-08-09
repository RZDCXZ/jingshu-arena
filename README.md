# 竞枢 · Jingshu Arena

竞枢是一个面向单一虚构电竞场馆经营方的多端预约与运营协同演示。当前分支从 ticket 01 开始建立可复现的 pnpm 工作区、Web、API、原生微信小程序、共享包、真实 Postgres 迁移测试和 CI 门禁。

## 快速开始

本仓库精确使用 Node.js `24.18.0` 与 pnpm `9.15.9`：

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm verify
```

开发命令、模块依赖、临时 Postgres、微信开发者工具和分支发布边界见 [开发说明](docs/development.md)。业务词汇见 [CONTEXT.md](CONTEXT.md)，架构决定见 [docs/adr](docs/adr)。
