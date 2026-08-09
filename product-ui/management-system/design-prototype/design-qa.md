# 竞枢管理端设计 QA

- 状态：`current`（当前有效）
- 检查日期：2026-08-09
- 已验证契约版本：`product-ui/management-system/prod.md` 1.2
- 验证范围：[`05 — 双时钟、时间推进与轮换重置`](../../../.scratch/jingshu-basic-rc/issues/05-dual-clock-reset.md)

## 对照目标与规范化

- 视觉源真相：`design/reference/selected-night-operations-console.png`（`1487 × 1058`），以及在同一视觉系统内维护的正式状态源图。
- 时间确认源图/实现：`design/source-ticket05-time-confirm-1440-final.png` 与 `design/implementation-ticket05-time-confirm-1440-final.png`。
- 重置影响源图/实现：`design/source-ticket05-reset-impact-1440-final.png` 与 `design/implementation-ticket05-reset-impact-1440-final.png`。
- 视口与密度：全视图均为 `1440 × 1024 CSS px`、`devicePixelRatio = 1`，截图像素均为 `1440 × 1024`，无需密度换算；角色均为店员，最终时间确认对照使用相同上海业务时间。
- 响应式实现证据：`design/implementation-ticket05-time-preview-1024.png`，`1024 × 768 CSS px`、`devicePixelRatio = 1`。
- 状态：两种推进方式、影响确认、原子处理中、成功、事务失败、24 小时上限、重置影响、二次确认、创建成功、创建失败与旧标签失效。

## 对比证据

### 全视图

- 时间预览：`design/source-ticket05-time-preview-1440-final.png` 与 `design/implementation-ticket05-time-preview-1440.png`。
- 时间确认最终对比：`design/source-ticket05-time-confirm-1440-final.png` 与 `design/implementation-ticket05-time-confirm-1440-final.png`。
- 重置影响最终对比：`design/source-ticket05-reset-impact-1440-final.png` 与 `design/implementation-ticket05-reset-impact-1440-final.png`。
- 生产状态证据：`design/implementation-ticket05-time-processing-1440.png`、`design/implementation-ticket05-time-success-1440.png`、`design/implementation-ticket05-time-failure-1440.png`、`design/implementation-ticket05-time-limit-1440.png`、`design/implementation-ticket05-reset-confirm-1440.png`、`design/implementation-ticket05-reset-success-1440.png`、`design/implementation-ticket05-reset-failure-1440.png` 与 `design/implementation-ticket05-old-tab-invalid-1440.png`。
- 正式原型异常状态：`design/source-ticket05-time-failure-1440.png`、`design/source-ticket05-time-limit-1440.png`、`design/source-ticket05-reset-confirm-1440.png` 与 `design/source-ticket05-reset-failure-1440.png`。

### 重点区域

- 时间确认弹窗：`design/source-ticket05-time-confirm-focus.png`（`700 × 488`）与 `design/implementation-ticket05-time-confirm-focus.png`（`700 × 466`）。
- 重置影响弹窗：`design/source-ticket05-reset-impact-focus.png`（`700 × 370`）与 `design/implementation-ticket05-reset-impact-focus.png`（`700 × 398`）。
- 两组均从同视口全图按真实弹窗边界裁取；重要标题、时间值、风险说明、影响列表与主次操作在原始密度下可直接判读，因此无需继续拆分更小区域。

## Findings

- 没有仍需处理的 P0、P1 或 P2 差异。
- 可接受的动态内容差异：正式原型用已登记的预约/订单事件表达影响密度；ticket 05 生产注册表在后续预约、订单、考勤和交接 ticket 接入前为空，因此“推进到下一事件”明确禁用、`+30 分钟` 显示“没有到期业务事件”。两侧外部契约、层级和空影响表达一致，生产没有伪造事件。
- P3：正式原型使用带分隔线的共享 `Modal` 头尾，生产沿用 ticket 04 壳层无分隔线对话框；两者弹窗宽度同为 `700px`，时间确认高度相差 `22px`，重置影响高度相差 `28px`，没有改变内容顺序、可读性或操作位置。

## 必查保真表面

- 字体与排版：两侧均使用 Noto Sans SC Variable；标题、说明、时间数字、影响标签和按钮保持相同字号层级、字重与换行密度，`700px` 弹窗内没有截断。
- 间距与布局：时间确认均采用前后双列、风险条、影响区和右下主次操作；重置均采用危险说明、四角色 `2 × 2` 影响网格和二次确认入口。生产 `1024px` 下 `bodyScrollWidth = bodyClientWidth = 1024px`，`700px` 弹窗位于 `162–862px`，底部为 `611.95px`，无裁切或横向溢出。
- 颜色与令牌：炭灰/海军蓝表面、青色时间反馈、青柠主操作、琥珀安全提醒和红色重置风险均沿用选定“夜间运营控制台”方向；推进后时间统一改为青色，重置危险条统一为红色。
- 图片与资产：品牌标志继续使用正式 PNG，所有操作图标使用 Phosphor；没有占位图、手写 SVG、文本符号、CSS 图形或低清替代资产。
- 文案与内容：上海业务时间、24 小时累计上限、真实服务器时间安全边界、固定到期顺序、事务整体回滚、四角色影响、新沙箱先创建后切换、旧对象封锁与安全重试均明确可见。
- 状态与交互：真实同源 Web → Hono → 临时 Postgres 流程覆盖预览、确认、行锁等待中的处理中、提交成功、API 中断后的失败与同请求重试、数据库固定到精确 24 小时后的上限、重置成功/失败以及跨标签阻断。
- 响应式与无障碍：对话框使用语义化 `dialog`/`alertdialog`、背景 `inert`、关闭按钮初始焦点和焦点循环；`Escape` 后焦点返回原业务时间触发器。风险不只靠颜色表达，处理中使用文字与旋转图标，reduced-motion 规则把动画压缩为 `0.01ms`。

## 浏览器、API 与数据库验证

- Codex 应用内浏览器控制台：正式原型、生产 `1440 × 1024`、生产 `1024 × 768` 和旧标签的 warning/error 均为 0。
- 双时钟：真实业务时钟自然流逝，连续 `+30 分钟` 后顶栏和服务端结果同步变化；沙箱 `expiresAt` 不变。推进标签广播失效后，第二个已打开标签从服务端自动刷新到新业务时间，同时保留本地队列筛选输入。真实 Postgres 审计同时保存业务发生时间与不可变服务器记录时间。
- 事务失败：提交前持有沙箱行锁时生产界面稳定停留在“正在原子推进业务时间”；停止 API 后显示旧时间不变和同请求安全重试，恢复 API 后成功提交。
- 重置轮换：真实新沙箱创建后会话回到顾客标准起点，另一个已打开的标签立即显示“当前标签的旧沙箱已失效”；失败时当前角色和沙箱保持不变，恢复 API 后使用同一请求安全成功。真实 Postgres 同时验证旧沙箱重置审计与新沙箱来源事件只各写一次。
- 上限：在一次性 QA 数据库把当前沙箱固定到精确 `86_400_000ms` 累计推进后，生产只显示 24 小时上限状态，不提供继续推进入口。
- 自动化：完整 `pnpm verify` 通过，包括 31 个单元测试、30 个真实 Postgres/API 集成测试、2 个设计内容基线测试与 21 个 Chromium E2E；契约与种子套件无独立测试文件并按配置通过。Web/API/数据库/领域/契约/小程序构建、格式、lint、strict TypeScript、工作区边界、敏感数据扫描和 high 级依赖审计均通过（仅报告 1 个不阻塞门禁的 moderate 漏洞）。
- 正式原型：`npm run build` 通过，`npm run test:sites` 4/4 通过；`dist/client/index.html`、`dist/server/index.js` 与 `dist/.openai/hosting.json` 均已生成。
- 审查后复核：正式原型与生产界面统一使用规范术语“真实服务器时间”；应用内浏览器在真实生产路径确认预览和确认态均已更新，旧称谓不再出现。该文案修正不改变既有布局、状态或视觉差异结论。

## 对比历史

### 第 1 轮

- P1：推进事务成功后，父级业务时钟更新导致预览加载回调重新创建，成功态立即被“选择推进方式”覆盖。
- 修复：预览读取改为只在弹窗挂载时执行，并通过引用读取最新失效/关闭回调；真实 PostgreSQL 提交后成功态持续可见。
- 修复后证据：`design/implementation-ticket05-time-success-1440.png`。

### 第 2 轮

- P2：正式原型与生产的时间确认风险条/影响区顺序、推进后颜色和重置危险说明位置不一致；生产重置弹窗比源图高约 `107px`。
- 修复：统一为“前后时间 → 风险说明 → 影响”、推进后青色令牌和重置红色危险条；合并重复说明、收紧重置弹窗与影响卡间距。
- 修复后证据：最终时间/重置全视图和两组重点区域证据；生产重置高度收敛到 `398px`，源图为 `370px`。

### 最终复核

- 同角色、同时间、同视口把源图与生产截图放入同一次对比输入，字体、间距、颜色、图片资产、图标、文案、状态和操作逐项复核；P0/P1/P2 清零。
- ticket 04 及更早轮次保存在 [`design-qa-history.md`](design-qa-history.md) 和 Git 历史中。

## Open Questions

- 无阻塞问题。

## Implementation Checklist

- [x] `WEB-G04` 两种受限推进、影响确认、处理中、成功、失败、安全重试与精确上限可操作。
- [x] `WEB-G06` 四角色影响、二次确认、创建中、成功、失败和旧标签失效可操作。
- [x] `1440 × 1024` 同状态全视图与重点区域对比完成；`1024 × 768` 无溢出或裁切。
- [x] 真实浏览器、API/Postgres、双时间审计、事务回滚、幂等重试、会话轮换和跨标签阻断完成。
- [x] 完整仓库门禁与正式原型 Sites 包装测试通过，自动化结果已回填。

final result: passed
