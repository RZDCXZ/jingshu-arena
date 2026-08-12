# 05 — 顾客预约创建、详情与模拟支付路由

**What to build:** 让顾客选座、预约确认、预约详情和模拟支付形成完整可导航旅程，并在刷新缺少未提交选择时安全回退而不伪造草稿。

**Blocked by:** 04 — 顾客入口、门店、行程与会员路由.

**Triage:** ready-for-agent

**State:** resolved

- [x] 顾客从预约入口进入 `/customer/reservations/new/seats` 和 `/customer/reservations/new/confirm` 时，每一步都改变 URL 并保留现有业务校验。
- [x] 直接打开或刷新确认步骤但缺少选座、时段或体验券内存状态时，以历史替换回最近可继续步骤，并说明未提交选择未被保留。
- [x] 创建预约成功后进入 `/customer/reservations/:reservationId`，以一次性反馈说明创建结果，不产生 `/created` 或 `/success` 别名。
- [x] 预约详情直达和刷新会从服务端读取当前预约状态、价格快照、体验券、模拟退款和业务事件。
- [x] 待确认预约的模拟支付页面使用 `/customer/reservations/:reservationId/payment`；不合法状态显示安全恢复结果而不提供非法动作。
- [x] 预约 ID 来自 URL 但对象读取和命令仍按当前顾客、沙箱和服务端角色上下文重新授权。
- [x] 预约创建草稿、取消原因和体验券选择不写入 URL 或浏览器持久存储。
- [x] Chromium E2E 覆盖创建步骤、刷新回退、成功详情、直接详情、支付路径、浏览器历史和对象越权边界。

## Comments

- 2026-08-12：完成四个显式 App Router 页面、内存草稿回退、创建后规范详情与一次性反馈、服务端权威详情重读、支付状态门禁、迟到请求隔离，以及 403/404 同形对象边界。现有 `prod.md` 已准确规定本票行为，无需重复改写；同步更新管理系统 `design-coverage.md`、`design-qa.md` 和五张三档视口证据。
- 2026-08-12：验证通过：Web 路由契约 `10/10`；`pnpm lint`；`pnpm typecheck`；`pnpm format:check`；`pnpm build:web`；顾客 Chromium `18/18`；角色深链/对象边界 Chromium `3/3`；Ticket 05 三档视口 Chromium `3/3`；真实 Web → API → 临时 PostgreSQL 主演示 `2/2`。全量 `pnpm test:unit` 为 `352/355`，仅有 `apps/api/src/sandbox-realtime.test.ts` 三条既有失败：固定 `expiresAt=2026-08-12T11:30:00Z` 已早于当前墙钟，角色夹具返回 `401`；该时间夹具不在本票范围，且本票相关单元、浏览器和真实数据库路径均通过。
