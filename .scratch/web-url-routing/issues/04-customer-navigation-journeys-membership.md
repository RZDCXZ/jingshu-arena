# 04 — 顾客入口、门店、行程与会员路由

**What to build:** 让顾客预约入口、门店、统一行程和会员体验券页面拥有稳定 URL，使顾客切换底部导航和业务 Tab 时可以刷新、复制及使用浏览器历史恢复当前位置。

**Blocked by:** 03 — 服务端角色上下文与深链守卫.

**Triage:** ready-for-agent

**State:** resolved

- [x] `/customer` 以历史替换进入 `/customer/reservations`，预约入口和 `/customer/stores` 使用真实导航链接。
- [x] `/customer/journeys/current`、`future` 和 `history` 分别恢复统一行程的当前、未来和历史 Tab。
- [x] “我的预约、我的订单、我的报修”使用统一行程路径；`type=order|repair` 只作为已应用筛选，不创建重复列表地址。
- [x] 历史行程的模拟退款筛选写入白名单查询参数，默认值省略，刷新和复制链接恢复同一结果。
- [x] `/customer/membership/coupons/available|reserved|redeemed|expired` 恢复对应体验券 Tab，父路径替换到 `available`。
- [x] 顾客导航使用语义化链接，页面标题、主标题、底部导航和 Tab 的当前状态与 URL 一致。
- [x] 新页面/Tab 导航聚焦主标题并回到顾客工作区顶部；后退/前进恢复上一稳定页面。
- [x] `360 × 800` 下上述导航无页面级横向溢出，固定导航不遮挡内容，控制台无新增错误。

## Comments

### 2026-08-12 — 完成说明与验证证据

- 新增 `/customer/reservations`、`/customer/stores`、三组显式行程 Tab 和四组显式体验券 Tab 的轻量 App Router 页面；`/customer/journeys` 保留合法筛选并替换到 `current`，`/customer/membership/coupons` 替换到 `available`。共享 `RoleRouteLayout` 使用 `useSearchParams` 与 `Suspense` 同步查询参数变化，旧 catch-all 只继续承担后续顾客详情票和安全未知页边界。
- 新增受控 `CustomerRouteState`：预约、门店、行程 Tab、体验券 Tab、行程类型和退款筛选均从 URL 读取。顾客侧栏、H5 底部导航及稳定 Tab 改用语义化 `Link`；行程类型和退款等立即筛选使用 `router.replace`。`type` 仅允许 `order|repair`，`refunds` 仅允许 `only`，默认/非法值与未知参数从规范 URL 移除，输出顺序固定为 `type` 后 `refunds`。
- “我的订单/报修”不会建立重复列表路径：二者进入统一行程并保留已有子记录以及当前符合创建资格的预约，真实主演示可继续从唯一匹配行程进入预约详情创建订单或报修。页面/Tab 改变同步标题、`h1`、侧栏、底部导航和 `aria-current`，并把顾客工作区滚动到顶部、聚焦主标题；筛选不污染历史栈，稳定 Tab 的后退/前进可恢复。
- 真相源更新：`product-ui/management-system/design-prototype/design-coverage.md` 新增 Web URL 路由 Ticket 04 覆盖；`design-qa.md` 记录选定小程序源、夜间共享壳源、三档视口、浏览器交互和 P0/P1/P2 清零结论。证据位于 `design/evidence/web-url-routing-ticket-04/`：历史筛选与会员 `360 × 800`、行程 `1440 × 1024`、会员 `1024 × 768` 共四张截图。
- 领域与架构复核：继续使用 `CONTEXT.md` 和 `prod.md` 的“统一行程、体验券、已应用筛选、角色上下文”等规范术语；遵守 ADR-0007、0010、0014。体验券占用/释放规则、服务端权限、单一多角色 Web 应用和领域状态机均未改变，因此不新增或修改 ADR。
- `pnpm format:check`、`pnpm lint`（含工作区检查）、`pnpm typecheck`、`git diff --check`：通过。
- `pnpm exec vitest run --config vitest.unit.config.ts apps/web/app/web-route-contract.test.ts`：通过，1 个文件 / 10 项；覆盖显式默认落点、查询白名单、非法/默认值移除、固定参数顺序和路由元数据。
- `pnpm exec playwright test tests/e2e/customer-seat-browse.spec.ts --project=chromium`：通过，Chromium 15 项；Ticket 04 专用用例覆盖刷新/复制、后退/前进、筛选历史替换、标题/焦点/当前状态、父路径、`360 × 800` 无溢出和固定底栏，以及 `1440 × 1024`、`1024 × 768` 共享壳；专用控制台 warning/error 为 0。
- `pnpm exec playwright test tests/e2e/role-context-shell.spec.ts --project=chromium`：通过，Chromium 57 项；共享角色壳、深链守卫、主演示抽屉、角色切换、SSE/轮询、只读恢复、业务时间与响应式回归保持绿色。
- `pnpm test:demo-story-browser`：通过，2 项真实 Web → Hono → 临时 PostgreSQL 主演示；页面通过 `type=order|repair` 统一行程筛选继续完成订单与报修入口，并走完四角色完整旅程。
- `pnpm --filter @jingshu/web build`：通过；Next.js 16.3.0 生产构建列出本票 11 个显式顾客页面/父路径，编译、TypeScript、页面数据与静态生成阶段全部通过。
- 额外全量单元诊断为 352/355 通过；仅 `apps/api/src/sandbox-realtime.test.ts` 3 项因旧夹具 `expiresAt = 2026-08-12T11:30:00Z` 已早于本轮墙钟而返回预期之外的 401。单独复跑结果一致，文件与本票均无交集；未在本票静默扩展范围修改 Ticket 27 的时间夹具。
