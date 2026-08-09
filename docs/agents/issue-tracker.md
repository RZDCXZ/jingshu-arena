# 本地 Markdown 议题跟踪器

本仓库的议题和规格位于 `.scratch/<feature-slug>/`。本文档是 Matt `/to-spec`、`/to-tickets`、`/triage` 与 `/wayfinder` 的本地存储适配；技能模板与本文档不一致时，以本文档的落盘协议为准。

## 文件布局

- 功能规格：`.scratch/<feature-slug>/spec.md`
- 实现议题：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号
- 每个实现议题单独一个文件；合并式议题清单文件不属于有效议题
- 评论和验证证据追加到 `## Comments` 下

功能规格、实现议题、wayfinder map 和 wayfinder child 是四类不同产物。按下文对应协议存储字段，不在产物类型之间混用元数据。

## 功能规格：`/to-spec`

`/to-spec` 将规格写入 `.scratch/<feature-slug>/spec.md`。标题后使用以下精确行记录规格已经 `ready-for-agent`：

```markdown
# 功能标题

Status: ready-for-agent
```

这里的 `Status` 只表示规格可供代理继续使用，例如交给 `/to-tickets` 拆分；规格本身不是实现议题，不参与认领、解决或工作前沿计算。`spec.md` 不使用 `Triage`、`State`、`Category`、`Blocked by` 或 `## Comments`。实现议题则使用下一节的 `Triage + State` 协议。

## 实现议题元数据

每个实现议题都在文件顶部附近使用以下精确字段。字段名和值属于机器协议，正文说明使用中文：

```markdown
**Blocked by:** None — can start immediately.

**Triage:** ready-for-agent

**State:** open
```

- `Category`（请求分类）仅在议题经过 `/triage` 后存储，精确值为 `bug` 或 `enhancement`。每个已分流议题必须恰好有一个 `Category`；由 `/to-tickets` 直接生成且无需 `/triage` 的实现议题可以省略该字段。
- `Triage`（分流）记录下一步需要谁或什么。取值必须来自 [`triage-labels.md`](triage-labels.md)。
- `State`（执行状态）记录工作进度：`open`、`claimed` 或 `resolved`。
- `Blocked by`（依赖）填写 `None — can start immediately.`，表示“无依赖，可立即开始”；也可以填写用英文分号分隔的依赖，例如 `01 — 标题; 02 — 标题.`。
- 只有被引用议题的字段为 `**State:** resolved`，该依赖才算解决。

### `/to-tickets` 模板转换

Matt `/to-tickets` 的本地模板会生成 `**Status:** ready-for-agent`。发布到本仓库时，必须删除该行并在同一位置写入：

```markdown
**Triage:** ready-for-agent

**State:** open
```

实现议题始终存储 `Triage + State`，不存储 `Status`；同一实现议题中不得同时出现 `Status` 和 `Triage`。转换完成的判据是每个新实现议题恰好包含一个 `Triage`、一个 `State`，且不包含 `Status`。

### `/triage` 分类转换

Matt `/triage` 的 category role 映射到本仓库的 `Category`，state role 映射到 `Triage`；本仓库自己的 `State` 继续单独记录执行生命周期。分流完成时，在议题顶部附近新增以下二选一字段，并按 [`triage-labels.md`](triage-labels.md) 更新 `Triage`：

```markdown
**Category:** bug
```

```markdown
**Category:** enhancement
```

若议题已有 `Category`，更新现有行而不是追加第二行。

## 普通议题模板

```markdown
# NN — 标题

**What to build:** <一个明确结果>

**Blocked by:** <无依赖或编号依赖>

**Triage:** <允许的分流值>

**State:** open

- [ ] <可检查的验收条件>

## Comments
```

该模板适用于 `/to-tickets` 直接生成的实现议题。经 `/triage` 处理时，在 `Blocked by` 与 `Triage` 之间加入一个 `Category` 字段。每条验收条件都必须描述可观察的结果。验证命令、人工证据和未解决的限制写入 `## Comments`，不要写入元数据。

## 操作

### 发布到议题跟踪器

先判断产物类型：

- 功能规格替换或更新 `.scratch/<feature-slug>/spec.md`。
- 实现议题使用 `.scratch/<feature-slug>/issues/` 下下一个未使用的两位编号，采用上方模板，并执行 `/to-tickets` 模板转换。
- 寻路工作使用[寻路操作](#寻路操作)中的映射（map）和子议题（child）布局。

文件位于精确路径、元数据使用允许值、每个依赖都指向现有议题、每条验收条件均可观察且存在 `## Comments` 后，发布才算完成。实现议题还必须通过 `Status` 缺失、`Triage` 唯一和 `State` 唯一检查；经 `/triage` 处理的议题还必须通过 `Category` 唯一和值域检查。

### 获取相关议题

用户提供路径时直接读取该路径。用户提供议题编号时，查找唯一匹配的 `.scratch/*/issues/<NN>-*.md`；若多个功能目录都有相同编号，则使用用户或当前任务指定的功能目录。读取唯一议题正文及其全部依赖状态后，获取才算完成。

### 查找代理工作前沿

按编号顺序扫描对应功能的 `issues/` 目录。工作前沿只包含 `**Triage:** ready-for-agent`、`**State:** open` 且所有依赖均已解决的议题。除非用户指定另一个未阻塞议题，否则选择编号最小者。

### 认领

实现前先将 `**State:** claimed` 写入并保存。已认领议题会离开工作前沿，其他并发会话应跳过它。

### 解决

只有当所有验收复选框都已完成且所需验证全部通过，才能解决议题。先在 `## Comments` 下追加带日期的完成说明和验证证据，再设置 `**State:** resolved`。如果结果改变了契约、ADR、覆盖记录或 QA 证据，应先更新对应真相源，再解决议题。

## 寻路操作

仅供 `/wayfinder` 使用。映射（map）位于 `.scratch/<effort>/map.md`，每个子决策议题（child）单独位于 `.scratch/<effort>/issues/NN-<slug>.md`。这两类文件不使用实现议题的 `Triage`、`Category` 或 `## Comments`。

### Map

Map 使用以下五个完整且精确的二级标题，不使用 `Decisions-so-far`、`Fog` 等缩写或旧标题：

```markdown
# <寻路工作名称>

## Destination

<抵达终点时应得到的规格、决策或变更>

## Notes

<领域、每次会话需要使用的技能和长期偏好>

## Decisions so far

- [<已关闭 child 的名称>](<child 路径>) — <答案的一行摘要>

## Not yet specified

<仍在范围内、但目前还无法精确写成问题的未知项>

## Out of scope

<已明确排除在 Destination 之外的工作>
```

`Decisions so far` 只保存已解决 child 的一行摘要与链接，完整答案只保存在对应 child。仍然开放的 child 通过扫描 `issues/` 获取，不重复列入 map。

### Child

Child 从 `01` 开始编号，并使用以下精确结构：

```markdown
# NN — <决策议题名称>

**Type:** <research|prototype|grilling|task>

**State:** open

**Blocked by:** <None — can start immediately. 或编号依赖>

## Question

<本 child 要回答的一个决策或调查问题>
```

- `Type` 的允许值为 `research`、`prototype`、`grilling` 或 `task`。
- `State` 的允许值为 `open`、`claimed` 或 `resolved`。
- `Blocked by` 使用与实现议题相同的依赖格式；所有被引用 child 都是 `State: resolved` 时才解除阻塞。
- 工作前沿是 `State: open`、未阻塞且未认领的 child；编号最小者优先。
- 认领映射为在开始工作前写入并保存 `**State:** claimed`。
- Matt 工作流中的 resolution comment 映射为追加到 child 的 `## Answer`；关闭（close）映射为随后设置 `**State:** resolved`。
- 位于路线内的答案以摘要和 child 链接追加到 map 的 `Decisions so far`。超出 `Destination` 的 child 同样以 `State: resolved` 关闭，但其摘要和链接写入 `Out of scope`，不写入 `Decisions so far`。

当 map 包含全部五个精确标题、每个 child 包含一个 `Question` 以及唯一的 `Type`、`State`、`Blocked by`，且关闭 child 的完整答案只保存在 `Answer` 后，wayfinder 落盘才算完成。
