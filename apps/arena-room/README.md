# Arena Room（未来部署边界）

`apps/arena-room` 只表示未来独立的 Cloudflare Worker / Durable Object 部署边界。它不是第二套 `/arena` 产品，也不复制现有 Arena 页面、生成核心或多人产品入口。

本阶段状态：

- 未部署；
- 未从现有多人实现迁移；
- 未新增 Worker、Durable Object、WebSocket、Service Binding 或 `GenerationBridge` 运行语义；
- 现有 `/arena` 产品与 Arena 多人 v1 代码路径保持不变。

后续迁移时，共享 DTO、事件与版本化协议进入 `packages/*`，Worker caller 使用 Service Binding，Hono 使用既定的 `GenerationBridge`。这些契约和调用语义不属于本阶段交付范围。
