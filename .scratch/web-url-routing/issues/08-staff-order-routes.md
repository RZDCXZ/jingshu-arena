# 08 — 店员商品订单队列与详情路由

**What to build:** 让店员商品订单的五个履约阶段和唯一订单详情拥有规范 URL，使队列、搜索、详情及状态推进可以刷新和使用浏览器历史恢复。

**Blocked by:** 03 — 服务端角色上下文与深链守卫.

**Triage:** ready-for-agent

**State:** open

- [ ] `/staff/orders` 以历史替换进入 `/staff/orders/all`。
- [ ] `all`、`simulated-paid`、`preparing`、`ready-for-pickup` 和 `exception` 五个阶段使用真实 Tab 链接并恢复对应服务端队列。
- [ ] 订单搜索在输入法组合结束和短防抖后替换查询参数，不为逐字输入新增历史项。
- [ ] 选择订单进入唯一 `/staff/orders/:orderId`；对象从待制作推进到制作中或待取时详情 URL 不改变。
- [ ] 从列表打开详情后浏览器后退恢复原阶段、搜索和滚动；直接详情返回默认 `all` 队列。
- [ ] 开始制作、标记待取、完成和带原因取消仍使用现有命令按钮、幂等重试及服务端授权。
- [ ] 页面、Tab 和详情焦点、标题、`aria-current` 以及加载期间不闪现旧订单均可观察且正确。
- [ ] Chromium E2E 覆盖五个阶段、搜索、详情刷新、状态推进、后退/前进和跨店/不存在对象安全边界。

## Comments
