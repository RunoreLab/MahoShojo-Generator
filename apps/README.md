# 应用边界

`apps/` 承载独立运行时与部署单元。G25D 已激活 Next/OpenNext Web，Phase 2.5A 已激活 D1 Gateway，
Phase 2.5C 已激活 Hono API 的 source、manifest、测试和构建边界；Admin 与其他 runtime 仍按阶段计划
渐进迁移，不能据此宣称 Phase 2.5 已整体完成。

长期目标边界如下：

- `web`：已激活的 Next/OpenNext workspace app，独占 Web source、测试、静态资产、环境与 Cloudflare deployment lifecycle；
- `admin`：管理端应用；
- `api`：已激活的 Hono Node workspace app，持有 `22 shared-service / 6 exited / 0 legacy-next`
  的 source、manifest、测试、生成器、容器和原子部署入口，详见 [`api/README.md`](./api/README.md)；
- `d1-gateway`：已激活的 D1 网关 Cloudflare Worker，详见 [`d1-gateway/README.md`](./d1-gateway/README.md)；
- `arena-room`：仅保留为未来可选的独立 Room/Cloudflare adapter 名称；现行 v1 首发是 `apps/api` Hono + Redis，
  不要求创建该应用或使用 Durable Object；
- `desktop`、`mobile`：桌面端与移动端应用边界。

除 `apps/web`、`apps/api` 与 `apps/d1-gateway` 外，README 或空目录仍只表示路线图占位。当前没有迁移
Admin、Desktop、Mobile 或完整 Arena Room runtime。应用之间不得直接导入彼此内部源码，共享能力应经
`packages/*` 或版本化协议边界提供。仓库根只保留 workspace 编排、统一门禁与跨 runtime route/migration tooling。
