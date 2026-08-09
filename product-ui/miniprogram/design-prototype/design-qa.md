# 小程序设计 QA

- 状态：`current`（当前有效）
- 检查日期：2026-08-08
- 已验证契约版本：`product-ui/miniprogram/prod.md` 1.0
- 当前契约兼容性：1.1 版只调整文档路由，并采用已存在于已验证小程序输出中的地点名称。
- 已验证实现提交：`57a7e0b593db30a6ecc9244ab47afd4f45d538cd`
- 失效条件：选定视觉源、可见内容、渲染状态或已测试交互发生任何后续变化。[`议题 02`](../../../.scratch/jingshu-basic-rc/issues/02-unify-design-baseline.md) 只有在其实现改变小程序可见输出时，才需要重新验证本记录。

## 对照目标

- 视觉真相源路径：`design/reference/selected-reservation-first-home.png`
- 归一化视觉源：`design/reference/selected-reservation-first-home-393x852.png`
- 实现地址：`http://localhost:4173/?screen=home`
- 实现截图路径：`design/implementation-home-final.png`
- 视口：Codex 应用内浏览器 `900 × 1100`，其中 `[data-phone-screen]` 实测 `393 × 852 CSS px`
- 像素与密度：源图 `853 × 1844` 下采样为 `393 × 852`；实现截图 `393 × 852`；两者均按 `deviceScaleFactor 1` 的等像素输入比较
- 状态：深色主题、iPhone、无当前预约、立即预约、棱镜旗舰店、19:30、2 小时、竞技型、预计 ¥30.00

## 证据

- 全视图对比证据：`design/qa-comparison-pass3.png`，左侧为归一化视觉基线，右侧为最终实现
- 重点区域对比证据：`design/qa-comparison-focus-pass3.png`，聚焦预约标题、步骤、模式切换、四个条件和主行动
- 交互证据：`design/interaction-seat-map-final.png`、`design/interaction-order-confirm-final.png`、`design/interaction-repair-keyboard-final.png`
- 批注修复证据：`design/annotation-time-picker-final.png`、`design/annotation-conditions-time-final.png`、`design/annotation-duration-single-final.png`、`design/annotation-machine-single-final.png`

## 检查结果

- 没有仍需处理的 P0、P1 或 P2 差异。
- 可接受差异：实现保留 `mobile-app` 模板的真实 iOS 状态栏、刘海与安全区，因此内容比无系统状态栏的源视觉更紧凑；预约层级、字段顺序、主行动、配色和信息密度保持一致。

## 必查保真表面

- 字体与排版：使用 Noto Sans SC Variable 与系统回退；标题、数字金额、正文和 10–12px 辅助文字的字重与层级清楚，无截断或破坏性换行。
- 间距与布局节奏：393×852 画布无横向溢出；首页、选座固定栏、订单固定栏和键盘状态均保持安全区；卡片间距和分隔线维持紧凑赛事终端节奏。
- 颜色与视觉令牌：深海军蓝、青色与荧光青柠映射到背景、流程状态、主行动和关键金额；主按钮使用与源视觉一致的轻微青柠渐变。
- 图片质量与资源保真度：品牌标志使用真实仓库位图；报修样例为清晰无品牌虚构耳机照片，裁切与深色界面一致；图标统一来自 Phosphor，没有 emoji、CSS 图形或手写 SVG 替代。
- 文案与内容：首页明确“本地演示 / 不与 Web 同步”，支付操作反复标注“不扣款”，报修提示不填写真实个人信息；商品和报修不争夺首页主层级。
- 图标与控件：图标风格、线宽、尺寸、对齐统一；选择、禁用、处理中、成功、警告和错误均有非颜色文本证据。
- 无障碍与韧性：语义按钮、表单标签、图片替代文本、状态文本和至少 44px 的主触控目标已覆盖；iPhone 与 Pixel 10 均检查通过。

## 对比历史

已解决的对比轮次及其修复证据位于 [`design-qa-history.md`](design-qa-history.md)。只有调查回归问题或追溯现有实现决策原因时，才需要阅读该历史记录。

## 已测试的主要交互

- 立即预约、选座、预约确认、模拟支付处理中/成功、预约详情。
- 首页与 MP-05 的日期/小时/分钟联动、跨日结束预览、1–8 小时时长、机型单选、动态半小时价格与确认页传递。
- 当前 Tab 连续点击不重入；切换到其他 Tab 后导航仍正常，重复点击新的当前 Tab 同样不执行任何动作。
- 推进到已到店/使用中；柜台商品数量、购物车、动态订单金额与订单详情。
- 座位报修输入、模拟键盘、相册权限拒绝、内置样例图、提交与公开处理动态。
- 四个一级导航、会员中心、本地设置、二次确认重置与恢复标准故事。
- `MP-00` 至 `MP-19` 逐屏直接渲染；`INDEX` 审阅索引。
- iPhone 与 Pixel 10 安全区；浏览器控制台 `warn/error` 为空。

## 验证结果

- `npm run check:runtime`：通过，28 个受保护运行时文件完整。
- `npm run test:runtime`：通过，8/8。
- `npm run test:sites`：通过，4/4。
- `npm run build`：通过；TypeScript、Vite 与 Sites 打包成功。

## 待确认问题

- 无阻塞问题。

## 实现检查清单

- [x] 预约优先首页与选定视觉一致。
- [x] MP-00 至 MP-19 完整且可从索引审阅。
- [x] 四条核心顾客故事可操作并有真实状态反馈。
- [x] 视觉、交互、运行时、构建和控制台检查通过。

## 后续优化

- P3：若后续准备公开展示，可为 MP-03 门店卡补充同一风格的三张虚构场馆照片；当前图标式门店卡不影响设计验收。

最终结果：`passed`（通过）
