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

Phase 2.5B 当前已将 `generate-magical-girl` 作为首条 shared service 纵切：Hono 从
`server/adapters/generate-magical-girl.ts` 加载 adapter，不再动态导入对应 Next route；Next wrapper 继续保留，
但业务顺序与响应由共享 package 唯一实现。其余 23 条白名单 route 仍明确位于 `legacyRouteIds`，因此本批不表示
Hono seam 或 `apps/api` 已整体完成。生成后的实际 registry 为 `server/generated/routes.ts`，不得手工修改。

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

`.github/workflows/hono-deploy.yml` 会在任意分支的每次 push 后运行测试、生成单文件 bundle，然后上传到
服务器。服务器先校验 SHA-256，并用当前 `/opt/mahoshojo-hono/.env.hono` 执行生产配置预检；预检成功后
才重建容器。如果新版本在两分钟内未就绪，脚本会恢复上一个 release。

仓库的 `hono-production` Environment 需要配置一个 Secret：`VPS_SSH_PRIVATE_KEY`，内容为可以连接
服务器的私钥（当前运维使用 `.ssh/mahoshojo`）；还需配置两个 Variable：`VPS_HOST` 和 `VPS_USER`。建议为该 Environment 设置允许部署的分支规则；如果
实际上只想让生产分支发布，也可将 workflow 的 `push.branches` 收窄到生产分支。已核验的 ED25519
host key 固定在 workflow 中，以便审查服务器指纹变化。

生产切流只应将 `config/hono-api-routes.json` 中的精确路径转发到 Hono origin；其他 `/api/*` 继续访问 Next.js。前端继续使用
同源相对路径，旧 Next API 至少保留两个发布周期用于回滚。当前阶段不提供 `/ws`。
