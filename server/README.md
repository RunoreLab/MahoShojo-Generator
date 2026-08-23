# Hono 独立服务端

当前实现建立了可并行验证的 Hono Node 服务，不会改变原有 `pnpm dev` 和 Cloudflare Next 部署：

- 通过 `config/hono-api-routes.json` 的 `sharedRouteIds` / `legacyRouteIds` 互斥白名单挂载全部生成类 API；
- shared route 由 Hono adapter 与 Next Route Adapter 调用同一 `@mahoshojo/hosted-api` application service；
- 尚未迁移的 route 短期继续复用已有标准 Web `Request` / `Response` handler；
- 为旧 handler 提供 Node 版 `waitUntil`；
- D1 访问优先经过内部 Gateway Worker，保留 Cloudflare 管理 API 作为迁移回退；
- Redis 提供跨实例 API 限流；
- 生产 Hono 默认使用 `HONO_AUTH_MODE=bearer`，受保护端点只接受用户 `authkey`；
- `/health/live` 和 `/health/ready` 分离进程存活与依赖就绪状态；
- 每 60 秒以单行 JSON 日志导出 Node 进程、event-loop 和 HTTP 容量基线。

Phase 2.5B 当前有 6 条 shared-service route：`generate-magical-girl`，以及 G25B-1 收口的
`generate-game-card`、Free generate/stream、Scenario generate/stream。Hono 从 `server/adapters/*` 加载这些
adapter，不再动态导入对应 Next route；Next wrapper 继续保留，两个 runtime 使用同一默认 service composition，
业务顺序与错误 wire 由 `@mahoshojo/hosted-api` 负责。其余 18 条白名单 route 仍明确位于 `legacyRouteIds`，主要是
Creator/残兽/魔法少女详情/升华等深 composition 生成族和 Arena/session/tea-party/regenerate 等状态型能力；因此
本批不表示 Hono seam 或 `apps/api` 已整体完成。生成后的实际 registry 为 `server/generated/routes.ts`，不得手工修改。

`check:workspace:boundaries` 还会扫描 `server/adapters`，禁止 shared adapter 回导 legacy `app/api` 或 `pages/api`
源码；新增 shared route 必须先形成 service/runtime composition，而不是把 Next handler 换一个入口继续加载。

## 容量遥测

Hono 主进程启动 `HonoRuntimeTelemetry`，默认每 60 秒向 stdout 输出一行固定
`schemaVersion=1`、`event=hono.runtime.telemetry` 的 JSON。当前快照包含：

- process 累计 CPU 时间与采样间隔 utilization、RSS、heap used/total/limit；
- event-loop utilization、active/idle 时间与 delay samples/mean/p99/max；
- active/peak HTTP request、response stream 和 Node socket。request 在 handler 结束时释放，stream
  在响应体消费、取消或异常时释放，socket 在连接关闭时释放；
- runtime origin 明确为 `hono-node`。当前 Hono 进程看不到入口层的真实 DR 选择，因此
  `selection` 诚实记为 `not-observed`，不根据部署角色推断实际流量来源。

该日志不记录 URL、request ID、用户标识、header、Prompt 或输出正文，也不新增公网
metrics endpoint。当前批次只完成 `RESOURCE-005` 中的 Node 容量导出基础；AI upstream、
D1、Redis 和可信控制面的 DR selection/failover reason 仍需从各自真实调用 seam 注入，
不得将当前实现描述为 `RESOURCE-005` 已全部完成。

迁移范围包括白名单内路径段以 `generate` 开头的 API，以及战报的 `regenerate` API；具体清单以
`config/hono-api-routes.json` 为准。`/api/tachie/generate` 暂不迁移，继续由 Next.js Route Handler 承载。
其余 API 也继续由 Next.js Route Handler 承载。Hono 对未列入白名单的 API 返回 `404`，新增迁移路由时
必须先修改白名单、重新生成路由清单并补充测试。

## 限速

Hono 对全部 `/api/*` 使用 Redis 固定窗口限速：每个客户端 IP 每 60 秒 600 次。客户端 IP 按
`CF-Connecting-IP`、`X-Forwarded-For` 首项、`X-Real-IP` 的顺序解析；生产反向代理必须清理外部传入的
这些请求头。无法识别 IP 的请求共享 `unknown` 身份。Redis 不可用时中间件会降级放行，若生产要求
限速不可绕过，应同时将 `REDIS_REQUIRED` 设为 `true`，并让流量入口根据就绪探针摘除异常实例。

各生成 handler 原有的用户/IP 冷却、会话并发和突发额度限制仍会叠加执行，不会被 Hono 全局限速取代。

`HONO_CORS_ORIGINS` 支持逗号分隔的精确来源，也支持形如 `https://*.colanns.me` 的子域通配符。
通配符只匹配相同协议和端口下的子域（包括多级子域），不匹配裸域 `colanns.me`。

## 鉴权

独立 Hono 服务推荐设置 `HONO_AUTH_MODE=bearer`。需要登录的 handler 使用现有统一认证链，客户端通过
`Authorization: Bearer <authkey>` 传入用户表中的 `authkey`；只有 Cookie、没有 Bearer header 的请求会返回
`401`。该模式不会初始化 Better Auth，因此不需要 `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL` 或
`BETTER_AUTH_TRUSTED_ORIGINS`。

`HONO_AUTH_MODE=hybrid` 仅用于需要同时兼容 Better Auth session 的环境，此时上述 Better Auth 配置仍是
生产必填项。未显式要求身份的生成端点仍可匿名访问；端点是否强制认证继续由各 handler 的
`requireAuthUser` 调用决定。

## 本地启动

复制并配置 `env.example` 中的 Hono、Redis、D1 环境变量，然后执行：

```bash
pnpm run dev:d1-gateway
pnpm run dev:server
```

Hono 默认监听 `http://localhost:8787`：

```bash
curl http://localhost:8787/health/live
curl http://localhost:8787/health/ready
```

本地无 D1 Gateway 时仍可暂时使用 `CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID` 和
`CLOUDFLARE_API_TOKEN`，但该路径受 Cloudflare 管理 API 限流约束，不能作为生产业务链路。

## D1 Gateway

Gateway 已迁移为独立 workspace app，配置位于 `apps/d1-gateway/wrangler.jsonc`。业务接口仅接受参数化
query、raw 和最多 50 条语句的 batch，并拒绝 DDL/维护 SQL。完整运行时、环境、health、部署与回滚说明见
`apps/d1-gateway/README.md`。部署前设置 HMAC 密钥：

```bash
pnpm --filter @mahoshojo/d1-gateway exec wrangler secret put D1_GATEWAY_HMAC_SECRET
pnpm run deploy:d1-gateway
```

Hono 服务配置相同的 `D1_GATEWAY_HMAC_SECRET`。生产建议再用 Cloudflare Access Service Token
限制 Gateway 域名，Gateway 不应暴露为公共数据库 API。

## 前端直连开关

前端和服务端内部调用是否将白名单内的生成 API 请求到 Hono，由 `config/hono-api.ts` 中的
`honoApiConfig.enabled` 控制：`true` 使用 `https://homura.colanns.me`，`false` 继续使用同源
Next.js/Cloudflare 路由。该开关只影响 `config/hono-api-routes.json` 中的路由，Tachie 始终使用原路由。

## 构建与容器运行

```bash
pnpm run build:server
pnpm run start:server
docker compose -f compose.hono.yml up -d --build
```

生产启动会检查以下配置并在缺失时直接失败：Redis、有效 AI provider、32 字符以上的
`SIGNATURE_SECRET_KEY`、明确的生产 CORS，以及 D1 Gateway 凭据（或临时使用 Cloudflare 管理 API
三项凭据）。可设置 `HONO_CONFIG_CHECK_ONLY=true` 只执行配置预检而不监听端口。

## GitHub Actions 自动发布

`.github/workflows/hono-deploy.yml` 会在任意分支的每次 push 后运行统一 CI 验证、Hono 定向测试、容器
构建校验与单文件 bundle 构建，并把 bundle 上传为 GitHub Actions artifact。只有
`feature/v0.2.0_Battle_Growth_MahoShojo` 分支通过 build job 后，`deploy` job 才会把 artifact 上传到 VPS：
服务器先校验 SHA-256，并用当前 `/opt/mahoshojo-hono/.env.hono` 执行生产配置预检；预检成功后才重建
容器。如果新版本在两分钟内未就绪，脚本会恢复上一个 release。

仓库的 `hono-production` Environment 需要配置一个 Secret：`VPS_SSH_PRIVATE_KEY`，内容为可以连接
服务器的私钥（当前运维使用 `.ssh/mahoshojo`）；还需配置两个 Variable：`VPS_HOST` 和 `VPS_USER`。建议为该
Environment 设置允许部署的分支规则。`deploy` job 已有生产分支 gate；若将 workflow 的 `push.branches`
收窄到生产分支，只会减少非生产分支上的 build 与验证。已核验的 ED25519 host key 固定在 workflow 中，
以便审查服务器指纹变化。

生产切流只应将 `config/hono-api-routes.json` 中的精确路径转发到 Hono origin；其他 `/api/*` 继续访问 Next.js。前端继续使用
同源相对路径，旧 Next API 至少保留两个发布周期用于回滚。当前阶段不提供 `/ws`。
