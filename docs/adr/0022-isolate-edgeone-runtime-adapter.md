---
status: accepted
---

# 隔离 EdgeOne 运行时适配并保持 API 双版本兼容

本地与 CI 精确使用 Node.js 24.18.0，但在部署探针完成前，Hono HTTP 应用核心只使用 Node 20 与 Node 24 共同支持的能力，并以单独的薄入口桥接 EdgeOne Cloud Function；`@hono/node-server` 仅用于本地开发，平台对象不得进入领域包或 HTTP 核心。生产部署通过 `edgeone.json` 把同源 `/api/v1/*` 交给函数、把其余请求交给 Next.js，而不依赖不受支持的 Next.js 重写。该方式会暂时约束可用 Node API，却把已知的平台版本差异集中在可替换边界，并允许部署探针失败时迁移函数运行时而不重写业务核心。
