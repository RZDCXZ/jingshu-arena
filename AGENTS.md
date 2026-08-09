## Agent skills

### Issue tracker

创建、获取、分流、认领、评论或解决本地议题前，先阅读 [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)。该文档定义精确的文件布局、元数据、工作前沿和完成规则。

### Triage labels

使用 `/triage` 或改变议题路由与生命周期前，先阅读 [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。该文档定义 `Category`、`Triage` 与 `State` 的本地映射和允许值。

### Domain docs

探索或修改领域词汇、业务规则、状态机、不变量或架构前，遵循 [`docs/agents/domain.md`](docs/agents/domain.md)。交付前必须覆盖每个受影响的词汇表术语和已接受 ADR。

## 产品 UI 工作

规划、实现或审查面向用户的 UI 前，先确定对应产品表面，并阅读其功能契约、原型指南、选定视觉源、覆盖记录和当前 QA 状态。

用户明确请求 Product Design 时，优先使用可用的 Product Design 路由；不可用时，使用同一套参考资料作为降级路径，并说明未能运行的插件专属工作流或验证。如果选定视觉源已无法表达本次目标或用户结果，先解决设计简报，再开始实现。

`product-ui/*/design-prototype/` 是长期维护的正式产品设计参考，不是 Matt `/prototype` 生成的抛弃式原型。调用 `/prototype` 时，在现有应用路由约定下另建明确标注为临时的 route/目录，并使用独立的 throwaway branch；无测试、快速丢弃的规则只适用于该临时产物，正式设计参考继续执行下述构建和 QA 门禁。

#### 小程序

- 功能契约：[`product-ui/miniprogram/prod.md`](product-ui/miniprogram/prod.md)
- 正式设计参考与运行指南：[`product-ui/miniprogram/design-prototype/AGENTS.md`](product-ui/miniprogram/design-prototype/AGENTS.md)
- 选定视觉源：[`product-ui/miniprogram/design-prototype/design/reference/selected-reservation-first-home.png`](product-ui/miniprogram/design-prototype/design/reference/selected-reservation-first-home.png)
- 覆盖记录：[`product-ui/miniprogram/design-prototype/design-coverage.md`](product-ui/miniprogram/design-prototype/design-coverage.md)
- 当前 QA 状态：[`product-ui/miniprogram/design-prototype/design-qa.md`](product-ui/miniprogram/design-prototype/design-qa.md)

#### 管理系统

- 功能契约：[`product-ui/management-system/prod.md`](product-ui/management-system/prod.md)
- 正式设计参考与运行指南：[`product-ui/management-system/design-prototype/AGENTS.md`](product-ui/management-system/design-prototype/AGENTS.md)
- 选定视觉源：[`product-ui/management-system/design-prototype/design/reference/selected-night-operations-console.png`](product-ui/management-system/design-prototype/design/reference/selected-night-operations-console.png)
- 覆盖记录：[`product-ui/management-system/design-prototype/design-coverage.md`](product-ui/management-system/design-prototype/design-coverage.md)
- 当前 QA 状态：[`product-ui/management-system/design-prototype/design-qa.md`](product-ui/management-system/design-prototype/design-qa.md)

当前议题定义本次变更范围。它不得静默覆盖 `CONTEXT.md`、已接受 ADR 或 RC 规格；发现冲突时应明确指出，并在同一次变更中更新受影响的契约。

每种含义只记录一次：

- 功能行为、页面职责或信息层级 → 对应的 `prod.md`。
- 页面、状态或旅程覆盖 → 对应的 `design-coverage.md`。
- 选定视觉源、渲染保真度或交互测试证据 → 对应的 `design-qa.md`。
- 原型运行时或组件契约 → 作用域内的 `AGENTS.md` 或其指向的组件参考文档。

当对应原型仍可构建和运行、所有受影响状态及主要交互均已在规定视口完成验证，并且上述受影响文档全部更新后，UI 变更才算完成。
