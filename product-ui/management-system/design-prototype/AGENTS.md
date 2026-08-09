# 管理端正式设计参考指南

## 资料与决策

规划或实现管理端正式设计参考变更前，先读完根目录 `AGENTS.md` 要求的管理系统参考资料，包括当前 QA 状态。

功能决策写入 `../prod.md`，覆盖变化写入 `design-coverage.md`，渲染或交互证据写入 `design-qa.md`。本文件只记录工作流、编辑边界和持久原型不变量。

## 预览与交付

启动本地服务，并在当前环境可用的浏览器中打开预览。自行验证受影响状态和交互；当前环境能提供可点击地址时，将本地预览交给用户。

每次交付正式设计参考前：

1. 运行 `npm run build`。
2. 在 `1440 × 1024` 和 `1024 × 768` 下验证每个受影响状态及主要交互。
3. 公开入口或顾客 H5 发生变化时，还要验证 `360px`。
4. 确认浏览器控制台没有本次变更引起的警告或错误。

交付到 Sites 时，还要运行 `npm run test:sites`，并确认 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json` 都存在。除非用户明确要求分享、发布或部署，否则保持本地工作。

所有必要命令通过，且变化后的视觉或交互证据已记录到 `design-qa.md` 后，交付才算完成。

## 编辑边界

- 应用 UI 写入 `src/`。
- 保留 `.openai/hosting.json`、`worker/index.js`、`scripts/prepare-sites-build.mjs` 和 `tests/sites-worker.test.mjs`，确保同一原型继续兼容 Sites。

## 原型不变量

- 产品行为以 `../prod.md` 为准。
- 选定视觉源为 `design/reference/selected-night-operations-console.png`。
- 保持深色、高对比度的夜间运营方向：炭灰/海军蓝表面、克制的青色信息强调、青柠色主操作、紧凑描边图标、连续队列表面和右侧上下文检查器。
- 默认 `1440 × 1024` 状态应忠实还原选定的店员工作台；店员、店长、总部和共享沙箱流程使用同一视觉语言。
- 该原型是管理侧交付物。只有跨角色上下文确有需要时，才展示顾客小程序或 H5 内容。
