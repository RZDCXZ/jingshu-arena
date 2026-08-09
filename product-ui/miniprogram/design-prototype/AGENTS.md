# 小程序正式设计参考指南

## 资料与决策

规划或实现小程序正式设计参考变更前，先读完根目录 `AGENTS.md` 要求的小程序参考资料，包括当前 QA 状态。产品契约决定行为，选定图片决定视觉方向，覆盖记录决定可到达的页面、状态和旅程。

功能决策写入 `../prod.md`，覆盖变化写入 `design-coverage.md`，渲染或交互证据写入 `design-qa.md`。本文件只记录工作流、编辑边界和持久运行时不变量。

## 预览

- **ChatGPT 工作模式：**运行 `sites-preview start "$PWD"`，在云端浏览器打开 `http://terminal.local:4173/`，验证渲染结果和主要交互。保持预览供用户查看；说明检查位置，不要把仅终端可访问的本地地址当作聊天链接。
- **Codex Desktop：**启动本地服务，在应用内浏览器打开并验证预览，然后提供可点击的本地地址。
- **发布：**除非用户明确要求分享、发布或部署，否则保持本地工作。当前环境允许时，为用户启动服务。

## 交付门禁

每次交付正式设计参考前：

1. 运行 `npm run check:runtime`。
2. 运行 `npm run test:runtime`。
3. 运行 `npm run build`。
4. 打开每个受影响状态，完成每项受影响的主要交互，并确认浏览器控制台没有本次变更引起的警告或错误。
5. 布局、安全区、滚动、设备外壳、键盘行为或触控交互发生变化时，同时验证 iPhone 和 Pixel 10。

交付到 Sites 时，还要运行 `npm run test:sites`，并确认 `dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json` 以及源码中的 `.openai/hosting.json` 都存在。

所有必要命令通过，且变化后的视觉或交互证据已记录到 `design-qa.md` 后，交付才算完成。

## 竞枢设计不变量

- 已批准的视觉源为 `design/reference/selected-reservation-first-home.png`。
- 视觉保真调整只作用于设备屏幕内由应用负责的内容；设备外壳以移动运行时为真相源。
- 保持管理系统的深海军蓝、青色反馈、青柠色主操作、克制的琥珀/红色语义、紧凑圆角、细分隔线和运营型排版。
- 座位预约是产品级主任务。首页优先展示“预约座位 / 查找可订座位”。
- 报修和柜台商品操作是上下文相关的次要动作，只在存在符合条件的有效预约时提供。
- 覆盖范围包括 `MP-00` 至 `MP-18`、`MP-19` 系统状态画廊，以及可点击的预约、订单、报修和重置旅程。

## 编辑边界

- 应用专属 UI 写入 `src/Prototype.tsx` 和 `src/prototype.css`。
- 受保护的运行时文件包括 `src/App.tsx`、`src/main.tsx`、`src/styles.css`、`src/mobile/`、`public/assets/iphone/`、`public/assets/android/`、`public/assets/status/`、`vite.config.ts`、`worker/index.js` 和 `scripts/prepare-sites-build.mjs`。
- 只有用户明确要求修改运行时时才改动受保护文件。先验证新行为，再使用现有锁定脚本，只更新受影响文件的运行时锁哈希。
- `npm run check:runtime` 失败表示必须恢复受保护运行时，或有意更新运行时；该检查始终是权威门禁。
- 保留现有移动运行时和 Sites 构建流水线，不替换项目脚手架。

## 运行时与组件契约

使用或修改 `PhoneFrame`、`StatusBar`、`MobileScroll`、`FlowStack`、`Carousel`、键盘感知字段、键盘联动表面或 `BottomSheet` 前，完整阅读 [`src/mobile/COMPONENTS.md`](src/mobile/COMPONENTS.md)。该文件是设备外壳、布局归属、手势、键盘内边距（inset）和组件 API 的唯一真相源。
