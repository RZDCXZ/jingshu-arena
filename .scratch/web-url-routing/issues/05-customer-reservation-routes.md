# 05 — 顾客预约创建、详情与模拟支付路由

**What to build:** 让顾客选座、预约确认、预约详情和模拟支付形成完整可导航旅程，并在刷新缺少未提交选择时安全回退而不伪造草稿。

**Blocked by:** 04 — 顾客入口、门店、行程与会员路由.

**Triage:** ready-for-agent

**State:** open

- [ ] 顾客从预约入口进入 `/customer/reservations/new/seats` 和 `/customer/reservations/new/confirm` 时，每一步都改变 URL 并保留现有业务校验。
- [ ] 直接打开或刷新确认步骤但缺少选座、时段或体验券内存状态时，以历史替换回最近可继续步骤，并说明未提交选择未被保留。
- [ ] 创建预约成功后进入 `/customer/reservations/:reservationId`，以一次性反馈说明创建结果，不产生 `/created` 或 `/success` 别名。
- [ ] 预约详情直达和刷新会从服务端读取当前预约状态、价格快照、体验券、模拟退款和业务事件。
- [ ] 待确认预约的模拟支付页面使用 `/customer/reservations/:reservationId/payment`；不合法状态显示安全恢复结果而不提供非法动作。
- [ ] 预约 ID 来自 URL 但对象读取和命令仍按当前顾客、沙箱和服务端角色上下文重新授权。
- [ ] 预约创建草稿、取消原因和体验券选择不写入 URL 或浏览器持久存储。
- [ ] Chromium E2E 覆盖创建步骤、刷新回退、成功详情、直接详情、支付路径、浏览器历史和对象越权边界。

## Comments
