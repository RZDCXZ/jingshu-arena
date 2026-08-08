# 01 — 可复现工作区与门禁骨架

**What to build:** 让贡献者在一台干净机器上用统一命令安装、构建并验证竞枢的 Web、API、原生小程序和共享业务模块，为后续纵向功能提供始终可运行的地基。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 根工作区只产生一个 pnpm lockfile，并精确锁定 Node.js 24.18.0、pnpm 9.15.9、Next.js 16.3.0、React 19.2.8、Hono 4.13.1、@hono/node-server 2.1.0、Drizzle ORM 0.45.2、Drizzle Kit 0.31.10、TypeScript 6.0.3 和 Playwright 1.62.1。
- [ ] 工作区包含单一多角色 Web 应用、Hono API、原生微信小程序、纯领域规则、共享契约和数据库六个逻辑模块，依赖方向符合 ADR-0014 与 ADR-0015。
- [ ] 纯领域规则模块不依赖数据库、Node 专用 API、React、Next.js 或微信运行时。
- [ ] Web、API 和小程序均有最小可构建入口；本地开发与 CI 使用相同的 strict TypeScript、格式、lint、测试和构建命令。
- [ ] 建立使用真实临时 Postgres 的空库迁移测试入口，不以 SQLite 或内存数据库代替。
- [ ] 提交的环境变量示例只包含变量名、用途和占位值；Secret、真实凭据和真实个人数据检查可自动失败。
- [ ] CI 骨架能够在无业务实现时通过，并为后续单元、契约、Postgres 集成、浏览器 E2E 和三端构建门禁预留独立任务。
- [ ] 开发命令、版本要求和分支发布边界有简短说明，明确功能分支可公开但 main 必须保持可发布。
