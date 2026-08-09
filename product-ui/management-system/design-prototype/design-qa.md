# 竞枢管理端设计 QA

- 状态：`current`（当前有效）
- 检查日期：2026-08-09
- 已验证契约版本：`product-ui/management-system/prod.md` 1.2
- 验证范围：[`05 — 双时钟、时间推进与轮换重置`](../../../.scratch/jingshu-basic-rc/issues/05-dual-clock-reset.md)；店员工作台浏览器标注 1–4、两轮极窄补充及角色切换弹窗响应式回归

## 对照目标与规范化

- 视觉源真相：`design/reference/selected-night-operations-console.png`（`1487 × 1058`），以及在同一视觉系统内维护的正式状态源图。
- 时间确认源图/实现：`design/source-ticket05-time-confirm-1440-final.png` 与 `design/implementation-ticket05-time-confirm-1440-final.png`。
- 重置影响源图/实现：`design/source-ticket05-reset-impact-1440-final.png` 与 `design/implementation-ticket05-reset-impact-1440-final.png`。
- 视口与密度：全视图均为 `1440 × 1024 CSS px`、`devicePixelRatio = 1`，截图像素均为 `1440 × 1024`，无需密度换算；角色均为店员，最终时间确认对照使用相同上海业务时间。
- 响应式实现证据：`design/implementation-ticket05-time-preview-1024.png`，`1024 × 768 CSS px`、`devicePixelRatio = 1`。
- 状态：两种推进方式、影响确认、原子处理中、成功、事务失败、24 小时上限、重置影响、二次确认、创建成功、创建失败与旧标签失效。
- 本轮响应式源：正式 `1024px` 状态源 `design/source-ticket04-role-shell-1024.png`，以及用户在应用内浏览器提交的 4 张标注截图；后者分别指出 `1274px` 顶栏图文未对齐、`883px` 主任务裁切、`671px` 摘要文字竖排和 `619px` 等待回执裁切。
- 本轮实现证据：`design/implementation-browser-comments-responsive-1440.png`、`design/implementation-browser-comments-responsive-1274.png`、`design/implementation-browser-comments-responsive-1024.png`、`design/implementation-browser-comments-responsive-883.png`、`design/implementation-browser-comments-responsive-671.png` 与 `design/implementation-browser-comments-responsive-619.png`。所有截图像素尺寸等于对应 CSS 视口，`devicePixelRatio = 1`，无需密度换算。
- 极窄屏补充源：用户在 `452 × 413` 浏览器视口继续标注当前主任务卡和“展开当前对象”入口；实现证据为 `design/implementation-browser-comments-responsive-452.png`，浏览器视口覆盖 `452 × 413`、扣除垂直滚动条后的内容宽度 `437px`、全页截图 `437 × 640`、`devicePixelRatio = 1`。
- 摘要卡补充源：用户在 `366 × 866` 浏览器视口标注订单摘要右侧统计文案逐字换行，并明确要求沿用正式设计稿的窄屏规则隐藏次要文案；实现证据为 `design/implementation-browser-comments-responsive-366.png`，截图像素与 CSS 视口均为 `366 × 866`、`devicePixelRatio = 1`。
- 角色切换补充源/实现：正式原型 `design/source-browser-comments-role-switch-407.png` 与生产 `design/implementation-browser-comments-role-switch-407.png`；两者均为 `407 × 866 CSS px`、截图像素 `407 × 866`、`devicePixelRatio = 1`，状态均为店员打开“切换演示角色”。用户同视口标注的修复前生产证据保存在 `design/implementation-browser-comments-role-switch-407-before.png`。

## 对比证据

### 全视图

- 时间预览：`design/source-ticket05-time-preview-1440-final.png` 与 `design/implementation-ticket05-time-preview-1440.png`。
- 时间确认最终对比：`design/source-ticket05-time-confirm-1440-final.png` 与 `design/implementation-ticket05-time-confirm-1440-final.png`。
- 重置影响最终对比：`design/source-ticket05-reset-impact-1440-final.png` 与 `design/implementation-ticket05-reset-impact-1440-final.png`。
- 生产状态证据：`design/implementation-ticket05-time-processing-1440.png`、`design/implementation-ticket05-time-success-1440.png`、`design/implementation-ticket05-time-failure-1440.png`、`design/implementation-ticket05-time-limit-1440.png`、`design/implementation-ticket05-reset-confirm-1440.png`、`design/implementation-ticket05-reset-success-1440.png`、`design/implementation-ticket05-reset-failure-1440.png` 与 `design/implementation-ticket05-old-tab-invalid-1440.png`。
- 正式原型异常状态：`design/source-ticket05-time-failure-1440.png`、`design/source-ticket05-time-limit-1440.png`、`design/source-ticket05-reset-confirm-1440.png` 与 `design/source-ticket05-reset-failure-1440.png`。

### 重点区域

- 时间确认弹窗：`design/source-ticket05-time-confirm-focus.png`（`700 × 488`）与 `design/implementation-ticket05-time-confirm-focus.png`（`700 × 466`）。
- 重置影响弹窗：`design/source-ticket05-reset-impact-focus.png`（`700 × 370`）与 `design/implementation-ticket05-reset-impact-focus.png`（`700 × 398`）。
- 两组均从同视口全图按真实弹窗边界裁取；重要标题、时间值、风险说明、影响列表与主次操作在原始密度下可直接判读，因此无需继续拆分更小区域。
- 本轮工作台正式源/生产实现全视图同屏对比：`design/qa-browser-comments-responsive-comparison-1024.png`（左侧正式 `1024 × 768` 源，右侧生产 `1024 × 768` 实现）。
- 本轮顶栏重点区域同屏对比：`design/qa-browser-comments-topbar-focus-1024.png`（左右各 `1024 × 72`）；按钮图标与文字的垂直中心可直接判读，无需继续拆分。
- 极窄主任务重点区域：`design/qa-browser-comments-452-card-focus.png`（左侧正式桌面卡片视觉源，右侧 `452px` 响应式实现）。两侧视口不同，因此只比较品牌语言、信息优先级、状态/金额/时间可读性和青柠主操作，不做像素位置等值判断；`452px` 全视图以用户标注截图与实现证据直接复核。
- 极窄摘要重点区域：`design/qa-browser-comments-366-summary-focus.png` 把正式视觉源的宽屏订单/报修摘要与 `366px` 响应式实现放入同一对比输入。两者只比较图标、标题、箭头、卡片高度和信息优先级；窄屏按正式响应式规则有意隐藏统计文案，不做横向位置等值判断。
- 角色切换弹窗同屏对比：`design/qa-browser-comments-role-switch-comparison-407.png`，左侧正式原型、右侧生产实现。两侧视口、角色、弹窗状态和像素密度一致，可直接比较弹窗宽度、单列角色卡、图标/标题/范围层级、当前角色状态和安全提示。

## Findings

- 没有仍需处理的 P0、P1 或 P2 差异。
- 浏览器标注 1–4 均已关闭：顶栏工具按钮统一为居中 `inline-flex`；`960px` 及以下自动收起检查器，主区恢复完整宽度；手动展开时检查器改为右侧覆盖层，不重新挤压队列；`720px` 及以下收紧主任务列，队列内部滚动只作为更窄视口兜底。`883px`、`671px` 与 `619px` 复核中摘要行均为 `60px` 高，正文保持 `horizontal-tb`，页面 `scrollWidth = clientWidth`。
- `452px` 补充标注已关闭：标题保持单行；筛选与带 Phosphor 侧栏图标的“展开详情”组成第二行；当前主任务按“人物/金额 → 时间/到店窗口 → 主操作”重排为 `163px` 高卡片，卡片 `scrollWidth = clientWidth = 327px`，详情按钮为 `94 × 38px`，不再竖排或裁切。
- `366px` 摘要卡补充标注已关闭：订单与报修卡在 `520px` 及以下隐藏次要统计文案，只保留图标、标题和箭头；两张卡均为 `60px` 高，内容宽度 `261px` 且 `scrollWidth = clientWidth`，没有逐字竖排、裁切或横向溢出。
- `407px` 角色切换补充标注已关闭：生产弹窗沿用正式原型的窄屏结构，外边距从 `20px` 收敛为 `12px`，四张角色卡由两列改为单列；每张卡为 `345 × 112px`，弹窗为 `383 × 780px` 且无需内部滚动，人物、门店范围与当前角色状态保持横向可读。
- 可接受的动态内容差异：正式原型用已登记的预约/订单事件表达影响密度；ticket 05 生产注册表在后续预约、订单、考勤和交接 ticket 接入前为空，因此“推进到下一事件”明确禁用、`+30 分钟` 显示“没有到期业务事件”。两侧外部契约、层级和空影响表达一致，生产没有伪造事件。
- P3：正式原型使用带分隔线的共享 `Modal` 头尾，生产沿用 ticket 04 壳层无分隔线对话框；两者弹窗宽度同为 `700px`，时间确认高度相差 `22px`，重置影响高度相差 `28px`，没有改变内容顺序、可读性或操作位置。

## 必查保真表面

- 字体与排版：两侧均使用 Noto Sans SC Variable；标题、说明、时间数字、影响标签和按钮保持相同字号层级、字重与换行密度，`700px` 弹窗内没有截断。
- 间距与布局：时间确认均采用前后双列、风险条、影响区和右下主次操作；重置均采用危险说明、四角色 `2 × 2` 影响网格和二次确认入口。生产 `1024px` 下 `bodyScrollWidth = bodyClientWidth = 1024px`，`700px` 弹窗位于 `162–862px`，底部为 `611.95px`，无裁切或横向溢出。本轮 `883px` 及以下检查器自动收起，`619px` 主任务、等待回执与摘要均完整占用主区，主任务 `scrollWidth = clientWidth = 501px`；`452px` 工具区为 `97px` 高两行布局，主任务卡内部无溢出；`366px` 摘要卡收敛为“图标—标题—箭头”三列，保持 `60px` 高；`407px` 角色切换弹窗采用正式原型的 `12px` 视口边距和 `345px` 单列角色卡。
- 颜色与令牌：炭灰/海军蓝表面、青色时间反馈、青柠主操作、琥珀安全提醒和红色重置风险均沿用选定“夜间运营控制台”方向；推进后时间统一改为青色，重置危险条统一为红色。
- 图片与资产：品牌标志继续使用正式 PNG，所有操作图标使用 Phosphor；没有占位图、手写 SVG、文本符号、CSS 图形或低清替代资产。
- 文案与内容：上海业务时间、24 小时累计上限、真实服务器时间安全边界、固定到期顺序、事务整体回滚、四角色影响、新沙箱先创建后切换、旧对象封锁与安全重试均明确可见。
- 状态与交互：真实同源 Web → Hono → 临时 Postgres 流程覆盖预览、确认、行锁等待中的处理中、提交成功、API 中断后的失败与同请求重试、数据库固定到精确 24 小时后的上限、重置成功/失败以及跨标签阻断。
- 响应式与无障碍：对话框使用语义化 `dialog`/`alertdialog`、背景 `inert`、关闭按钮初始焦点和焦点循环；`Escape` 后焦点返回原业务时间触发器。风险不只靠颜色表达，处理中使用文字与旋转图标，reduced-motion 规则把动画压缩为 `0.01ms`。

## 浏览器、API 与数据库验证

- Codex 应用内浏览器控制台：正式原型、生产 `1440 × 1024`、生产 `1024 × 768` 和旧标签的 warning/error 均为 0。
- 浏览器标注回归：应用内浏览器依次验证 `1274 × 866`、`883 × 866`、`671 × 866` 与 `619 × 866`；宽到窄切换会自动移除检查器并显示“展开当前对象”，手动展开后 `360px` 检查器以绝对定位覆盖，主区宽度保持 `811px`，收起可恢复，warning/error 为 0。自动化新增窄屏检查器回归用例并通过。
- 极窄交互回归：应用内浏览器验证 `452 × 413` 的标题、筛选、详情入口和主任务卡；展开后 `360px` 检查器继续作为覆盖层，主区保持 `365px`，页面 `scrollWidth = clientWidth = 437px`；收起可恢复，warning/error 为 0。自动化把同一窄屏用例扩展到 `452px`，检查卡片无内部溢出、按钮高度和标题单行。
- 摘要卡极窄回归：应用内浏览器验证 `366 × 866`，页面 `bodyScrollWidth = bodyClientWidth = 366px`；订单与报修摘要统计文案的计算样式均为 `display: none`，两张卡均为 `263 × 60px`（内容宽度 `261px`），`scrollWidth = clientWidth`，warning/error 为 0。自动化把同一窄屏用例扩展到 `366px`，检查隐藏状态、卡片高度和内部无溢出。
- 角色切换极窄回归：应用内浏览器在 `407 × 866` 同状态打开正式原型与生产弹窗；生产 `bodyScrollWidth = bodyClientWidth = 407px`，角色网格计算为单个 `345px` 轨道，四张卡的横坐标均为 `31px`、高度均为 `112px`，弹窗 `scrollHeight = clientHeight = 778px`，warning/error 为 0。自动化新增同视口用例，检查单列、卡宽/高度、弹窗高度、关闭交互和页面无溢出。
- 双时钟：真实业务时钟自然流逝，连续 `+30 分钟` 后顶栏和服务端结果同步变化；沙箱 `expiresAt` 不变。推进标签广播失效后，第二个已打开标签从服务端自动刷新到新业务时间，同时保留本地队列筛选输入。真实 Postgres 审计同时保存业务发生时间与不可变服务器记录时间。
- 事务失败：提交前持有沙箱行锁时生产界面稳定停留在“正在原子推进业务时间”；停止 API 后显示旧时间不变和同请求安全重试，恢复 API 后成功提交。
- 重置轮换：真实新沙箱创建后会话回到顾客标准起点，另一个已打开的标签立即显示“当前标签的旧沙箱已失效”；失败时当前角色和沙箱保持不变，恢复 API 后使用同一请求安全成功。真实 Postgres 同时验证旧沙箱重置审计与新沙箱来源事件只各写一次。
- 上限：在一次性 QA 数据库把当前沙箱固定到精确 `86_400_000ms` 累计推进后，生产只显示 24 小时上限状态，不提供继续推进入口。
- 自动化：完整 `pnpm verify` 通过，包括 31 个单元测试、30 个真实 Postgres/API 集成测试、2 个设计内容基线测试与 21 个 Chromium E2E；契约与种子套件无独立测试文件并按配置通过。Web/API/数据库/领域/契约/小程序构建、格式、lint、strict TypeScript、工作区边界、敏感数据扫描和 high 级依赖审计均通过（仅报告 1 个不阻塞门禁的 moderate 漏洞）。
- 正式原型：`npm run build` 通过，`npm run test:sites` 4/4 通过；`dist/client/index.html`、`dist/server/index.js` 与 `dist/.openai/hosting.json` 均已生成。
- 审查后复核：正式原型与生产界面统一使用规范术语“真实服务器时间”；应用内浏览器在真实生产路径确认预览和确认态均已更新，旧称谓不再出现。该文案修正不改变既有布局、状态或视觉差异结论。

## 对比历史

### 第 1 轮

- P1：推进事务成功后，父级业务时钟更新导致预览加载回调重新创建，成功态立即被“选择推进方式”覆盖。
- 修复：预览读取改为只在弹窗挂载时执行，并通过引用读取最新失效/关闭回调；真实 PostgreSQL 提交后成功态持续可见。
- 修复后证据：`design/implementation-ticket05-time-success-1440.png`。

### 第 2 轮

- P2：正式原型与生产的时间确认风险条/影响区顺序、推进后颜色和重置危险说明位置不一致；生产重置弹窗比源图高约 `107px`。
- 修复：统一为“前后时间 → 风险说明 → 影响”、推进后青色令牌和重置红色危险条；合并重复说明、收紧重置弹窗与影响卡间距。
- 修复后证据：最终时间/重置全视图和两组重点区域证据；生产重置高度收敛到 `398px`，源图为 `370px`。

### 浏览器标注响应式回归

- P1：`883px`、`671px` 与 `619px` 下固定检查器列持续占宽，分别造成主任务按钮裁切、摘要文案逐字竖排和等待回执内容裁切；P2：`1274px` 顶栏工具按钮沿行内基线排布，图标与文字垂直中心相差 `4px`。
- 修复：生产角色壳监听 `960px` 媒体查询并在进入窄屏时收起检查器；窄屏手动展开改为覆盖层；顶栏工具按钮统一使用居中 flex；队列开放受控内部横向滚动，`720px` 下收紧主任务列与顶栏轨道。
- 修复后证据：`design/implementation-browser-comments-responsive-1274.png`、`design/implementation-browser-comments-responsive-883.png`、`design/implementation-browser-comments-responsive-671.png`、`design/implementation-browser-comments-responsive-619.png`，以及两张同屏对比图。复测中顶栏图标与文字中心差为 `0px`，`619px` 主任务无内部溢出，页面无横向溢出。

### 浏览器标注响应式回归第 2 轮

- P1：`452px` 下当前主任务卡的五列最小内容宽度为 `454px`，实际卡片内容宽度仅 `291px`，主操作被推到可视区外；P2：标题工具仍保持桌面横排，“现场脉冲”逐字换行，“展开当前对象”被压成 `37 × 101px` 的竖排按钮。
- 修复：新增 `520px` 极窄断点，把标题与工具拆成两行；详情入口改为 Phosphor 图标加短标签“展开详情”，保留完整可访问名称；当前主任务使用命名网格区域重排，主操作占据卡片底部整行。
- 修复后证据：`design/implementation-browser-comments-responsive-452.png` 与 `design/qa-browser-comments-452-card-focus.png`。最终卡片 `327 × 163px`、内部无横向溢出，标题 `94 × 36px`，详情按钮 `94 × 38px`，页面无横向溢出。

### 浏览器标注响应式回归第 3 轮

- P2：`366px` 下订单/报修摘要仍保留桌面统计列，约 `261px` 的内容宽度无法容纳“图标 + 标题 + 统计 + 箭头”，统计文案被压成逐字竖排，卡片异常增高。
- 修复：沿用正式设计稿的极窄屏信息优先级，在既有 `520px` 断点隐藏摘要统计文案，并把卡片网格收敛为“图标—标题—箭头”三列；宽屏统计保持不变。
- 修复后证据：`design/implementation-browser-comments-responsive-366.png` 与 `design/qa-browser-comments-366-summary-focus.png`。最终两张摘要卡均为 `263 × 60px`，正文只显示标题且内部无横向溢出。

### 浏览器标注响应式回归第 4 轮

- P2：`407px` 下角色切换弹窗仍使用桌面双列网格，单卡仅 `145.5px` 宽；人物、范围与当前角色状态被压成逐字换行，前两张卡增高到 `265.5px`，无法快速比较四个角色。
- 修复：对齐正式原型的 `720px` 以下弹窗结构，把遮罩内边距收敛为 `12px`、弹窗内边距收敛为 `18px`，角色网格切换为单列；保留生产服务端映射说明、CSRF 安全提示和原有切换行为。
- 修复后证据：`design/source-browser-comments-role-switch-407.png`、`design/implementation-browser-comments-role-switch-407.png` 与 `design/qa-browser-comments-role-switch-comparison-407.png`。最终角色卡 `345 × 112px`，四张卡等宽等高，弹窗完整位于视口内且无需滚动。

### 最终复核

- 同角色、同时间、同视口把源图与生产截图放入同一次对比输入，字体、间距、颜色、图片资产、图标、文案、状态和操作逐项复核；P0/P1/P2 清零。
- ticket 04 及更早轮次保存在 [`design-qa-history.md`](design-qa-history.md) 和 Git 历史中。

## Open Questions

- 无阻塞问题。

## Implementation Checklist

- [x] `WEB-G04` 两种受限推进、影响确认、处理中、成功、失败、安全重试与精确上限可操作。
- [x] `WEB-G06` 四角色影响、二次确认、创建中、成功、失败和旧标签失效可操作。
- [x] `1440 × 1024` 同状态全视图与重点区域对比完成；`1024 × 768` 无溢出或裁切。
- [x] 真实浏览器、API/Postgres、双时间审计、事务回滚、幂等重试、会话轮换和跨标签阻断完成。
- [x] 浏览器标注 1–4 的顶栏对齐、窄屏自动收起、覆盖层恢复和主区无裁切完成。
- [x] `452px` 补充标注的标题/工具两行布局、紧凑详情入口与主任务卡重排完成。
- [x] `366px` 补充标注的摘要统计隐藏、三列卡片和无竖排回归完成。
- [x] `407px` 角色切换弹窗的单列角色卡、正式边距、完整关闭交互与无溢出回归完成。
- [x] 完整仓库门禁与正式原型 Sites 包装测试通过，自动化结果已回填。

final result: passed
