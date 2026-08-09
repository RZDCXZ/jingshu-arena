# 竞枢管理端设计 QA

- 状态：`current`（当前有效）
- 检查日期：2026-08-09
- 已验证契约版本：`product-ui/management-system/prod.md` 1.1
- 验证范围：[`03 — 公开入口与版本化三店沙箱`](../../../.scratch/jingshu-basic-rc/issues/03-public-entry-sandbox.md)

## 对照目标

- 视觉基线：`design/reference/selected-night-operations-console.png` 及其正式可运行公开入口状态。
- 正式原型源截图：`design/source-ticket03-public-entry-1440.png`、`design/source-ticket03-public-entry-360.png`。
- 生产实现截图：`design/implementation-ticket03-public-entry-1440.png`、`design/implementation-ticket03-public-entry-360.png`。
- 视口：Codex 应用内浏览器 `1440 × 1024 CSS px`、`360 × 800 CSS px`。
- 密度：两侧均为 `deviceScaleFactor = 1`；每组源图与实现使用相同 CSS 视口和像素尺寸。
- 状态：`WEB-G00` 公开入口 / 未创建沙箱 / 页面顶部 / 无弹窗。

## 对比证据

- 桌面全视图合并对比：`design/qa-ticket03-public-entry-comparison-1440.png`，左侧为正式原型，右侧为生产实现。
- 桌面重点区域合并对比：`design/qa-ticket03-public-entry-focus-1440.png`，聚焦品牌、产品叙事、边界提示与主故事概览。
- 移动端合并对比：`design/qa-ticket03-public-entry-comparison-360.png`，左侧为正式原型，右侧为生产实现。

## Findings

- 没有仍需处理的 P0、P1 或 P2 差异。
- 客观检查：桌面两侧的标题内容宽度均为 `714px`，主故事卡均为 `476 × 240px`；移动端两侧内容宽度均为 `345px`，无横向溢出，标题、主故事卡与下一分区边界落点一致。
- 契约要求的有意差异：生产实现把顶栏标记写为“演示数据”，并在原型三条摘要之外补充“不连接真实设备”，用于持续满足 `WEB-G00` 的明确边界；布局、视觉令牌和交互层级未因此偏离正式原型。

## 必查保真表面

- 字体与排版：生产实现加载 Noto Sans SC Variable；桌面与移动端标题字号、字重、字距、行高和换行位置均与正式原型一致。
- 间距与布局节奏：桌面 hero、主故事卡、角色标题及四角色卡栅格对齐；移动端按正式断点变为单列，首屏没有裁切或水平滚动。
- 颜色与视觉令牌：深海军蓝、青色、青柠、琥珀及边框层级复用正式管理端令牌；推荐角色仍只使用青柠强调。
- 图片质量与资源保真度：品牌标志使用正式原型仓库 PNG；界面图标使用 Phosphor，没有占位资产、CSS 图形、手写 SVG 或文本符号替代。
- 文案与内容：产品用途、虚构数据、无需注册、模拟支付不扣款、不接入真实设备、四角色和顾客推荐起点均可见；三店状态统一为栖光市、棱镜旗舰店、星桥标准店和极点新店并持续标注演示数据。
- 状态与交互：桌面只读了解、角色选择、创建中、成功、失败、超时和安全重试均可操作；失败或超时不展示伪造成功。
- 响应式与无障碍：角色入口使用语义按钮，状态页使用 live region，弹窗具备 dialog 语义和可见关闭动作，键盘焦点及 reduced-motion 降级保留。

## 浏览器与交互验证

- 应用内浏览器控制台 `warning/error`：0。
- 只读了解：打开说明弹窗后仍停留公开地址，页面本身和只读动作不发起创建请求。
- 真实创建：选择顾客后通过同源 Web 路由调用 Hono 与真实 Postgres，返回栖光市固定三店、`Schema 2`、`Seed 2026-08-09.1`；地址仍为 `/`，查询与片段中无沙箱标识、会话凭证或可写能力。
- 幂等恢复：真实 API 首次请求为 `201 / replayed=false`，同一键和负载重试为 `200 / replayed=true`，两次均只返回三店安全视图。
- 自动化交互：`tests/e2e/public-entry.spec.ts` 4/4 通过，覆盖未选择角色不创建、创建中到成功、完整回滚后的原键重试和超时不伪造成功。
- 构建：生产 Web `pnpm --filter @jingshu/web build` 通过；正式原型 `npm run build` 通过；Sites 包装测试 `npm run test:sites` 4/4 通过。

## 对比历史

- 第 1 轮发现 P2：生产页未加载正式 Noto 字体、桌面原生滚动条占用 `15px` 且标题使用 balanced wrapping，导致标题提前换行；主故事概览也比正式原型更复杂。
- 修复：接入正式字体，保留滚动能力但消除桌面滚动条占位，恢复正常换行策略，并让主故事卡及边界卡结构回到正式原型；移动断点同步正式横向内边距、字号和滚动宽度。
- 修复后使用本文件列出的三组同状态合并证据复核，P0/P1/P2 全部清零。
- ticket 02 及更早的已解决轮次继续保存在 [`design-qa-history.md`](design-qa-history.md) 和 Git 历史中。

## Open Questions

- 无阻塞问题。

## Implementation Checklist

- [x] `WEB-G00` 公开入口与 `WEB-G01` 创建状态均可操作。
- [x] 三店名称、城市、座位规模、营业时间、schema 与 seed 版本一致。
- [x] `1440 × 1024`、`360 × 800` 同视口全视图及重点区域合并对比完成。
- [x] 真实浏览器、真实 API/Postgres、错误/超时自动化和控制台检查完成。
- [x] 生产构建、正式原型构建与 Sites 包装测试通过。

final result: passed
