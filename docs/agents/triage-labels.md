# 议题分流与生命周期

Matt `/triage` 的 category role 存入 `Category`，state role 存入 `Triage`；仓库扩展的 `State` 单独记录执行进度。这三个维度不得互相代替。

## `Category` 取值

| `Category` 值 | 含义 |
| --- | --- |
| `bug` | 已有行为损坏或不符合既定契约。 |
| `enhancement` | 新功能或对现有行为的改进。 |

每个经 `/triage` 处理的议题必须恰好具有一个 `Category` 和一个 `Triage`。由 `/to-tickets` 直接生成且无需分流的实现议题可以不带 `Category`。

## `Triage` 取值

| `Triage` 值 | 含义 |
| --- | --- |
| `needs-triage` | 需要维护者评估范围和路由。 |
| `needs-info` | 正在等待报告者或负责人补充信息。 |
| `ready-for-agent` | 议题已充分说明，可由代理处理。 |
| `ready-for-human` | 下一步必须由人类执行。 |
| `wontfix` | 不会处理该议题；应同时使用 `State: resolved` 并记录原因。 |

外部 skill 使用“AFK-ready”等等价角色名称时，将其转换为上表中的对应 `Triage` 值；不要把这些角色写入 `State`。

## `State` 取值

| `State` 值 | 完成条件 |
| --- | --- |
| `open` | 议题未认领且未完成。 |
| `claimed` | 执行者已在开始工作前保存认领状态。 |
| `resolved` | 所有验收条件及必要验证均已通过，且完成证据已经记录。 |

## 状态转换

- 新的实现议题从 `State: open` 开始。
- `/triage` 完成分流时写入一个 `Category`，并把唯一的 `Triage` 更新为所选 state role。
- 认领时只将 `State` 从 `open` 改为 `claimed`。
- 缺少信息时将 `Triage` 改为 `needs-info`；`State` 根据当前归属继续保持 `open` 或 `claimed`。
- 成功完成时先记录证据，再将 `State` 改为 `resolved`。
- 以 `wontfix` 结束时记录原因，将 `Triage` 设为 `wontfix`，并将 `State` 设为 `resolved`。
- `State: resolved` 是终态。保留的 `Triage` 值只用于历史记录，不再参与工作路由。
