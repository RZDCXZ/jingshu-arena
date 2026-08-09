# 开发说明

## 固定工具链

| 工具或框架          | 版本      |
| ------------------- | --------- |
| Node.js             | `24.18.0` |
| pnpm                | `9.15.9`  |
| Next.js             | `16.3.0`  |
| React / React DOM   | `19.2.8`  |
| Hono                | `4.13.1`  |
| `@hono/node-server` | `2.1.0`   |
| Drizzle ORM         | `0.45.2`  |
| Drizzle Kit         | `0.31.10` |
| TypeScript          | `6.0.3`   |
| Playwright          | `1.62.1`  |

`.node-version`、`.nvmrc`、根 `package.json` 的 `engines` / `packageManager` 和唯一的 `pnpm-lock.yaml` 共同固定本地与 CI 工具链。`preinstall` 会拒绝不匹配的 Node.js 或 pnpm；依赖升级必须显式修改清单与 lockfile。

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
```

## 六个逻辑模块

```text
apps/web          -> packages/contracts
apps/api          -> packages/contracts, packages/domain, packages/database
apps/miniprogram  -> packages/contracts, packages/domain
packages/database -> packages/contracts, packages/domain
packages/contracts
packages/domain
```

- `apps/web` 是唯一多角色 Next.js Web 应用。
- `apps/api` 的 Hono 核心使用 Fetch `Request` / `Response`，Node 本地入口保持为薄适配器。
- `apps/miniprogram` 是原生微信小程序，本地状态不请求 Web API。
- `packages/domain` 只容纳纯 TypeScript 领域规则；门禁禁止数据库、Node、React、Next.js、Hono 和微信运行时依赖。
- `packages/contracts` 定义跨端公开契约。
- `packages/database` 隔离 Drizzle、Postgres schema 与前向迁移。

`pnpm check:workspace` 同时检查版本、严格 TypeScript、依赖方向、领域纯度和单一 pnpm lockfile。

## 日常命令

| 命令                     | 用途                                   |
| ------------------------ | -------------------------------------- |
| `pnpm dev`               | 同时启动 Web `:3000` 与 API `:3001`    |
| `pnpm build`             | 构建全部六个工作区模块                 |
| `pnpm build:web`         | 构建 Next.js Web                       |
| `pnpm build:api`         | 构建 Hono API                          |
| `pnpm build:miniprogram` | 生成原生小程序 `apps/miniprogram/dist` |
| `pnpm format:check`      | 检查统一格式                           |
| `pnpm lint`              | ESLint 与模块边界门禁                  |
| `pnpm typecheck`         | 所有工作区运行同一 strict TypeScript   |
| `pnpm test:unit`         | 快速单元测试                           |
| `pnpm test:contracts`    | 存储适配器契约测试独立入口             |
| `pnpm test:postgres`     | 真实临时 Postgres 空库迁移测试         |
| `pnpm test:e2e`          | Chromium Web 浏览器测试                |
| `pnpm test:seed`         | seed/reset 测试独立入口                |
| `pnpm check:sensitive`   | Secret、凭据和真实个人数据模式检查     |
| `pnpm security:audit`    | 高危依赖漏洞扫描                       |
| `pnpm verify`            | 本地与 CI 共用的完整验证               |

## 临时 Postgres

`pnpm test:postgres` 不使用 SQLite 或内存数据库：

- 未设置 `DATABASE_URL` 时，命令通过 Docker 创建专用 `postgres:17-alpine` 容器，测试完成后自动销毁。
- CI 提供一次性 Postgres service，并运行同一命令。
- 外部地址只允许 `localhost`、`127.0.0.1` 或 CI service 名 `postgres`，且拒绝名称含 `prod` 的数据库。
- 测试先确认目标表不存在，再从空库执行全部 Drizzle 前向迁移并检查 schema 元数据。

环境变量只从本地 `.env` 或受保护 CI Secret 注入；版本库仅提交 `.env.example` 中的变量名、用途和占位值。

## 原生微信小程序

```bash
pnpm build:miniprogram
```

在微信开发者工具中导入 `apps/miniprogram`。提交的 `project.config.json` 使用游客 AppID 占位值，`miniprogramRoot` 指向生成的 `dist/`；不要把真实 AppID、私钥或上传凭据提交到仓库。小程序只代表独立本地演示，不与 Web 沙箱同步。

## 分支与发布边界

- 功能开发位于公开的 `codex/jingshu-basic-rc` 分支；通过阶段门禁的未完成工作可以公开。
- `main` 必须始终保持可发布；只有格式、lint、strict TypeScript、单元/契约/Postgres/E2E、三端构建、迁移、seed/reset、安全扫描全部通过后才可合并。
- 测试、seed 和迁移不得连接生产数据库；部署凭据只存在于受保护环境。
