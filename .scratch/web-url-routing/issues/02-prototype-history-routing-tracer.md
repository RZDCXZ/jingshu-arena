# 02 — 正式原型 History 路由 tracer

**What to build:** 为正式管理端原型建立集中式 History 路由，使店员工作台和一个稳定 Tab 可以通过 URL 直达、刷新和浏览器历史恢复，同时保持 Sites 托管与既有视觉 QA 入口可用。

**Blocked by:** None — can start immediately.

**Triage:** ready-for-agent

**State:** resolved

- [x] 原型使用单一集中式路由入口解析当前路径，并封装页面导航、历史替换和 `popstate` 恢复；页面组件不各自直接操作 History。
- [x] 店员工作台和至少一个稳定业务 Tab 拥有与产品契约一致的规范路径，并能通过真实链接切换。
- [x] 直接打开、刷新、后退和前进会恢复相同的角色、页面和 Tab，不回到固定店员默认内存状态。
- [x] 浏览器标题、页面主标题和当前导航状态与原型 URL 保持一致。
- [x] 既有原型专用 QA 查询参数仍可固定对应设计状态，且不会被当作生产业务或权限参数。
- [x] Sites fallback 继续允许 HTML `GET/HEAD` 深链刷新，同时缺失资源、非 HTML 请求和写请求仍返回原始 404。
- [x] 原型生产构建、路由测试和 Sites 包装测试通过。

## Comments

### 2026-08-12 — 完成说明与验证证据

- 新增正式原型集中式纯路由契约和 React History 适配层，统一解析/生成 `/staff/workbench`、`/staff/orders/all`，封装普通导航 `pushState`、父路径规范化 `replaceState`、`popstate` 恢复与浏览器标题更新。直接打开或刷新从 URL 首次渲染正确角色、页面与默认订单 Tab，不依赖固定店员内存首页。
- 店员侧栏的工作台、商品订单和订单“全部订单”Tab 改为带真实 `href` 的语义化链接；URL 同步浏览器标题、规范 `h1`、侧栏 `aria-current` 与 Tab `aria-selected`。工作台原“现场脉冲”保留为眉题，主标题按契约统一为“工作台”。
- 集中式 QA 白名单保留 9 个既有原型参数并传为受控页面输入；导航移除 `role`、`storeCode`、`permission` 等非 QA 参数，URL 不作为角色、门店、生产业务或权限来源。没有改变 API、数据库、授权、领域术语、业务规则、状态机或既有 ADR。
- Sites Worker 只为缺失的 HTML `GET/HEAD` 页面导航返回应用壳；店员 tracer 深链刷新可用，已有资源直接返回，缺失资源、`/api/*`、非 HTML 和写请求保持原始 `404`。
- 真相源更新：`product-ui/management-system/design-prototype/design-coverage.md` 记录本票 tracer 覆盖；`design-qa.md` 记录局部 `passed` 的自动化、双视口和四张实现证据，并明确完整 `prod.md` 1.20 QA 继续保持 `stale`，其余正式原型页面仍属于 Ticket 16。
- `npm run test:routes`：通过，5 项纯路由测试覆盖规范元数据、父路径替换、QA 白名单、链接修饰键和 `pushState` / `replaceState` / `popstate`。
- `npm run test:routes:browser`：通过，Chromium 3 项；精确 `1440 × 1024` 与 `1024 × 768` 覆盖直接打开、真实链接、刷新、后退、前进、标题/主标题/当前导航同步、无横向溢出及控制台 warning/error 为 0；另覆盖父路径替换和只读 QA 状态兼容。
- `npm run build`：通过，Vite 生产构建并生成 Sites 所需 `dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json`。
- `npm run test:sites`：通过，5 项测试覆盖资源直出、HTML `GET/HEAD` tracer 深链回退，以及缺失资源、API、非 HTML 与写请求原始 `404`。
- `pnpm exec prettier --check <本票文本与源码文件>` 与 `git diff --check`：通过。
