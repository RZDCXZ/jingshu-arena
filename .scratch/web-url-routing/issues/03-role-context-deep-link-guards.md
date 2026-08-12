# 03 — 服务端角色上下文与深链守卫

**What to build:** 让所有规范深链在无会话、角色不匹配、跨标签角色变化和切换结果未知时遵守服务端签发的角色上下文，并提供明确、安全、可恢复的用户路径。

**Blocked by:** 01 — 生产路由基础与店员工作台 tracer.

**Triage:** ready-for-agent

**State:** resolved

- [x] 无有效角色上下文直接访问合法静态业务深链时保持目标 URL，显示不读取目标数据的沙箱与角色入口。
- [x] 从深链创建匹配角色的独立沙箱后进入目标静态页面；选择其他角色则进入所选角色首页。
- [x] 当前服务端角色与路径角色不一致时显示不可绕过的角色不匹配状态，且目标角色业务 API 在确认前不会被调用。
- [x] 确认切换通过现有服务端角色切换流程后进入原目标路径；取消时以历史替换进入服务端当前角色首页。
- [x] 其他标签改变角色后，当前标签恢复到服务端当前角色首页，不提示再次切回旧角色，也不猜测跨角色对应页面。
- [x] 切换响应结果未知时，只进入恢复后服务端确认角色的首页；较晚到达的旧响应不能覆盖恢复结果。
- [x] 合法角色前缀下的未知页面或 Tab 显示角色作用域内的安全未找到状态，并提供返回当前角色首页的链接。
- [x] 缺失对象和无权对象使用相同“对象不存在或不可访问”外观，不泄露对象是否存在。
- [x] 浏览器 E2E 覆盖无会话深链、匹配/不同角色选择、角色不匹配确认/取消、跨标签变化、未知切换结果和安全 404。

## Comments

### 2026-08-12 — 完成说明与验证证据

- 用四角色共享 `RoleRouteLayout` 替换店员专用守卫，并新增 `/customer/*`、`/staff/*`、`/manager/*`、`/hq/*` 的真实 Next.js App Router 命名空间、角色首页与分阶段 catch-all。合法静态深链先确认服务端上下文再挂载业务工作区；无会话保持原 URL 并复用公开角色入口，匹配角色创建后保留原目标，其他角色以历史替换进入规范首页。catch-all 只承担后续显式页面迁移前的安全守卫与角色作用域 404，最终收束仍由 Ticket 17 负责。
- 角色不匹配状态明确显示服务端当前角色、路径目标角色和“URL 不授予权限”边界。确认复用现有 CSRF 角色切换并进入原静态目标；取消使用 `router.replace` 回当前角色首页。自动化监听目标角色 `/api/v1/staff/*`，确认匹配角色选择或显式切换之前为 `0` 次请求。
- mismatch 守卫独立订阅角色上下文广播；其他标签切换、stale 与未知响应统一 POST 服务端 context refresh 并进入恢复角色首页。未知模式携带旧页面上下文版本与 CSRF；现有 PostgreSQL 并发围栏保证已排队恢复和已在途切换按服务端锁序得到唯一最终上下文，较晚旧响应不能覆盖恢复。
- 合法角色前缀下未知页面保留当前角色共享壳并提供真实首页链接；动态对象详情在页面专属票接线前进入统一“对象不存在或不可访问”边界，缺失/无权外观完全一致且不调用对象详情 API。角色路径统一输出 `noindex, nofollow`；根页已有上下文一律替换到服务端角色首页，不再保留旧根页内存导航。
- 真相源更新：`product-ui/management-system/design-prototype/design-coverage.md` 记录本票页面/旅程覆盖；`design-qa.md` 记录局部 `passed`、双视口、无溢出和控制台证据，并明确完整 `prod.md` 1.20 QA 继续保持 `stale`。视觉证据为 `design/evidence/web-url-routing-ticket-03/role-mismatch-1440x1024.png`、`scoped-not-found-1024x768.png`、`object-unavailable-1024x768.png`。
- 领域与架构复核：继续使用 `CONTEXT.md` 的“角色上下文、沙箱、沙箱失效通知”等规范术语；遵守 ADR-0010、0011、0014、0015、0018、0020、0021、0022。URL 不声明角色、门店、沙箱或对象权限；服务端继续执行应用级授权和沙箱隔离，没有更改数据库模式、领域状态机或已接受 ADR。
- `pnpm format:check`、`pnpm lint`（含工作区检查）、`pnpm typecheck` 与 `git diff --check`：全部通过。
- `pnpm exec vitest run --config vitest.unit.config.ts apps/web/app/web-route-contract.test.ts`：通过，1 个文件 / 9 项；覆盖完整路由清单、页面/详情 kind、规范生成解析与元数据。
- `pnpm exec node packages/database/scripts/run-integration.mjs apps/api/src/role-context.integration.test.ts`：通过，1 个文件 / 13 项真实 PostgreSQL API 集成测试，含未知切换结果的双向并发锁序和晚到响应围栏。
- `pnpm exec playwright test tests/e2e/public-entry.spec.ts tests/e2e/role-context-shell.spec.ts --workers=1`：通过，Chromium 68 项；包括新增无会话深链、匹配/其他角色创建、角色不匹配确认/取消、跨标签恢复、未知结果回首页、安全 404、对象不可见，以及既有公开入口、共享壳、SSE/轮询、业务时间、重置、只读和响应式完整回归。
- `pnpm --filter @jingshu/web build`：通过；Next.js 16.3.0 生产构建列出四个角色根路径、四个角色 `[...segments]` 动态边界和显式 `/staff/workbench`，所有页面数据和 TypeScript 阶段通过。
