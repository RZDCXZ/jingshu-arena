# 01 — 生产路由基础与店员工作台 tracer

**What to build:** 建立生产 Web 的规范路由基础，使访客可以通过真实 App Router 路径进入店员工作台，并为后续角色页面迁移提供唯一、可测试的路径契约和持续挂载的共享角色布局。

**Blocked by:** None — can start immediately.

**Triage:** ready-for-agent

**State:** resolved

- [x] 规范路径契约能够解析并生成已批准的角色根路径、静态页面、稳定 Tab、对象详情和查询参数形状，且默认落点与产品契约 1.20 一致。
- [x] 无有效角色上下文访问 `/` 时仍显示公开入口，不创建部分沙箱，也不进入角色业务页面。
- [x] 有效店员上下文访问 `/` 或 `/staff` 时，以历史替换进入 `/staff/workbench`。
- [x] 直接打开或刷新 `/staff/workbench` 会显示店员共享角色壳和工作台，而不是返回根页或 404。
- [x] 店员工作台路径使用共享角色布局；页面重新导航时角色上下文、沙箱时钟、主演示入口和数据新鲜度仍可见。
- [x] `/` 保持可索引，角色业务路径输出 `noindex, nofollow`。
- [x] 路由契约测试覆盖规范生成、解析、父路径替换、小写静态段、无尾斜杠和固定查询参数顺序。
- [x] 当前仓库格式、lint、类型检查、生产 Web 构建及相关路由测试通过。

## Comments

### 2026-08-12 — 完成说明与验证证据

- 新增集中式纯 TypeScript 规范路由清单，覆盖 `prod.md` 1.20 / 6.4 的四角色根路径、静态页面、稳定 Tab、对象详情、父路径默认替换、页面元数据和页面级查询参数允许形状；URL 解析/生成统一规范小写静态段、无尾斜杠、未知参数移除、重复参数收束和固定查询顺序。
- 新增真实 Next.js App Router `app/staff/layout.tsx`、`app/staff/page.tsx` 与 `app/staff/workbench/page.tsx`。有效店员上下文从 `/` 以历史替换进入 `/staff/workbench`，`/staff` 父路径同样替换到唯一默认页；直接打开和刷新继续挂载既有共享角色壳与权威工作台。
- 共享布局持续保留服务端签发的角色上下文、沙箱生命周期、沙箱业务时钟、主演示入口和数据新鲜度。未迁移角色仍临时回到既有根表面，避免本票越界实现后续角色路由；切换过程保持既有弹窗、焦点与跨标签恢复契约。
- 根元数据显式输出 `index, follow`，店员命名空间统一输出 `noindex, nofollow`。没有有效上下文的根入口回归确认仍不创建部分沙箱或进入角色业务页。
- 领域与架构核对：使用 `CONTEXT.md` 的“店员、角色上下文、沙箱、沙箱业务时钟、沙箱失效通知”规范术语；遵守 ADR-0010、0011、0014、0015、0018、0020、0023，没有改变 API、数据库、权限、不变量或领域状态机。
- 真相源更新：`product-ui/management-system/design-prototype/design-coverage.md` 记录 Ticket 01 已覆盖页面与旅程；`design-qa.md` 记录局部 1.20 路由证据，并明确整套 1.20 QA 继续保持 `stale`，未提前声称完整交付。
- `pnpm exec vitest run --config vitest.unit.config.ts apps/web/app/web-route-contract.test.ts`：通过，1 个文件 / 9 项测试。
- `pnpm exec playwright test tests/e2e/public-entry.spec.ts tests/e2e/role-context-shell.spec.ts`：通过，Chromium 62 项；包含 `/` 与 `/staff` 历史替换、工作台直达/刷新、`index`/`noindex`、共享壳、角色切换、失效恢复、SSE/轮询、业务时间、重置及只读降级回归。
- 精确视口证据：`1440 × 1024` 与 `1024 × 768` 均确认 `/staff/workbench` 无页面级横向溢出，进入角色后的浏览器 warning/error 为 0，角色人物、门店范围、业务时钟、主演示和新鲜度可见。
- `pnpm format:check`、`pnpm lint`（含工作区检查）、`pnpm typecheck`：全部通过。
- `pnpm --filter @jingshu/web build`：通过；Next.js 生产构建列出 `/`、`/staff`、`/staff/workbench` 三个真实 App Router 入口。
