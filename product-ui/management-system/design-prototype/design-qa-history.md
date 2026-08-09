# 管理端设计 QA 历史

本文件保留已经解决的问题，供回归调查使用。当前有效性、待处理问题、验证矩阵和交付结果以 [`design-qa.md`](design-qa.md) 为准。

## Ticket 03 — 公开入口与版本化三店沙箱

- 检查日期：2026-08-09；范围：`WEB-G00`、`WEB-G01` 的公开入口、创建中、成功、失败、超时与安全重试。
- 证据：`design/qa-ticket03-public-entry-comparison-1440.png`、`design/qa-ticket03-public-entry-focus-1440.png`、`design/qa-ticket03-public-entry-comparison-1024.png`、`design/qa-ticket03-public-entry-comparison-360.png`。
- 结论：正式原型与生产实现完成 `1440 × 1024`、`1024 × 768`、`360 × 800` 同视口复核；真实 API/Postgres、幂等恢复、键盘焦点、构建与 Sites 包装测试通过，P0/P1/P2 清零，最终结果为 passed。

## Ticket 02 — 统一跨端设计基线与合成命名

- 检查日期：2026-08-09；已验证契约版本：`product-ui/management-system/prod.md` 1.1。
- 范围：栖光市、棱镜旗舰店、星桥标准店与极点新店在店员、店长和总部状态中的统一命名与布局回归。
- 证据：`design/qa-ticket02-staff-workbench-comparison.png`、`design/qa-ticket02-staff-workbench-focus.png`、`design/implementation-ticket02-chain-dashboard-1440.png`、`design/implementation-ticket02-store-compare-1024.png`、`design/implementation-ticket02-manager-store-profile-1024.png`。
- 结论：同视口复核未发现 P0/P1/P2；构建与 Sites 包装测试通过，浏览器控制台 warning/error 为 0，最终结果为 passed。

## 第 1 轮

- P2：接下来 30 分钟队列缺少金额列，降低了源图的横向信息密度。
- P2：中央列表和右侧对象面板整体偏紧凑，右侧区域比例不足。
- 修复：补充 `¥30.00` 列；队列行增至 62px、当前任务增至 96px、摘要行增至 58px；宽屏检查器调整为 392px，并增加卡片与时间线高度。
- 修复后证据：`design/qa-comparison-pass2.png`

## 第 2 轮

- P2：右侧对象面板的标题、详情值和时间线排版仍小于源图，层级感不足。
- 修复：提升检查器标题、详情、时间线和班次卡字号，放大人物图标，并增加详情与时间线纵向节奏。
- 修复后证据：`design/qa-comparison-pass3.png`、`design/qa-focus-inspector-pass3.png`

## 第 3 轮

- 同尺寸、同状态复核后，无可执行 P0/P1/P2 差异。

## 第 4 轮（浏览器批注迭代）

- P1：工作台“收起”按钮没有行为，属于不可用的核心可见控件。
- P2：1160px 以下顶栏工具隐藏文字后缺少 hover/focus 标签，图标语义不清晰。
- P2：库存只读提示与下方摘要相贴；交接确认提示缺少上下间距；交接说明文本域与提交按钮相贴。
- 修复：加入可恢复的详情面板收起态；为顶栏工具加入动态悬浮标签与 `aria-label`；三处相关间距统一为 14px。
- 修复后证据：`design/annotation-fix-inspector-collapsed.png`、`design/annotation-fix-role-tooltip.png`、`design/annotation-fix-inventory-gap.png`、`design/annotation-fix-handover-gaps.png`。
- 修复后全视图证据：`design/qa-comparison-pass4.png`。
- 同尺寸、同状态复核后，无遗留可执行 P0/P1/P2 差异。
- `npm run build` 通过；`npm run test:sites` 4/4 通过。
- 浏览器控制台已检查，warning/error 列表为空。

## 第 5 轮（浏览器批注迭代 2）

- P1：“创建座位报修”“经营日范围”以及两处终态“查看详情”是可见但无响应或被禁用的控件，用户无法完成对应任务。
- P2：“查看全部流水”的文字与箭头图标光学中心不一致；侧栏收起/展开没有过渡，状态切换生硬。
- 修复：为报修创建和经营日范围补齐专用表单弹窗及成功反馈；终态“查看详情”保持可点击并展开详情/显示状态说明；库存流水支持 3/6 条展开与收起，按钮采用统一的行内对齐；侧栏网格、文字、选中标记和沙箱信息加入 190ms 过渡并提供 reduced-motion 降级。
- 交互证据：`design/annotation-round2-repair-create.png`、`design/annotation-round2-business-day-range.png`、`design/annotation-round2-ledger-expanded.png`、`design/annotation-round2-sidebar-collapsed.png`、`design/annotation-round2-workbench-view-details.png`、`design/annotation-round2-reservation-view-details.png`。
- 修复后全视图证据：`design/qa-comparison-pass5.png`；重点区域证据：`design/qa-focus-shell-hero-pass5.png`、`design/qa-focus-inspector-pass5.png`。
- 同尺寸、同状态复核字体、间距、颜色、资产、文案、图标与核心信息密度后，无遗留可执行 P0/P1/P2 差异。
- `npm run build` 通过；`npm run test:sites` 4/4 通过；浏览器控制台 warning/error 列表为空。

## 第 6 轮（浏览器批注迭代 3）

- P1：总部机型档案和门店未来配置沿用通用字段；配置行“编辑”无行为，导致表单内容与实际业务不符且无法编辑。
- P2：终态预约仍显示没有详情页去向的“查看详情”；收起侧栏缺少导航 hover 标签且沙箱图标偏心；“全部审计”文字/图标、门店颜色标记存在光学偏差；多张表格、时间线和“保存未来配置”缺少顶部间距。
- 修复：总部商品、机型档案、门店展示资料、区域座位、价格和商品范围均使用带真实字段的上下文弹窗；配置行编辑接入对应数据；两处终态详情按钮移除并将事件文案改为“无后续业务动作”；收起侧栏补充自定义 hover/focus 标签并消除隐藏文本留下的 flex gap；相关按钮统一使用 trailing 图标；颜色标记跨两行居中；目标区域补充 12–14px 间距。
- 交互证据：`design/annotation-round3-sidebar-hover.png`、`design/annotation-round3-workbench-terminal-clean.png`、`design/annotation-round3-manager-dashboard-polish.png`、`design/annotation-round3-manager-people-gap.png`、`design/annotation-round3-hq-store-index.png`、`design/annotation-round3-hq-machine-modal.png`、`design/annotation-round3-hq-store-config-create.png`、`design/annotation-round3-hq-store-config-edit.png`、`design/annotation-round3-hq-people-gap.png`。
- 修复后全视图证据：`design/qa-comparison-pass6.png`；重点区域证据：`design/qa-focus-shell-hero-pass6.png`、`design/qa-focus-inspector-pass6.png`。
- 同尺寸、同状态复核字体、间距、颜色、品牌资产、图标、文案与信息密度后，无遗留可执行 P0/P1/P2 差异。
- `npm run build` 通过；`npm run test:sites` 4/4 通过；图表提供初始尺寸后，店长与总部角色切换及最终工作台的浏览器控制台 warning/error 列表为空。

## 第 7 轮（浏览器批注迭代 4）

- P1：创建座位报修的座位与优先级仍是自由输入；“创建背景员工”等店长入口仍可能落入“业务命令”通用字段，内容与真实业务不符。
- P2：排班覆盖不足告警紧贴标签栏，缺少清晰分组间距。
- 修复：报修座位与优先级改为带真实选项的下拉框；逐一梳理全部弹窗入口，为库存盘点/入库、门店资料/营业规则/座位/价格/商品、员工/班次/考勤更正/缺勤记录/交接快照以及总部配置提供专用字段、作用范围与提交动作；只读查看类弹窗只保留“知道了”；未声明入口不再展示误导性的通用表单。排班告警顶部补充 14px 间距。
- 覆盖证据：源码中 16 种结构化 action kind 与 16 个 resolver 分支完全一致，店长与总部当前入口没有遗留字符串式通用动作；浏览器逐项打开库存 2 个入口、店长门店配置 7 个入口、人员排班/考勤/交接 5 类、总部配置 6 类场景并核对标题、字段与按钮。
- 交互证据：`design/annotation-round4-repair-modal.png`、`design/annotation-round4-employee-modal.png`、`design/annotation-round4-schedule-gap.png`。
- 修复后全视图证据：`design/qa-comparison-pass7.png`；重点区域证据：`design/qa-focus-shell-hero-pass7.png`、`design/qa-focus-inspector-pass7.png`。
- 排班标签与告警之间、告警与网格之间均测得 14px；`1024 × 768` 下盘点弹窗完整位于视口内且正文无滚动溢出。
- 同尺寸、同状态复核字体、间距、颜色、品牌资产、图标、文案与信息密度后，无遗留可执行 P0/P1/P2 差异。
- `npm run build` 通过；`npm run test:sites` 4/4 通过；浏览器控制台 warning/error 列表为空。
