# 06 — 顾客商品订单与报修路由

**What to build:** 让顾客从预约详情进入商品订单和报修的创建、确认、支付与详情路径，并确保每个已创建对象只有一个规范地址且不会跨沙箱分享。

**Blocked by:** 05 — 顾客预约创建、详情与模拟支付路由.

**Triage:** ready-for-agent

**State:** resolved

- [x] 商品目录和确认分别使用 `/customer/reservations/:reservationId/orders/new` 与其 `/confirm` 子路径，并继续绑定服务端确认的预约、门店和座位。
- [x] 刷新商品确认但缺少购物车或体验券草稿时，安全回到商品目录并说明未提交购物车未被保留。
- [x] 商品订单创建成功进入 `/customer/orders/:orderId`；模拟支付使用其 `/payment` 子路径，订单状态推进不改变详情 URL。
- [x] 报修创建使用 `/customer/reservations/:reservationId/repairs/new`，创建成功进入 `/customer/repairs/:repairId`。
- [x] 订单和报修详情直达、刷新、返回以及关联预约跳转均使用真实链接和服务端权威读取。
- [x] 另一访客或新沙箱打开原对象 URL 时显示“对象不存在或不可访问”，不共享对象、图片或可写沙箱。
- [x] 购物车、商品体验券、报修描述和待上传图片不写入 URL 或浏览器持久存储。
- [x] `360 × 800` Chromium E2E 覆盖目录、确认回退、订单详情/支付、报修创建/详情、历史和安全对象边界。

## Comments

### 2026-08-12 — resolved

- 实现：为商品目录/确认、订单详情/模拟支付、报修创建/公开详情新增六组显式 Next.js App Router 页面；URL 成为步骤和对象身份的唯一导航真相。订单与报修创建成功进入唯一资源详情，支付先在 `/payment` 重读服务端合法动作，状态刷新不改变详情地址。
- 安全与恢复：确认草稿、商品体验券、报修描述和待上传图片只保留在 React 内存；确认刷新以 `replace` 回到目录并解释草稿未保留。订单/报修 403 与 404 同形，切换对象先清空旧数据并以请求序列隔离迟到响应；报修对象授权失败时不请求私有图片列表。
- 文档：更新 `product-ui/management-system/design-prototype/design-coverage.md` 与 `design-qa.md`；功能契约和已接受 ADR 已经完整表达本票行为，无需变更。证据位于 `product-ui/management-system/design-prototype/design/evidence/web-url-routing-ticket-06/`，覆盖 `360 × 800` 的目录、确认、回退、订单、支付、报修、历史与安全边界，以及 `1440 × 1024`、`1024 × 768` 共享壳。
- 验证通过：`pnpm format:check`；`pnpm lint`；`pnpm typecheck`；`pnpm check:sensitive`；路由契约 Vitest 10/10；`customer-seat-browse.spec.ts` Chromium 20/20；Ticket 06 证据复跑 2/2；`pnpm test:demo-story-browser` 真实 Web → Hono → 临时 PostgreSQL 2/2；`pnpm --filter @jingshu/web build`。
- 已知无关基线：`pnpm test:unit` 为 352/355；仅 `apps/api/src/sandbox-realtime.test.ts` 的 3 个既有用例失败，因为夹具把 `expiresAt` 固定为 `2026-08-12T11:30:00.000Z`，当前真实时钟已越过该值而按契约返回 401。本票未修改实时会话链路或该测试夹具，路由相关单测与全部受影响浏览器/真实数据库验证均通过。
