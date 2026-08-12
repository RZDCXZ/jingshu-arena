# 04 — 顾客入口、门店、行程与会员路由

**What to build:** 让顾客预约入口、门店、统一行程和会员体验券页面拥有稳定 URL，使顾客切换底部导航和业务 Tab 时可以刷新、复制及使用浏览器历史恢复当前位置。

**Blocked by:** 03 — 服务端角色上下文与深链守卫.

**Triage:** ready-for-agent

**State:** open

- [ ] `/customer` 以历史替换进入 `/customer/reservations`，预约入口和 `/customer/stores` 使用真实导航链接。
- [ ] `/customer/journeys/current`、`future` 和 `history` 分别恢复统一行程的当前、未来和历史 Tab。
- [ ] “我的预约、我的订单、我的报修”使用统一行程路径；`type=order|repair` 只作为已应用筛选，不创建重复列表地址。
- [ ] 历史行程的模拟退款筛选写入白名单查询参数，默认值省略，刷新和复制链接恢复同一结果。
- [ ] `/customer/membership/coupons/available|reserved|redeemed|expired` 恢复对应体验券 Tab，父路径替换到 `available`。
- [ ] 顾客导航使用语义化链接，页面标题、主标题、底部导航和 Tab 的当前状态与 URL 一致。
- [ ] 新页面/Tab 导航聚焦主标题并回到顾客工作区顶部；后退/前进恢复上一稳定页面。
- [ ] `360 × 800` 下上述导航无页面级横向溢出，固定导航不遮挡内容，控制台无新增错误。

## Comments
