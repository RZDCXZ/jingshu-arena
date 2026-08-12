# 02 — 正式原型 History 路由 tracer

**What to build:** 为正式管理端原型建立集中式 History 路由，使店员工作台和一个稳定 Tab 可以通过 URL 直达、刷新和浏览器历史恢复，同时保持 Sites 托管与既有视觉 QA 入口可用。

**Blocked by:** None — can start immediately.

**Triage:** ready-for-agent

**State:** open

- [ ] 原型使用单一集中式路由入口解析当前路径，并封装页面导航、历史替换和 `popstate` 恢复；页面组件不各自直接操作 History。
- [ ] 店员工作台和至少一个稳定业务 Tab 拥有与产品契约一致的规范路径，并能通过真实链接切换。
- [ ] 直接打开、刷新、后退和前进会恢复相同的角色、页面和 Tab，不回到固定店员默认内存状态。
- [ ] 浏览器标题、页面主标题和当前导航状态与原型 URL 保持一致。
- [ ] 既有原型专用 QA 查询参数仍可固定对应设计状态，且不会被当作生产业务或权限参数。
- [ ] Sites fallback 继续允许 HTML `GET/HEAD` 深链刷新，同时缺失资源、非 HTML 请求和写请求仍返回原始 404。
- [ ] 原型生产构建、路由测试和 Sites 包装测试通过。

## Comments
