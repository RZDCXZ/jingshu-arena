# 06 — 顾客商品订单与报修路由

**What to build:** 让顾客从预约详情进入商品订单和报修的创建、确认、支付与详情路径，并确保每个已创建对象只有一个规范地址且不会跨沙箱分享。

**Blocked by:** 05 — 顾客预约创建、详情与模拟支付路由.

**Triage:** ready-for-agent

**State:** open

- [ ] 商品目录和确认分别使用 `/customer/reservations/:reservationId/orders/new` 与其 `/confirm` 子路径，并继续绑定服务端确认的预约、门店和座位。
- [ ] 刷新商品确认但缺少购物车或体验券草稿时，安全回到商品目录并说明未提交购物车未被保留。
- [ ] 商品订单创建成功进入 `/customer/orders/:orderId`；模拟支付使用其 `/payment` 子路径，订单状态推进不改变详情 URL。
- [ ] 报修创建使用 `/customer/reservations/:reservationId/repairs/new`，创建成功进入 `/customer/repairs/:repairId`。
- [ ] 订单和报修详情直达、刷新、返回以及关联预约跳转均使用真实链接和服务端权威读取。
- [ ] 另一访客或新沙箱打开原对象 URL 时显示“对象不存在或不可访问”，不共享对象、图片或可写沙箱。
- [ ] 购物车、商品体验券、报修描述和待上传图片不写入 URL 或浏览器持久存储。
- [ ] `360 × 800` Chromium E2E 覆盖目录、确认回退、订单详情/支付、报修创建/详情、历史和安全对象边界。

## Comments
