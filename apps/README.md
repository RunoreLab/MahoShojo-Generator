# 应用边界

`apps/` 承载独立运行时与部署单元。Phase 2.5A 已将 D1 Gateway 激活为首个真实 workspace app；
其余应用仍按阶段计划渐进迁移，不能据此宣称 Phase 2.5 或 MONO-002 已整体完成。

长期目标边界如下：

- `web`：现有 Web 产品的未来独立应用边界，当前仍在 legacy root；
- `admin`：管理端应用；
- `api`：面向 API/服务端能力的应用边界；Phase 2.5B 已把 Hono 清单和生成链收口为 `10 shared-service / 14 exited / 0 legacy-next`，但 source、manifest、构建与部署仍在 legacy `server/`/根目录，应用尚未激活；
- `d1-gateway`：已激活的 D1 网关 Cloudflare Worker，详见 [`d1-gateway/README.md`](./d1-gateway/README.md)；
- `arena-room`：Arena 多人 Room Worker / Durable Object 的未来部署边界；
- `desktop`、`mobile`：桌面端与移动端应用边界。

除 `apps/d1-gateway` 外，README 或空目录仍只表示路线图占位。Phase 2.5A 没有迁移 Web、Hono、Admin、
Desktop、Mobile 或 Arena Room runtime。应用之间不得直接导入彼此内部源码，共享能力应经 `packages/*`
或版本化协议边界提供。
