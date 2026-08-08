# 竞枢管理端设计 QA

## 对照基线

- source visual truth path: `design/reference/selected-night-operations-console.png`
- implementation screenshot path: `design/implementation-staff-workbench-final-pass7.png`
- viewport: `1440 × 1024 CSS px`
- source pixels: `1487 × 1058 px`，按 Lanczos 等比归一化为 `1440 × 1024 px`
- implementation pixels: `1440 × 1024 px`
- density normalization: CSS viewport `1440 × 1024`，`deviceScaleFactor = 1`
- state: 店员角色 / 工作台 / “现场脉冲” / 首条预约“已确认” / 实时模式 / 业务时间 19:30
- full-view comparison evidence: `design/qa-comparison-pass7.png`
- focused region comparison evidence:
  - 顶栏、导航与当前任务：`design/qa-focus-shell-hero-pass7.png`
  - 当前选中对象与班次面板：`design/qa-focus-inspector-pass7.png`
  - 详情面板收起态：`design/annotation-fix-inspector-collapsed.png`
  - 窄屏角色按钮悬浮标签：`design/annotation-fix-role-tooltip.png`
  - 库存提示间距：`design/annotation-fix-inventory-gap.png`
  - 交接班提示、文本域与按钮间距：`design/annotation-fix-handover-gaps.png`
  - 创建座位报修弹窗：`design/annotation-round2-repair-create.png`
  - 经营日范围弹窗：`design/annotation-round2-business-day-range.png`
  - 库存流水展开态：`design/annotation-round2-ledger-expanded.png`
  - 侧栏收起态：`design/annotation-round2-sidebar-collapsed.png`
  - 工作台终态预约详情：`design/annotation-round2-workbench-view-details.png`
  - 预约页终态详情：`design/annotation-round2-reservation-view-details.png`
  - 收起侧栏悬浮标签与沙箱图标：`design/annotation-round3-sidebar-hover.png`
  - 工作台终态去除冗余详情按钮：`design/annotation-round3-workbench-terminal-clean.png`
  - 店长看板按钮与时间线间距：`design/annotation-round3-manager-dashboard-polish.png`
  - 店长员工表格间距：`design/annotation-round3-manager-people-gap.png`
  - 总部门店颜色标记：`design/annotation-round3-hq-store-index.png`
  - 机型档案专用编辑弹窗：`design/annotation-round3-hq-machine-modal.png`
  - 门店未来配置创建弹窗：`design/annotation-round3-hq-store-config-create.png`
  - 门店未来配置编辑弹窗：`design/annotation-round3-hq-store-config-edit.png`
  - 总部人员表格间距：`design/annotation-round3-hq-people-gap.png`
  - 创建座位报修的座位/优先级下拉框：`design/annotation-round4-repair-modal.png`
  - 创建背景员工专用弹窗：`design/annotation-round4-employee-modal.png`
  - 排班覆盖告警间距：`design/annotation-round4-schedule-gap.png`

## Findings

- 没有遗留可执行的 P0、P1 或 P2 问题。
- 字体与排版：实现使用 Noto Sans SC Variable；字重、字号层级、时间数字、行高和高密度小字与源图意图一致，关键内容无截断或碰撞。
- 间距与布局：顶部状态栏、左侧角色导航、中央任务队列、右侧对象检查器和底部预警条的区域比例、边框、圆角与纵向节奏已对齐。
- 颜色与视觉令牌：深海军蓝背景、青色实时/选中态、荧光绿主操作、琥珀警告、红色异常状态均保持一致且有足够对比度。
- 图片与资产：品牌图形为独立生成的透明 PNG，无 CSS/内联 SVG 替代、无透明边缘光晕；界面图标统一使用 Phosphor 图标库。
- 文案与内容：采用中文门店运营语义和明确的演示数据标识；所有人物均标注“虚构人物”，金额均使用模拟金额。
- 状态与交互：主导航、角色切换、预约办理、座位报修创建、经营日范围、库存流水展开、订单流转、报修闭环、店长库存/门店/员工/排班/考勤/交接弹窗、总部资料与未来配置、总部导出、业务时间推进和重置流程均可操作；终态预约不再提供没有去向的“查看详情”。
- 响应式：管理端在 `1024 × 768` 下主操作仍完整可见；公开入口在 360px 宽度下无横向溢出或结构破坏。
- 批注迭代：右侧当前对象面板支持收起/恢复；窄屏顶栏和收起侧栏均提供 hover/focus 标签；沙箱图标中心偏差为 0px；关键表格、时间线、告警和保存按钮使用 12–14px 的明确分组间距；侧栏过渡尊重 reduced-motion；所有当前可触发的业务弹窗均与所点业务一致，未声明入口只显示安全只读提示，不再回落到误导性的通用表单。

## Open Questions

- 无阻塞问题。源图是视觉方向稿，部分姓名与状态文案按产品说明替换为更明确的领域语义，属于有意差异。

## Comparison History

### Pass 1

- P2：接下来 30 分钟队列缺少金额列，降低了源图的横向信息密度。
- P2：中央列表和右侧对象面板整体偏紧凑，右侧区域比例不足。
- Fix：补充 `¥30.00` 列；队列行增至 62px、当前任务增至 96px、摘要行增至 58px；宽屏检查器调整为 392px，并增加卡片与时间线高度。
- Post-fix evidence: `design/qa-comparison-pass2.png`

### Pass 2

- P2：右侧对象面板的标题、详情值和时间线排版仍小于源图，层级感不足。
- Fix：提升检查器标题、详情、时间线和班次卡字号，放大人物图标，并增加详情与时间线纵向节奏。
- Post-fix evidence: `design/qa-comparison-pass3.png`、`design/qa-focus-inspector-pass3.png`

### Pass 3

- 同尺寸、同状态复核后，无可执行 P0/P1/P2 差异。

### Pass 4（浏览器批注迭代）

- P1：工作台“收起”按钮没有行为，属于不可用的核心可见控件。
- P2：1160px 以下顶栏工具隐藏文字后缺少 hover/focus 标签，图标语义不清晰。
- P2：库存只读提示与下方摘要相贴；交接确认提示缺少上下间距；交接说明文本域与提交按钮相贴。
- Fix：加入可恢复的详情面板收起态；为顶栏工具加入动态悬浮标签与 `aria-label`；三处相关间距统一为 14px。
- Post-fix evidence: `design/annotation-fix-inspector-collapsed.png`、`design/annotation-fix-role-tooltip.png`、`design/annotation-fix-inventory-gap.png`、`design/annotation-fix-handover-gaps.png`。
- Full-view post-fix evidence: `design/qa-comparison-pass4.png`。
- 同尺寸、同状态复核后，无遗留可执行 P0/P1/P2 差异。
- `npm run build` 通过；`npm run test:sites` 4/4 通过。
- 浏览器控制台已检查，warning/error 列表为空。

### Pass 5（浏览器批注迭代 2）

- P1：“创建座位报修”“经营日范围”以及两处终态“查看详情”是可见但无响应或被禁用的控件，用户无法完成对应任务。
- P2：“查看全部流水”的文字与箭头图标光学中心不一致；侧栏收起/展开没有过渡，状态切换生硬。
- Fix：为报修创建和经营日范围补齐专用表单弹窗及成功反馈；终态“查看详情”保持可点击并展开详情/显示状态说明；库存流水支持 3/6 条展开与收起，按钮采用统一的行内对齐；侧栏网格、文字、选中标记和沙箱信息加入 190ms 过渡并提供 reduced-motion 降级。
- Interaction evidence: `design/annotation-round2-repair-create.png`、`design/annotation-round2-business-day-range.png`、`design/annotation-round2-ledger-expanded.png`、`design/annotation-round2-sidebar-collapsed.png`、`design/annotation-round2-workbench-view-details.png`、`design/annotation-round2-reservation-view-details.png`。
- Full-view post-fix evidence: `design/qa-comparison-pass5.png`；focused evidence: `design/qa-focus-shell-hero-pass5.png`、`design/qa-focus-inspector-pass5.png`。
- 同尺寸、同状态复核字体、间距、颜色、资产、文案、图标与核心信息密度后，无遗留可执行 P0/P1/P2 差异。
- `npm run build` 通过；`npm run test:sites` 4/4 通过；浏览器控制台 warning/error 列表为空。

### Pass 6（浏览器批注迭代 3）

- P1：总部机型档案和门店未来配置沿用通用字段；配置行“编辑”无行为，导致表单内容与实际业务不符且无法编辑。
- P2：终态预约仍显示没有详情页去向的“查看详情”；收起侧栏缺少导航 hover 标签且沙箱图标偏心；“全部审计”文字/图标、门店颜色标记存在光学偏差；多张表格、时间线和“保存未来配置”缺少顶部间距。
- Fix：总部商品、机型档案、门店展示资料、区域座位、价格和商品范围均使用带真实字段的上下文弹窗；配置行编辑接入对应数据；两处终态详情按钮移除并将事件文案改为“无后续业务动作”；收起侧栏补充自定义 hover/focus 标签并消除隐藏文本留下的 flex gap；相关按钮统一使用 trailing 图标；颜色标记跨两行居中；目标区域补充 12–14px 间距。
- Interaction evidence: `design/annotation-round3-sidebar-hover.png`、`design/annotation-round3-workbench-terminal-clean.png`、`design/annotation-round3-manager-dashboard-polish.png`、`design/annotation-round3-manager-people-gap.png`、`design/annotation-round3-hq-store-index.png`、`design/annotation-round3-hq-machine-modal.png`、`design/annotation-round3-hq-store-config-create.png`、`design/annotation-round3-hq-store-config-edit.png`、`design/annotation-round3-hq-people-gap.png`。
- Full-view post-fix evidence: `design/qa-comparison-pass6.png`；focused evidence: `design/qa-focus-shell-hero-pass6.png`、`design/qa-focus-inspector-pass6.png`。
- 同尺寸、同状态复核字体、间距、颜色、品牌资产、图标、文案与信息密度后，无遗留可执行 P0/P1/P2 差异。
- `npm run build` 通过；`npm run test:sites` 4/4 通过；图表提供初始尺寸后，店长与总部角色切换及最终工作台的浏览器控制台 warning/error 列表为空。

### Pass 7（浏览器批注迭代 4）

- P1：创建座位报修的座位与优先级仍是自由输入；“创建背景员工”等店长入口仍可能落入“业务命令”通用字段，内容与真实业务不符。
- P2：排班覆盖不足告警紧贴标签栏，缺少清晰分组间距。
- Fix：报修座位与优先级改为带真实选项的下拉框；逐一梳理全部弹窗入口，为库存盘点/入库、门店资料/营业规则/座位/价格/商品、员工/班次/考勤更正/缺勤记录/交接快照以及总部配置提供专用字段、作用范围与提交动作；只读查看类弹窗只保留“知道了”；未声明入口不再展示误导性的通用表单。排班告警顶部补充 14px 间距。
- Coverage evidence：源码中 16 种结构化 action kind 与 16 个 resolver 分支完全一致，店长与总部当前入口没有遗留字符串式通用动作；浏览器逐项打开库存 2 个入口、店长门店配置 7 个入口、人员排班/考勤/交接 5 类、总部配置 6 类场景并核对标题、字段与按钮。
- Interaction evidence: `design/annotation-round4-repair-modal.png`、`design/annotation-round4-employee-modal.png`、`design/annotation-round4-schedule-gap.png`。
- Full-view post-fix evidence: `design/qa-comparison-pass7.png`；focused evidence: `design/qa-focus-shell-hero-pass7.png`、`design/qa-focus-inspector-pass7.png`。
- 排班标签与告警之间、告警与网格之间均测得 14px；`1024 × 768` 下盘点弹窗完整位于视口内且正文无滚动溢出。
- 同尺寸、同状态复核字体、间距、颜色、品牌资产、图标、文案与信息密度后，无遗留可执行 P0/P1/P2 差异。
- `npm run build` 通过；`npm run test:sites` 4/4 通过；浏览器控制台 warning/error 列表为空。

## Primary Interactions Tested

- 预约“办理到店”与“开始使用”。
- 商品订单从已模拟支付推进到已完成。
- 报修分派、处理中、关联凭证、待验证、店长验证与关闭。
- 店长与总部角色切换、总部多店看板、导出范围和导出完成态。
- 业务时间推进 30 分钟、演示数据重置、公开入口回退。
- 360px 公开入口和 1024px 管理端关键操作可见性。
- 1115px 工作台详情面板收起与恢复；主工作区宽度由 611px 扩展至 931px，并可恢复为 611px。
- 1056px 顶栏“切换角色”悬浮标签；可见文字隐藏时伪元素标签 opacity 为 1，且保留可访问名称。
- 库存提示下方、交接提示上下、交接文本域与提交按钮之间均测得 14px 间距。
- “创建座位报修”打开专用弹窗，带入 A-18、紧急优先级和故障描述，提交后显示成功反馈。
- “经营日范围”打开日期与业务日边界弹窗，提交后显示成功反馈。
- 库存“查看全部流水”可在 3 条与 6 条之间切换；文字与箭头图标中心差为 0px，`aria-expanded` 同步更新。
- 侧栏在 184px 与 72px 之间收起/恢复，导航文字 opacity 在 1 与 0 之间过渡，`aria-expanded` 同步更新；系统 reduced-motion 偏好下关闭动画。
- 收起侧栏下，沙箱图标与按钮中心横纵偏差均为 0px；“商品订单” hover 标签 opacity 为 1，键盘 focus 使用同一显示规则。
- 工作台和预约页在预约“已完成”时均不存在详情按钮，业务时间线显示“预约已完成 · 无后续业务动作”。
- 店长看板“全部审计”文字/箭头中心偏差为 0px；最近经营证据时间线顶部间距为 12px。
- 店长员工表、总部商品/机型表及总部人员汇总表的顶部间距均为 14px。
- 总部门店颜色标记与首行中心偏差为 0.5px 以内。
- “编辑 标准型”展示档案名称、体验规格、体验描述和当前引用；“创建/编辑商品范围未来配置”展示商品资料、门店范围、销售状态、低库存阈值和配置说明。
- 门店展示资料与“保存未来配置”之间测得 14px 间距，保存动作使用门店展示资料专用确认内容。
- “创建座位报修”中的座位与优先级均为下拉框；优先级提供普通、较高、紧急三个合法选项。
- 当前全部 16 种结构化 action kind 均有对应业务 resolver；店长库存、门店配置、员工排班、考勤和交接入口不会再打开“业务命令”通用表单。
- “创建背景员工”展示工作名、员工编号、角色、任职状态与固定所属门店；“创建未来班次”展示员工、日期、跨午夜时间和覆盖预览。
- 考勤更正保留原始考勤事实并要求原因；缺勤记录与交接快照使用只读查看弹窗。
- 排班标签栏与覆盖告警、覆盖告警与半小时网格之间均测得 14px。
- `1024 × 768` 下盘点弹窗尺寸为 `560 × 542`，完整位于视口内，正文 `clientHeight` 与 `scrollHeight` 均为 412px。

## Implementation Checklist

- [x] 三种管理角色与权限语境覆盖。
- [x] 核心经营闭环可交互。
- [x] 视觉令牌与品牌资产落地。
- [x] 桌面、窄桌面与移动公开入口复核。
- [x] 构建、Sites 打包测试与控制台检查通过。
- [x] 第二轮 6 条浏览器批注逐项验证并留存交互证据。
- [x] 第三轮 14 条浏览器批注逐项验证并留存交互证据。
- [x] 第四轮 3 条浏览器批注逐项验证，并完成全部业务弹窗入口审计。

## Follow-up Polish

- 可在接入真实接口后补充长姓名、超长门店名和更大字号缩放的专项回归；当前演示数据下不阻塞交付。

final result: passed
