# 竞枢管理端设计 QA

- 状态：`current`（当前有效）
- 检查日期：2026-08-09
- 已验证契约版本：`product-ui/management-system/prod.md` 1.2
- 验证范围：[`04 — 服务端角色上下文与共享演示壳`](../../../.scratch/jingshu-basic-rc/issues/04-role-context-shell.md)

## 对照目标

- 选定视觉源：`design/reference/selected-night-operations-console.png`。
- 正式原型源截图：`design/source-ticket04-role-shell-1440.png`、`design/source-ticket04-role-shell-1024.png`、`design/source-ticket04-role-switcher-1440.png`、`design/source-ticket04-dirty-confirmation-1440.png`、`design/source-ticket04-stale-tab-1440.png`。
- 生产实现截图：`design/implementation-ticket04-role-shell-1440-final.png`、`design/implementation-ticket04-role-shell-1024-final.png`、`design/implementation-ticket04-role-switcher-1440.png`、`design/implementation-ticket04-dirty-confirmation-1440.png`、`design/implementation-ticket04-stale-tab-1440.png`。
- 视口：Codex 应用内浏览器 `1440 × 1024 CSS px` 与 `1024 × 768 CSS px`。
- 密度：每组源图与实现均在 `devicePixelRatio = 1` 下采集，截图像素尺寸等于 CSS 视口。
- 状态：店员默认工作台、角色切换器、未提交队列筛选确认、跨标签旧角色阻断。

## 对比证据

- 默认桌面最终对比：`design/qa-ticket04-role-shell-comparison-1440-final.png`，左侧为正式原型，右侧为生产实现。
- 收起导航最终对比：`design/qa-ticket04-role-shell-comparison-1024-final.png`。
- 角色切换器最终对比：`design/qa-ticket04-role-switcher-comparison-1440.png`。
- 未提交输入确认最终对比：`design/qa-ticket04-dirty-confirmation-comparison-1440.png`。
- 旧标签阻断最终对比：`design/qa-ticket04-stale-tab-comparison-1440.png`。
- 第一轮历史对比：`design/qa-ticket04-role-shell-comparison-1440-iteration1.png`。

## Findings

- 没有仍需处理的 P0、P1 或 P2 差异。
- 客观检查：`1024px` 下源图与实现的 `document.body.scrollWidth` 均为 `1024px`，主操作不再裁切；角色切换器两侧宽度均为 `780px`，标题均为 `18px`；未提交确认两侧宽度均为 `560px`、标题均为 `18px`、按钮高度均为 `38px`；旧标签阻断两侧均为 `480px` 宽、约 `322px` 高，标题均为 `21px`。
- 契约要求的有意差异：生产壳底栏持续展示服务端角色上下文版本、范围和手动确认时间；SSE/轮询由 ticket 27 接入前不宣称实时。工作台业务数据明确标记为界面参考，主操作只打开任务并说明服务端办理到店由 ticket 09 接入；主演示证据进度由 ticket 29 接入。正式原型仍保留后续完整旅程的交互参考。

## 必查保真表面

- 字体与排版：生产实现复用 Noto Sans SC Variable；工作台标题、队列标签、角色卡、确认和阻断标题均与正式原型使用相同字号层级。
- 间距与布局节奏：`1440px` 保留连续队列与右侧对象检查器；`1024px` 固定 `72px` 图标导航，主队列和检查器同时可见，无横向溢出或主操作裁切。
- 颜色与视觉令牌：炭灰/海军蓝表面、青色数据反馈、青柠主操作及琥珀/红色异常分级均复用正式原型令牌。
- 图片质量与资源保真度：品牌标志使用正式 PNG；界面图标使用 Phosphor，没有占位资产、手写 SVG、文本符号或 CSS 图形替代。
- 文案与内容：演示数据、当前人物、业务角色、门店范围、生命周期、新鲜度、目标人物/范围、未提交输入后果和旧角色阻断原因均明确可见。
- 状态与交互：导航、队列筛选、队列选择、只读任务说明、检查器收起/恢复、角色切换、确认返回、跨标签刷新和手动上下文刷新均有真实行为；未接线业务不显示客户端伪成功。
- 响应式与无障碍：角色和状态不只靠颜色表达；弹窗焦点进入关闭按钮，脏表单确认焦点进入“返回继续编辑”，取消后回到原目标角色，`Escape` 关闭后回到触发器；`1024px` 固定收起时隐藏无效果的侧栏开关。正式原型与生产阻断层均隔离背景焦点、循环 Tab，并在恢复后回到刷新/角色触发器。
- reduced-motion：应用内浏览器通过 `prefers-reduced-motion: reduce` 验证命中；导航按钮的 `transition-duration` 与 `animation-duration` 均降为 `1e-05s`。

## 浏览器、API 与数据库验证

- 应用内浏览器控制台 `warning/error`：正式原型 0，生产实现 0；最终 1440/1024 复核未出现页面错误。
- 真实浏览器流程：通过同源 Web → Hono → 临时 Postgres 创建店员沙箱；无 URL 沙箱参数。真实角色切换后人物、角色、门店范围和 CSRF 同步轮换；创建幂等重放继续返回不可变的原创建角色/人物，已认证的同沙箱重放不覆盖当前会话，未认证恢复只签发数据库当前角色。
- 启动与到期恢复：启动检查遇 503/网络故障时保持不可写并只提供“重试确认”，不会误开新的沙箱入口；旧 Cookie 返回 `ROLE_CONTEXT_STALE` 时自动调用无页面版本依赖的 canonical recovery，并进入服务端当前角色。服务端明确返回 `ROLE_CONTEXT_REQUIRED` 或 `ROLE_CONTEXT_UNAVAILABLE` 时才回公开入口。活动壳层的 GET 手动刷新、角色切换和阻断恢复三条路径均覆盖自然到期闭环。
- 键盘与焦点：切换器初始焦点为“关闭角色切换”；`Escape` 后回到“切换角色”；未提交确认初始焦点为“返回继续编辑”，取消后回到“店长”目标卡。
- 跨标签与响应丢失：另一标签切换角色后，旧标签立即显示 `alertdialog`；切换已提交但响应/新 Cookie 未送达时也进入同一安全阻断。背景进入 `inert`，Tab/Shift+Tab 不能逃出阻断层，受 Origin 保护的恢复端点按沙箱读取服务端当前角色，恢复后焦点回到角色入口。已规范化的共享浏览器会话不重复轮换 Cookie/CSRF；真正推进版本的结果未知栅栏同时验证 Origin 与 CSRF。真实并发测试用显式行锁分别固定 recovery-first 与 switch-first 顺序，验证唯一最终可写版本及晚到旧切换的 `ROLE_CONTEXT_STALE`。
- 权限与隔离：真实 Postgres 覆盖无沙箱上下文默认不可读/不可写、跨沙箱不可读/不可写；真实 API + Postgres 权限接缝覆盖顾客本人对象、店员/店长单店允许与跨店拒绝、总部三店配置/审计允许、总部一线/库存/人员拒绝及跨沙箱拒绝。拒绝结果写入过滤后的 `audit_events`。
- 自动化：完整仓库门禁通过；包括 16 个单元测试、24 个真实 Postgres/API 集成断言组、2 个设计内容基线测试与 16 个 Chromium E2E 测试。迁移集成额外覆盖 FORCE RLS 存量回填、非 BYPASSRLS owner 与旧 writer 滚动兼容；API/Postgres 集成覆盖旧版 v1 会话升级、canonical refresh 不轮换 CSRF、带 Origin+CSRF 的结果未知版本栅栏及两种真实行锁顺序。浏览器覆盖启动瞬时故障禁写、丢失切换响应后重载的 canonical recovery 与活动壳层三条自然到期路径。生产 Web/API/数据库/契约/领域/小程序构建、敏感数据扫描和 high-level 依赖审计门禁均通过。
- 正式原型：`npm run build` 通过；`npm run test:sites` 4/4 通过；`dist/client/index.html`、`dist/server/index.js` 与 `dist/.openai/hosting.json` 存在。

## 对比历史

- 第 1 轮发现 P1：生产工作区只显示三条紧凑队列，缺少当前主操作、未来 30 分钟和等待回执，导致核心任务与源图信息密度明显不足。
- 修复：补回“现在 / 接下来 30 分钟 / 等待回执”、真实办理到店动作、可选择队列和联动检查器；第二轮 `1440px` 内容密度与正式原型对齐。
- 第 2 轮发现 P1：`1024px` 当前任务行超出主工作区，青柠“办理到店”被右侧检查器裁切。
- 修复：紧凑视口隐藏次要座位列并重排五列主任务，保留金额、主操作和右侧检查器；复核 `bodyScrollWidth = 1024px`，无裁切。
- 第 3 轮发现 P2：生产角色切换标题过大，未提交确认和旧标签阻断宽于正式原型。
- 修复：角色切换标题统一为 `18px`，未提交确认为 `560px`，阻断卡统一为 `480px / 21px`，组件尺寸与正式原型逐项相等。
- 交付审查发现 P1：幂等创建重放可在同一版本重签旧角色、权限矩阵未进入真实 API/数据库路径、界面错误宣称实时并用客户端状态伪装业务提交；另发现非法 JSON、错误分类、总部审计归属与阻断焦点等 P2。
- 修复：持久化并原子校验当前角色与版本，增加真实对象/门店/沙箱权限接缝及回归矩阵；新鲜度降为手动确认，生命周期来自 `expiresAt`，未接线业务显示诚实只读说明；阻断背景使用 `inert` 并补齐焦点循环。共享壳从 1138 行拆为模型、对话框、工作台和 409 行壳编排模块。
- 二次复审发现 P1/P2：`0006` 同步收紧非空破坏滚动升级，幂等重放返回可变角色且可能覆盖并发切换 Cookie，响应丢失后缺少会话恢复路径，失效沙箱切换误报为可重试故障；另有 `1024px` 无效果导航按钮、正式原型阻断焦点与 API 超大编排模块。
- 修复：`0006` 保持 nullable expand 窗口并在临时取消 FORCE RLS 后回填/恢复强制策略，旧 writer 继续可写且新代码在重放时安全认领空角色；创建响应与当前签名上下文分离，同沙箱认证重放不再写 Cookie；新增只读规范化恢复端点、响应丢失 E2E、`unavailable` 401 映射、正式原型焦点隔离/返回及断点按钮隐藏。API 路由拆为公共沙箱、角色上下文、权限和共享支持模块，`app.ts` 从 860 行降至 47 行。
- 三次复审发现 P1/P2：规范化恢复每次轮换 CSRF 会造成多标签刷新乒乓；新构建不能读取滚动窗口内仍有效的 v1 会话；结果未知恢复可能早于未决切换读取旧版本；失效沙箱虽返回 401，壳层仍缺少可执行的公开入口闭环。
- 修复：canonical refresh 复用完全匹配的已签名会话且不写 Cookie；受限兼容旧 v1 签名并以数据库状态规范化升级到 v2，可原子认领旧 writer 留下的空角色；结果未知恢复与切换在沙箱行锁上串行，并以同角色递增版本栅栏阻止晚到旧切换；切换或恢复发现 unavailable 时清除壳层状态并返回公开角色入口。新增真实 API/Postgres 并发、滚动升级与跨标签继续写入测试，以及浏览器 503/失效沙箱闭环。
- 四次复审发现 P1/P2：自然到期返回 `ROLE_CONTEXT_REQUIRED` 时活动壳层未退出；启动检查把 503/网络故障误判成无会话并开放创建；结果未知栅栏会写版本却只校验 Origin；原并发用例实际顺序执行。
- 修复：壳层统一把 required/unavailable 作为终止上下文，三条到期路径均回公开入口；启动瞬时故障进入不可写重试状态；只有真正执行版本栅栏时再验证签名会话的 CSRF，canonical 路径保持只读；真实 Postgres 行锁屏障分别覆盖 recovery-first 与 switch-first，缺失/错误 CSRF 不推进版本。
- 五次复审发现 P1/P2：切换已提交但响应与新 Cookie 丢失后，页面重载只会重复 GET 旧版本并永久 409。
- 修复：启动检查识别 `ROLE_CONTEXT_STALE` 后直接调用只读 canonical recovery，签发并进入服务端当前角色；真实 API/Postgres 与浏览器重载用例共同覆盖，且全程不开放新沙箱创建。
- 最终视觉复核：新增 `qa-ticket04-role-shell-comparison-1440-final.png` 与 `qa-ticket04-role-shell-comparison-1024-final.png`；工作区密度、主操作位置和断点布局继续对齐正式原型，无新增 P0/P1/P2。
- 修复后使用本文件列出的同状态合并证据复核，P0/P1/P2 全部清零。
- ticket 03 及更早的已解决轮次保存在 [`design-qa-history.md`](design-qa-history.md) 和 Git 历史中。

## Open Questions

- 无阻塞问题。

## Implementation Checklist

- [x] `WEB-G02` 共享角色框架持续展示人物、角色、范围、生命周期和新鲜度。
- [x] `WEB-G05` 角色切换、未提交输入确认、焦点进入/返回和旧标签阻断可操作。
- [x] `1440 × 1024`、`1024 × 768` 同视口全视图与三个重点状态合并对比完成。
- [x] 真实浏览器、真实 API/Postgres、RLS、权限矩阵、审计、CSRF/Origin 和跨标签验证完成。
- [x] 完整仓库门禁、正式原型构建与 Sites 包装测试通过。

final result: passed
