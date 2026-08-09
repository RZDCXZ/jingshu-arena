# 小程序设计 QA

- 状态：`current`（当前有效）
- 检查日期：2026-08-09
- 已验证契约版本：`product-ui/miniprogram/prod.md` 1.1
- 验证范围：[`02 — 统一跨端设计基线与合成命名`](../../../.scratch/jingshu-basic-rc/issues/02-unify-design-baseline.md)

## 对照目标

- 视觉真相源路径：`design/reference/selected-reservation-first-home.png`
- 归一化视觉源：`design/reference/selected-reservation-first-home-393x852.png`
- 浏览器渲染实现截图：`design/implementation-ticket02-home-393x852.png`
- 浏览器视口：Codex 应用内浏览器 `1800 × 1600 CSS px`，其中 `[data-phone-screen]` 实测 `393 × 852 CSS px`
- 源图像素：`853 × 1844 px`，按 Lanczos 下采样为 `393 × 852 px`
- 实现像素：`393 × 852 px`
- 密度归一化：`deviceScaleFactor = 1`；按浏览器读取的设备屏幕矩形裁取 1:1 内容区域
- 状态：深色主题、iPhone、无当前预约、立即预约、棱镜旗舰店、19:30、2 小时、竞技型、预计 ¥30.00

## 对比证据

- 全视图合并对比：`design/qa-ticket02-home-comparison.png`，左侧为归一化视觉源，右侧为浏览器实现。
- 重点区域合并对比：`design/qa-ticket02-home-focus.png`，聚焦品牌、人物、演示边界、预约标题、进度、模式切换与门店字段。
- 三店名称与城市状态：`design/implementation-ticket02-stores-393x852.png`。

## Findings

- 没有仍需处理的 P0、P1 或 P2 差异。
- 客观检查：MP-03 同时显示栖光市、棱镜旗舰店、星桥标准店与极点新店；三个门店标题的 `scrollWidth/clientWidth` 与 `scrollHeight/clientHeight` 检查均无裁切。96/64/40 座和三段营业时间保持不变。
- 可接受差异：实现保留移动运行时提供的真实 iOS 状态栏、刘海、安全区与设备圆角，因此内容比无系统状态栏的源视觉更紧凑；预约信息层级、字段顺序、主行动、颜色与信息密度仍与选定方向一致。

## 必查保真表面

- 字体与排版：Noto Sans SC Variable 与系统回退保持不变；统一后的门店名和城市说明没有截断、拥挤、破坏性换行或错误字重。
- 间距与布局节奏：`393 × 852` 画布、底部导航、固定行动区与安全区正常；三店卡片可纵向滚动，第三张卡片不被固定导航永久遮挡。
- 颜色与视觉令牌：深海军蓝、青色与荧光青柠继续映射到背景、进度、选中态和主操作；本次没有改变颜色令牌。
- 图片质量与资源保真度：品牌标志与报修耳机样例继续使用仓库位图；图标继续使用 Phosphor，没有新增 CSS 图形、手写 SVG、emoji 或占位图片。
- 文案与内容：正式地点统一为栖光市、棱镜旗舰店、星桥标准店与极点新店；人物、商品、金额、图片与事件仍为虚构合成数据，模拟支付继续明确“不扣款”。
- 状态与交互：预约、柜台商品、座位报修和本地重置四条流程均可完成；图片权限回退可选择内置虚构样例图。
- 响应式与无障碍：设备屏幕实测 393×852；表单、状态与按钮保留语义名称，主要触控目标和安全区未回归。

## 浏览器与交互验证

- 应用内浏览器控制台 `warning/error`：0。
- 页面覆盖：`MP-00` 至 `MP-19` 逐屏打开，20/20 的请求 ID 与渲染 `data-screen-id` 一致且均有可见内容。
- 预约流程：首页 → 选座位 → 预约确认 → 模拟支付（不扣款） → 预约详情通过。
- 商品流程：预约推进到使用中 → 柜台商品 → 购物车 → 订单确认 → 商品订单详情通过。
- 报修流程：使用中预约 → 座位报修 → 内置样例图 → 提交 → 报修详情通过。
- 重置流程：会员 → 本地演示设置 → 二次确认 → 标准预约首页通过。
- 运行时与构建：`npm run check:runtime` 通过（28 个受保护文件）；`NO_PROXY='*' no_proxy='*' npm run test:runtime` 8/8 通过；`npm run build` 通过；`npm run test:sites` 4/4 通过。

## 对比历史

- ticket 02 第 1 次合并对比没有发现可执行的 P0/P1/P2，因此没有为视觉问题修改样式，也不需要第二轮对比。
- 本次改名前的已解决对比轮次与批注证据保存在 [`design-qa-history.md`](design-qa-history.md)。

## Open Questions

- 无阻塞问题。

## Implementation Checklist

- [x] 栖光市与三店统一名称在正式页面中完整显示。
- [x] MP-00 至 MP-19 与四条核心流程可操作。
- [x] 同视口全视图与重点区域合并对比完成。
- [x] 运行时、构建、Sites 包装与控制台检查通过。

final result: passed
