# Web 四角色 URL 导航与深链重构

Status: ready-for-agent

## Problem Statement

当前 `apps/web` 虽然包含顾客、店员、店长和总部运营四个完整产品表面，但所有页面都由根地址 `/` 内的 React 内存状态切换。访客切换一级页面、稳定 Tab、筛选或对象详情时，地址栏始终不变；刷新会回到当前角色默认首页，浏览器前进和后退不能恢复业务位置，也无法复制或在新标签打开当前页面。

这让管理系统表现为一张承载所有内容的巨型页面，而不是具有清晰信息架构的多角色 Web 应用。深链无法分享，页面身份无法通过浏览器标题和无障碍导航表达，列表筛选与详情也无法从 URL 恢复。正式设计参考同样依赖内存状态，因此现有 QA 只证明页面可操作，尚未证明 URL、刷新、历史和深链行为。

重构必须保持服务端签发的角色上下文、门店范围、沙箱隔离和对象级授权不变。URL 只能表达目标产品表面和可恢复视图，不能成为角色、门店、沙箱或对象权限来源。

## Solution

把生产 Web 重构为真实的 Next.js App Router 嵌套路由：`/` 继续作为公开入口与会话恢复门，顾客、店员、店长和总部运营分别使用 `/customer/*`、`/staff/*`、`/manager/*` 和 `/hq/*`。一级页面、稳定业务 Tab 和可独立恢复的对象详情使用路径段；搜索、排序和已应用筛选使用白名单查询参数。

URL 成为导航状态的唯一真相。页面、Tab 和详情导航新增浏览历史，筛选和搜索替换当前历史。真实链接支持复制、键盘激活、Cmd/Ctrl 点击和新标签打开。共享角色布局在同角色导航期间持续挂载，业务工作区根据目标 URL 读取服务端权威数据，不在新 URL 下短暂显示旧页面、旧角色或旧对象内容。

无会话静态深链保持原目标 URL，先呈现不读取目标数据的沙箱与角色入口；角色不匹配必须经访客明确确认和既有服务端角色切换流程。无效路径、无权对象和缺少提交前内存状态都有安全、可恢复的界面。

正式管理端设计参考同步其现有管理表面和顾客交接表面的 URL 行为，使用集中式轻量 History 路由模块，并继续兼容现有 Sites SPA fallback 和原型专用 QA 参数。完整顾客 H5 仍由生产 Web 和既有小程序正式设计源承担。

## User Stories

1. As a 首次访客, I want `/` to remain the public product entry, so that I can understand the fictional demo boundaries before creating a sandbox.
2. As a returning visitor with a valid role context, I want `/` to replace itself with my current role home, so that the active application no longer remains at a meaningless root URL.
3. As a 顾客, I want my pages to live under `/customer/*`, so that the browser clearly identifies the customer product surface.
4. As a 店员, I want my pages to live under `/staff/*`, so that workbench and operational pages have stable addresses.
5. As a 店长, I want my pages to live under `/manager/*`, so that management and configuration workspaces are distinguishable from store-staff operations.
6. As a 总部运营, I want my pages to live under `/hq/*`, so that chain-wide comparison and configuration have a clear namespace.
7. As a visitor, I want role roots to redirect to explicit home paths, so that each rendered page has one canonical URL.
8. As a visitor, I want parent paths with default tabs to redirect to the explicit default-tab path, so that one view never has two canonical addresses.
9. As a visitor, I want static path segments to use lowercase English kebab-case without trailing slashes, so that copied links are stable and predictable.
10. As a visitor, I want equivalent noncanonical paths and query ordering to be replaced with one canonical form, so that bookmarks, caches and diagnostics see one page identity.
11. As a visitor without a role context, I want a static deep link to preserve its target while showing the safe sandbox/role gate, so that I can create my own sandbox and continue to the intended page.
12. As a visitor opening another visitor's object link, I want the application to avoid sharing their object or writable sandbox, so that demo isolation remains honest.
13. As a visitor whose current role differs from the path prefix, I want a blocking role-mismatch state, so that target-role data is not fetched before I explicitly switch.
14. As a visitor confirming a role-mismatch switch, I want the existing server-issued role-switch flow to run before entering the target path, so that URL text never grants permission.
15. As a visitor cancelling a role-mismatch switch, I want to return to the server's current role home with history replacement, so that I do not remain in a mismatch loop.
16. As a visitor whose role changed in another tab, I want recovery to replace the current path with the server's current role home, so that the stale tab does not invite me to undo the authoritative role change.
17. As a visitor whose role-switch response was lost, I want recovery to enter the server's confirmed role home, so that the UI does not guess that the target deep link was authorized.
18. As a 顾客, I want `/customer/reservations` to be the canonical reservation entry, so that booking conditions are recoverable.
19. As a 顾客, I want the stores bottom-navigation item to use `/customer/stores`, so that switching that stable navigation item changes the URL.
20. As a 顾客, I want seat selection and reservation confirmation to use separate creation-step paths, so that moving between pages is visible in the browser.
21. As a 顾客, I want a refreshed creation step without prerequisite in-memory choices to return to the nearest valid step with an explanation, so that the application does not invent a seat, coupon or form draft.
22. As a 顾客, I want each reservation to have one `/customer/reservations/:reservationId` detail URL, so that its status and immutable history are directly addressable.
23. As a 顾客, I want the reservation simulated-payment page to use a child route, so that payment confirmation is distinct from the reservation detail.
24. As a 顾客, I want current, future and historical journeys to have explicit path segments, so that journey tabs survive refresh and browser history.
25. As a 顾客, I want “我的预约、我的订单、我的报修” to share the unified journey route with an applied `type` filter, so that one list state does not have duplicate page paths.
26. As a 顾客, I want coupon states to use explicit membership child paths, so that available, reserved, redeemed and expired tabs are directly recoverable.
27. As a 顾客, I want order catalog and confirmation steps to be nested under the originating reservation, so that the order's store and seat context is clear without treating the URL as authority.
28. As a 顾客, I want each order to have one `/customer/orders/:orderId` URL and a child payment route, so that order status changes do not change its identity.
29. As a 顾客, I want repair creation to be nested under the reservation and the resulting repair to use `/customer/repairs/:repairId`, so that creation context and resulting object identity remain distinct.
30. As a 店员, I want workbench and reservation-list URLs to be distinct, so that switching the side navigation changes browser history.
31. As a 店员, I want a reservation detail to use one resource URL, so that selecting an object in the right inspector creates a shareable, refreshable page identity.
32. As a 店员, I want order-stage tabs to use `all`, `simulated-paid`, `preparing`, `ready-for-pickup` and `exception` path segments, so that queue stages survive refresh.
33. As a 店员, I want an order detail URL independent of its queue stage, so that the object's canonical address does not change when fulfillment advances.
34. As a 店员, I want repairs, repair details and inventory to have stable URLs, so that operational pages can be reopened directly.
35. As a 店员, I want attendance and handover to use explicit shift child paths, so that switching the stable Tab changes the URL.
36. As a 店长, I want dashboard and live-operations workspaces to have explicit routes, so that the management hierarchy is visible in the browser.
37. As a 店长, I want live-operations workbench and reservation tabs to have explicit child paths, so that their state survives refresh.
38. As a 店长, I want repair details, inventory, store configuration and people workspaces to have stable paths, so that authorized tasks can be deep-linked.
39. As a 店长, I want profile, seats, pricing and products configuration Tabs to use explicit paths, so that no default Tab is hidden in component state.
40. As a 店长, I want employees, schedule and attendance Tabs to use explicit paths, so that the current people workspace is visible and recoverable.
41. As a 店长, I want audit list and audit-event details to use stable paths, so that an authorized audit fact can be reopened without retaining local selection state.
42. As a 总部运营, I want chain dashboard and comparison pages to have separate URLs, so that the two responsibilities are distinguishable.
43. As a 总部运营, I want product and machine catalogs to use explicit child paths, so that catalog Tabs survive refresh.
44. As a 总部运营, I want fixed-store configuration paths to contain a stable store business code and configuration Tab, so that the selected store and workspace are directly visible.
45. As a 总部运营, I want people, audit and audit-event pages to have stable URLs, so that chain-wide read-only work can be reopened directly.
46. As a list user, I want applied status, date, area, machine, inventory, metric and audit filters in the query string, so that copying the URL restores the same visible result set.
47. As a list user, I want default filter values omitted, so that canonical links stay concise.
48. As a list user, I want unknown or invalid query values removed with a safe notice, so that malformed links recover without exposing internal details.
49. As a list user, I want immediate filters and debounced searches to replace the current history item, so that browser Back does not replay every input change.
50. As a list user, I want complex filter drafts to enter the URL only after I apply them, so that the address always describes the current rendered results.
51. As a visitor, I want page, Tab and detail navigation to push browser history, so that Back and Forward move between meaningful locations.
52. As a visitor returning from a detail, I want browser history to restore the previous list and its scroll position where possible, so that I can continue my work.
53. As a visitor opening a detail directly, I want its return action to use the resource's default list Tab, so that the page has a deterministic recovery path.
54. As a visitor, I want transient dialogs, toasts, loading phases, ordinary expansion, sidebar collapse and scroll offsets excluded from the URL, so that the address represents durable product location rather than temporary UI.
55. As a visitor with an unsubmitted form, I want in-app navigation and browser Back to confirm before discarding it, so that I do not lose work accidentally.
56. As a visitor with an unsubmitted form, I want hard reload and tab closing to use the browser's native unload warning, so that destructive navigation remains guarded without persisting private free text.
57. As a visitor, I want semantic links for page navigation and buttons for business commands, so that copy link, open in new tab and assistive-technology behavior match web conventions.
58. As a keyboard user, I want new pages and Tabs to focus their main heading and details to focus their detail heading, so that route changes are perceivable without a pointer.
59. As a screen-reader user, I want browser title, page heading and `aria-current` to describe the same route, so that the current location is unambiguous.
60. As a visitor, I want the shared role shell and correct target navigation to remain visible during route loading, so that I understand where navigation is going.
61. As a visitor, I want old page, role or object data hidden once the URL changes, so that stale information is never attributed to the target route.
62. As a visitor encountering a failed page read, I want to remain at the target URL with a safe error and retry action, so that the application does not lie about navigation success.
63. As a visitor opening an invalid page or Tab, I want a role-scoped not-found state with a link to the current role home, so that broken links are visible instead of silently redirected.
64. As a visitor opening a missing or unauthorized object, I want the same “不存在或不可访问” boundary, so that object existence is not leaked.
65. As a multi-tab visitor, I want role context, realtime invalidation and stale-tab blocking to remain server-authoritative after routing is added, so that URLs cannot bypass the existing security model.
66. As a visitor navigating within one role, I want the shared role layout, business clock, realtime connection, demo story and tools to stay mounted, so that navigation does not recreate shared session behavior.
67. As a visitor, I want the previous business workspace unmounted rather than hidden, so that invisible pages do not continue fetching or submitting data.
68. As a search-engine visitor, I want the public entry to be discoverable while role business pages are `noindex, nofollow`, so that synthetic sandbox data and object routes do not appear in search results.
69. As a product reviewer, I want the formal management prototype to exhibit the same route, history and stable-Tab semantics for its existing surfaces, so that the long-lived design reference remains truthful.
70. As a QA reviewer, I want existing prototype-only state parameters to remain usable but excluded from production behavior, so that historical visual evidence remains reproducible without becoming a security or product contract.
71. As a maintainer, I want one canonical path manifest and controlled navigation interfaces, so that local component state cannot drift from the address bar.
72. As a maintainer, I want the entire new routing model delivered atomically after validation, so that old root-state navigation and new URL navigation never coexist in production.

## Implementation Decisions

- The approved product contract is Web management-system contract version 1.20. It is the source of truth for route hierarchy, history behavior, security boundaries and UI recovery states.
- Production uses real Next.js App Router nested routes and shared role layouts. Route entry components stay thin and reuse the existing business surfaces; a catch-all client parser or root-page History simulation is not accepted.
- The public root remains `/`. Role roots replace to `/customer/reservations`, `/staff/workbench`, `/manager/dashboard` and `/hq/dashboard`.
- The canonical customer routes cover reservation entry, stores, reservation creation steps, reservation details and payment, journey Tabs, coupon Tabs, order creation/details/payment and repair creation/details.
- The canonical staff routes cover workbench, reservation list/details, all five order-stage list Tabs, order details, repair list/details, inventory and attendance/handover Tabs.
- The canonical manager routes cover dashboard, live-operations workbench/reservations and reservation details, repair list/details, inventory, four configuration Tabs, three people Tabs, audit list and audit-event details.
- The canonical headquarters routes cover dashboard, comparison, product/machine catalogs, fixed-store configuration by stable store business code and four configuration Tabs, people, audit and audit-event details.
- A centralized pure route contract defines canonical parsing, generation, defaults, query white lists, normalization and page metadata. URL-derived page, stable Tab and selected-object state is passed to business components as controlled input; duplicate local `activePage`, stable-Tab and selected-object navigation state is removed.
- Static path segments are lowercase English kebab-case with no trailing slash. Recognizable noncanonical forms and query ordering are corrected with history replacement.
- Page, Tab and object-detail navigation uses history push. Immediate filters, debounced searches, sorting and explicitly applied complex filters use history replace. Default query values are omitted.
- Approved query names are: `q`, `sort`, `direction`, `range`, `from`, `to`, `status`, `time`, `anomaly`, `area`, `machine`, `type`, `refunds`, `kind`, `alert`, `metric`, `store`, `persona`, `role`, `action`, `object` and `result`. Values reuse existing domain/API enum slugs.
- Stable list Tabs and object details are separate canonical routes. Object identity never includes a mutable queue stage. Direct details return to the resource's default list; in-app details rely on browser history to restore the originating list.
- Pre-submit customer journey pages get distinct paths, but cart, coupon, seat and free-text drafts stay in memory. Missing prerequisites cause an explanatory replace to the nearest valid step.
- Creation success enters the object's canonical detail and uses a transient success message; `/created` and `/success` aliases are not created.
- URL prefixes and route parameters never provide authorization. Server-issued role context, store scope, sandbox isolation and object-level checks remain authoritative. There are no API, database schema or domain-state-machine changes in this feature.
- A valid deep link without role context renders a safe gate at the target URL and does not fetch target data. Creating the matching role's independent sandbox continues to a static target page; object IDs from another sandbox remain inaccessible.
- Role mismatch uses an explicit confirmation and the existing server role-switch command. Cancellation and cross-tab authoritative role changes replace to the server's current role home. Unknown switch outcomes recover only to the server-confirmed role home.
- Same-role routes share a persistent role layout containing context, lifecycle, realtime invalidation, demo story and tools. Only the business workspace changes. Previous workspaces are unmounted rather than hidden.
- Navigation surfaces use semantic links; state-changing business commands remain buttons. Route changes synchronize browser title, page heading and `aria-current`.
- New pages/Tabs move workspace scroll to the top and focus the main heading; details focus the detail heading. Browser history may restore prior list scroll without serializing it into the URL.
- In-app navigation uses a unified dirty-state blocker. Hard reload and tab closing use native `beforeunload`. Form drafts are not written to the URL or browser persistence.
- Route loading keeps the shared shell and target navigation visible while rendering a target-specific skeleton. Previous page, role or object data is cleared before the new URL is presented as loaded.
- Invalid pages/Tabs use a role-scoped not-found surface. Missing and unauthorized objects share the same safe “不存在或不可访问” appearance.
- Only `/` is indexable. All four role namespaces emit `noindex, nofollow` metadata.
- The implementation can be developed incrementally, but it is delivered as one routing model after all gates pass. Only `/` is a legacy-compatible address; no business aliases, fuzzy matching or runtime feature flag preserve the old root-state model.
- The formal design prototype adds one centralized lightweight History router rather than a new routing framework. Its existing management pages, stable Tabs, details and customer handoff follow the approved route semantics.
- The design prototype keeps its existing QA-only query parameters on a prototype-specific allow list. They are excluded from production URL parsing and never become business or permission inputs.
- The formal prototype Sites fallback remains limited to HTML `GET/HEAD` navigation; missing assets, API-like requests and writes do not receive the application shell.
- The visual direction, page responsibilities, layout and responsive behavior remain unchanged. New role-mismatch, not-found, inaccessible-object, pre-submit recovery and loading states reuse the existing night-operations visual system.

## Testing Decisions

- A good test asserts externally observable URL, rendered page identity, authorized data boundary, browser history, focus, scroll or recovery behavior. Tests must not assert internal hook names, component state variables or the number of route files.
- The highest and primary test seam is the centralized canonical route contract. Table-driven tests exhaust every approved static page, stable Tab, dynamic-detail shape, parent/default replacement, query white list and canonicalization rule through parse/generate round trips.
- The production browser seam uses the existing real Web → Hono → temporary PostgreSQL path. It verifies every primary navigation entry and stable Tab, then uses representative real objects for reservation, order, repair and audit-event details.
- Browser tests cover direct deep links, hard refresh, Cmd/Ctrl-compatible link semantics where automatable, Back, Forward, list-to-detail-to-list scroll recovery, default return links and canonical replacements.
- Browser tests cover no-session static deep links, matching-role creation, different-role choice, role-mismatch confirm/cancel, cross-tab role changes, unknown switch recovery, invalid routes and missing/unauthorized objects.
- Browser tests cover filter restoration, default omission, invalid-value cleanup, deterministic parameter order, immediate filters, IME-safe debounced search and apply-only complex filters.
- Browser tests cover in-app dirty-state cancellation, accepted discard, browser Back blocking and native hard-reload/close registration at the highest observable seam available to Playwright.
- Browser tests assert title, main heading, `aria-current`, focus transfer, workspace scroll reset, history scroll restoration and absence of old-page data after URL change.
- Browser tests assert that role contexts, realtime invalidation, demo story and sandbox tools remain available across same-role navigation while old business workspaces stop requesting data.
- Metadata tests assert that `/` is indexable and all role paths are `noindex, nofollow`.
- Formal prototype tests cover its centralized route parser/generator, `pushState`, `replaceState`, `popstate`, controlled stable Tabs, title/current-navigation synchronization and compatibility with prototype-only QA parameters.
- Existing Sites Worker tests remain prior art for direct refresh fallback and must continue proving that missing assets, non-HTML requests and writes are not converted to the application shell.
- Existing role-context-shell, customer journey and demo-story browser suites are prior art for real role switching, multi-tab invalidation, customer details and the full cross-role story. They should be extended at those existing seams rather than replaced by lower-level component tests.
- Existing visual QA is rerun at `1440 × 1024` and `1024 × 768` for management pages and `360 × 800` for critical customer paths. Evidence checks console errors, focus, horizontal overflow, route loading and stale-data flashes.
- The full repository verification command, production builds, formal prototype build and Sites packaging tests must pass before the routing change is delivered.
- Design QA remains stale until the 1.20 route implementation and all required evidence are complete; only then may it be marked current for contract 1.20.

## Out of Scope

- Redesigning the side navigation, Tab appearance, page hierarchy, night-operations visual direction or responsive layout.
- Changing reservation, order, repair, inventory, attendance, handover, audit or sandbox domain rules.
- Changing API endpoints, request/response contracts, database schema, RLS, role capabilities or object authorization.
- Treating URL role prefixes, store codes, IDs or query parameters as permission sources.
- Sharing writable sandboxes or business objects by copying a URL.
- Persisting carts, coupons, seat selections, configuration drafts or free-text drafts in the URL or browser storage.
- Encoding dialogs, toasts, loading phases, ordinary expansion, sidebar collapse or scroll offsets in the URL.
- Adding URL aliases for business pages, fuzzy route matching, a long-lived migration flag or simultaneous old/new navigation modes.
- Rebuilding the complete customer H5 inside the formal management prototype.
- Introducing a new visual direction or performing unrelated component refactors.
- Adding a new domain glossary term or ADR solely for routing; the work implements the existing single multi-role Web application and server-issued role-context decisions.

## Further Notes

- Relevant accepted decisions include ADR-0010 for server-issued public role context, ADR-0014 for one multi-role Web application with different route groups, and ADR-0018 for sandbox isolation plus application-level role/store authorization.
- The product contract has already been updated to version 1.20 with the canonical route tree, history rules, security boundary, query vocabulary and UI recovery behavior.
- The formal design coverage records this routing change as approved but pending implementation and QA. Existing 1.19 visual evidence is retained as the historical visual baseline rather than presented as proof of 1.20 routing behavior.
- The agreed test seams were confirmed during design: exhaustive route-contract tests provide the narrow canonical seam; Chromium E2E and formal visual QA validate behavior that only exists across browser, session, API and layout boundaries.
- Delivery is complete only when production and the scoped formal prototype build and run, all affected paths and interactions pass at required viewports, affected product/design documents are current, and no P0/P1/P2 route or interaction gap remains.
