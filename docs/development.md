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
- `apps/api` 的 Hono 核心使用 Fetch `Request` / `Response`，Node 本地入口保持为薄适配器。核心只接收适配器注入的普通 `clientIp` 值：Node 入口从对端 socket 规范化该值，未来 EdgeOne 入口只能从平台受信任的连接元数据注入；公开的 `X-Forwarded-For`、`X-Real-IP` 与同类请求头永不作为配额身份。没有可信 IP 时，签名访客限额仍然生效，IP 限额仅作为附加约束。
- `apps/miniprogram` 是原生微信小程序，本地状态不请求 Web API。
- `packages/domain` 只容纳纯 TypeScript 领域规则；门禁禁止数据库、Node、React、Next.js、Hono 和微信运行时依赖。
- `packages/contracts` 定义跨端公开契约。
- `packages/database` 隔离 Drizzle、Postgres schema 与前向迁移。

`pnpm check:workspace` 同时检查版本、严格 TypeScript、依赖方向、领域纯度和单一 pnpm lockfile。

## 日常命令

| 命令                     | 用途                                                |
| ------------------------ | --------------------------------------------------- |
| `pnpm dev`               | 准备本地 Postgres 并启动 Web `:3000` 与 API `:3001` |
| `pnpm build`             | 构建全部六个工作区模块                              |
| `pnpm build:web`         | 构建 Next.js Web                                    |
| `pnpm build:api`         | 构建 Hono API                                       |
| `pnpm build:miniprogram` | 生成原生小程序 `apps/miniprogram/dist`              |
| `pnpm format:check`      | 检查统一格式                                        |
| `pnpm lint`              | ESLint 与模块边界门禁                               |
| `pnpm typecheck`         | 所有工作区运行同一 strict TypeScript                |
| `pnpm test:unit`         | 快速单元测试                                        |
| `pnpm test:contracts`    | 存储适配器契约测试独立入口                          |
| `pnpm test:postgres`     | 真实临时 Postgres 空库迁移测试                      |
| `pnpm test:e2e`          | Chromium Web 浏览器测试                             |
| `pnpm test:seed`         | seed/reset 测试独立入口                             |
| `pnpm check:sensitive`   | Secret、凭据和真实个人数据模式检查                  |
| `pnpm security:audit`    | 高危依赖漏洞扫描                                    |
| `pnpm verify`            | 本地与 CI 共用的完整验证                            |

## 临时 Postgres

`pnpm dev` 会先准备完整的本地开发依赖：

- 未设置 `DATABASE_URL` 时，通过 Docker 创建仅在本次开发进程存活期间使用的 `postgres:17-alpine` 容器，执行前向迁移后再启动 API 与 Web；退出开发进程时自动销毁容器。
- 启动器依次读取可选的根目录 `.env` 与 `.env.local`，后者用于本机覆盖且两者都不会提交到 Git。
- 已在环境文件中设置本地 `DATABASE_URL` 时，复用该数据库并在启动前执行迁移，不创建容器。
- 未设置 `SESSION_SECRET` 时，每次开发启动生成只存在于当前进程内的随机会话密钥；需要在重启间保留浏览器演示会话时，可在 `.env.local` 中设置至少 32 个字符的本地值。
- 本地未设置 `REPAIR_IMAGE_STORAGE_DIR` 时，报修净化图片使用系统临时目录；生产启动会拒绝缺少该变量的配置。生产值必须是 API 多实例共享、跨重启持久化且不由静态站点公开服务的私有卷，目录与文件权限分别收紧为 `0700` 与 `0600`。
- 报修隔离区、未被数据库采用的成品以及沙箱重置清理由 Postgres 持久化清理任务驱动；失败会指数退避重试，避免进程退出或单次对象删除故障遗留私有文件。
- API 或 Web 任一进程启动失败时，另一进程会一并退出，避免只剩 Web 运行并把后端未启动误呈现为角色上下文故障。

### 局域网真机调试

手机与电脑连接同一局域网时，直接运行：

```bash
pnpm dev
```

启动器默认让 Web 监听 `0.0.0.0`，自动选择物理网卡上的私有 IPv4，并打印类似下面的地址：

```text
Web available to phones on the same network at http://192.168.1.8:3000.
```

手机打开该地址即可。API 仍只监听 `127.0.0.1:3001`，由 Web 同源代理访问；开发启动器仅把自动探测的局域网地址和两个回环地址作为精确 Origin 加入本地写请求白名单，生产环境不会接受这些附加 Origin。

如果电脑同时连接了多个网络而自动选择不正确，只需在未提交的 `.env.local` 中指定手机能访问的地址：

```env
JINGSHU_DEV_ACCESS_HOST=<computer-lan-ip-or-hostname>
```

如需明确关闭局域网访问，可设置 `JINGSHU_WEB_HOST=127.0.0.1`。`PUBLIC_ORIGIN` 仍可覆盖主要 Origin，但不再需要为了普通局域网真机调试手工修改。

### 部署实时能力探针

部署平台的就绪探针必须请求 `GET /api/v1/health/realtime`，而不是只请求通用健康端点。只有响应 `200` 且 `status` 为 `ready` 时，实例才可声明 SSE 可用；`503` / `degraded` 表示 PostgreSQL `LISTEN/NOTIFY` 桥接尚不可用，Web 会以轮询和手动刷新作为正式退路。该探针须运行在将承接公开 API 流量的同一运行时与数据库配置上；具体云平台接线仍遵循 ADR-0001 的部署阶段验证。

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

在微信开发者工具中导入 `apps/miniprogram`。提交的 `project.config.json` 使用登记的公开 AppID `wx979479d3ff61d825`，`miniprogramRoot` 指向生成的 `dist/`；AppID 是公开标识，不要把私钥、上传凭据或其他 Secret 提交到仓库。小程序只代表独立本地演示，不与 Web 沙箱同步。

## 分支与发布边界

- 功能开发位于公开的 `codex/jingshu-basic-rc` 分支；通过阶段门禁的未完成工作可以公开。
- `main` 必须始终保持可发布；只有格式、lint、strict TypeScript、单元/契约/Postgres/E2E、三端构建、迁移、seed/reset、安全扫描全部通过后才可合并。
- 测试、seed 和迁移不得连接生产数据库；部署凭据只存在于受保护环境。
