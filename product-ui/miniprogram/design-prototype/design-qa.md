# Design QA

检查日期：2026-08-08

## Comparison Target

- source visual truth path: `design/reference/selected-reservation-first-home.png`
- normalized source: `design/reference/selected-reservation-first-home-393x852.png`
- implementation URL: `http://localhost:4173/?screen=home`
- implementation screenshot path: `design/implementation-home-final.png`
- viewport: Codex in-app Browser `900 × 1100`，其中 `[data-phone-screen]` 实测 `393 × 852 CSS px`
- pixels and density: 源图 `853 × 1844` 下采样为 `393 × 852`；实现截图 `393 × 852`；两者均按 `deviceScaleFactor 1` 的等像素输入比较
- state: 深色主题、iPhone、无当前预约、立即预约、棱镜旗舰店、19:30、2 小时、竞技型、预计 ¥30.00

## Evidence

- full-view comparison evidence: `design/qa-comparison-pass3.png`，左侧为归一化视觉基线，右侧为最终实现
- focused region comparison evidence: `design/qa-comparison-focus-pass3.png`，聚焦预约标题、步骤、模式切换、四个条件和主行动
- interaction evidence: `design/interaction-seat-map-final.png`、`design/interaction-order-confirm-final.png`、`design/interaction-repair-keyboard-final.png`
- annotation-fix evidence: `design/annotation-time-picker-final.png`、`design/annotation-conditions-time-final.png`、`design/annotation-duration-single-final.png`、`design/annotation-machine-single-final.png`

## Findings

- 没有仍需处理的 P0、P1 或 P2 差异。
- 可接受差异：实现保留 `mobile-app` 模板的真实 iOS 状态栏、刘海与安全区，因此内容比无系统状态栏的源视觉更紧凑；预约层级、字段顺序、主行动、配色和信息密度保持一致。

## Required Fidelity Surfaces

- Fonts and typography: 使用 Noto Sans SC Variable 与系统回退；标题、数字金额、正文和 10–12px 辅助文字的字重与层级清楚，无截断或破坏性换行。
- Spacing and layout rhythm: 393×852 画布无横向溢出；首页、选座固定栏、订单固定栏和键盘状态均保持安全区；卡片间距和分隔线维持紧凑赛事终端节奏。
- Colors and visual tokens: 深海军蓝、青色与荧光青柠映射到背景、流程状态、主行动和关键金额；主按钮使用与源视觉一致的轻微青柠渐变。
- Image quality and asset fidelity: 品牌标志使用真实仓库位图；报修样例为清晰无品牌虚构耳机照片，裁切与深色界面一致；图标统一来自 Phosphor，没有 emoji、CSS 图形或手写 SVG 替代。
- Copy and content: 首页明确“本地演示 / 不与 Web 同步”，支付操作反复标注“不扣款”，报修提示不填写真实个人信息；商品和报修不争夺首页主层级。
- Icons and controls: 图标风格、线宽、尺寸、对齐统一；选择、禁用、处理中、成功、警告和错误均有非颜色文本证据。
- Accessibility and resilience: 语义按钮、表单标签、图片替代文本、状态文本和至少 44px 的主触控目标已覆盖；iPhone 与 Pixel 10 均检查通过。

## Comparison History

### Pass 1

- evidence: `design/qa-comparison-pass1.png`
- [P2] 首页当前步骤使用青柠色，偏离源视觉的青色流程语义。
- [P2] 首页主按钮为纯色，缺少源视觉的轻微横向亮度变化。
- fix: 在 `src/prototype.css` 将当前步骤映射到 `--js-cyan`，并给 `.primary-button` 加入受控青柠渐变。

### Pass 2

- evidence: `design/qa-comparison-pass2.png` 与 `design/qa-comparison-focus-pass2.png`
- result: 先前两项 P2 已消除；没有新的可操作 P0/P1/P2 差异。

### Pass 3 · 浏览器批注回归

- evidence: `design/qa-comparison-pass3.png`、`design/qa-comparison-focus-pass3.png` 与四张 `design/annotation-*-final.png`。
- [P1] 首页底部时间面板和 MP-05 只给少量预设时刻，不能自由选择契约允许的半小时时段。
  - fix: 两处统一为未来 7 天日期条、00–23 时滚动选择、00/30 分单选、前后 30 分钟微调与实时结束时间；今天已过去片段禁用。
- [P1] 时长与机型底部面板会同时绘制默认项和当前项两个勾选状态。
  - fix: 时长改为唯一数值的步进器 + 1–8 小时滑杆；门店、机型和 MP-05 区域/机型统一为真实单选状态，任一组只有一个 `aria-checked=true`。
- [P2] 重复点击当前底部 Tab 会再次执行根页面替换。
  - fix: 当前 Tab 点击直接 no-op；浏览器回归中连续点击两次前后 `.flow-screen` 均保持 `1`，切换到其他 Tab 后其重复点击也保持 `1`。
- result: 四条批注均关闭；没有新的可操作 P0/P1/P2 差异。

### Interaction QA fixes

- [P1] 点击靠近屏幕底部的行动后，浏览器焦点会让模板设备容器产生 `scrollTop`，导致下一屏状态栏和标题被裁切。
  - fix: 仅对包含竞枢原型的 `.device-screen` 使用 `overflow: clip`，业务滚动仍由 `MobileScroll` 承担。
  - post-fix evidence: `design/interaction-seat-map-final.png`；设备 `scrollTop = 0`，状态栏、标题和固定确认栏完整。
- [P1] 购物车添加第三件商品后，MP-11 内容显示 ¥25.00，但固定提交栏仍写死 ¥13.00。
  - fix: 订单提交栏、详情和行程摘要统一由当前购物车快照计算商品合计、¥5 体验券与应付金额。
  - post-fix evidence: `design/interaction-order-confirm-final.png`；内容区和固定栏均为 ¥25.00。

## Primary Interactions Tested

- 立即预约、选座、预约确认、模拟支付处理中/成功、预约详情。
- 首页与 MP-05 的日期/小时/分钟联动、跨日结束预览、1–8 小时时长、机型单选、动态半小时价格与确认页传递。
- 当前 Tab 连续点击不重入；切换到其他 Tab 后导航仍正常，重复点击新当前 Tab 同样 no-op。
- 推进到已到店/使用中；柜台商品数量、购物车、动态订单金额与订单详情。
- 座位报修输入、模拟键盘、相册权限拒绝、内置样例图、提交与公开处理动态。
- 四个一级导航、会员中心、本地设置、二次确认重置与恢复标准故事。
- `MP-00` 至 `MP-19` 逐屏直接渲染；`INDEX` 审阅索引。
- iPhone 与 Pixel 10 安全区；浏览器控制台 `warn/error` 为空。

## Verification

- `npm run check:runtime`: passed，28 个受保护运行时文件完整。
- `npm run test:runtime`: passed，8/8。
- `npm run test:sites`: passed，4/4。
- `npm run build`: passed；TypeScript、Vite 与 Sites 打包成功。

## Open Questions

- 无阻塞问题。

## Implementation Checklist

- [x] 预约优先首页与选定视觉一致。
- [x] MP-00 至 MP-19 完整且可从索引审阅。
- [x] 四条核心顾客故事可操作并有真实状态反馈。
- [x] 视觉、交互、运行时、构建和控制台检查通过。

## Follow-up Polish

- P3：若后续准备公开展示，可为 MP-03 门店卡补充同一风格的三张虚构场馆照片；当前图标式门店卡不影响设计验收。

final result: passed
