# D1 Gateway

`@mahoshojo/d1-gateway` 是独立部署的 Cloudflare Worker，通过 Wrangler 配置中的原生 `DB` binding
访问项目 D1。它只负责保持现有参数化 query、raw、batch、Sessions/bookmark 和响应协议，不拥有数据库
schema，也不向其他应用暴露源码级依赖。

## 运行时配置

- `DB`：`wrangler.jsonc` 声明的原生 D1 binding。
- `D1_GATEWAY_HMAC_SECRET`：推荐的请求 HMAC 密钥；Hono 消费侧配置同一个值。
- `D1_GATEWAY_TOKEN`：可选固定 Bearer token，可替代 HMAC。
- `D1_GATEWAY_ALLOW_INSECURE_LOCAL`：仅本地开发使用；设为 `true` 时只对
  `localhost`、`127.0.0.1` 和 `::1` 跳过应用层鉴权，禁止配置到生产环境。

生产域名还应由 Cloudflare Access Service Token 策略保护。Access 是 Worker 外层的运维策略，不在本应用
代码或 Wrangler 配置中实现；消费侧使用 `CF_ACCESS_CLIENT_ID` 和 `CF_ACCESS_CLIENT_SECRET` 发送 Access
请求头。目录迁移不得改变现有 Access、HMAC 或 Bearer 语义。

`GET /health` 是无鉴权 liveness，只证明 Worker 路由能够响应，不探测 D1，也不代表依赖 readiness。

## 生命周期命令

在仓库根目录执行：

```bash
pnpm --filter @mahoshojo/d1-gateway run dev
pnpm --filter @mahoshojo/d1-gateway run test
pnpm --filter @mahoshojo/d1-gateway run lint
pnpm --filter @mahoshojo/d1-gateway run build
```

`build` 只执行 TypeScript 检查和 `wrangler deploy --dry-run`，不会发布生产 Worker。

## 手工部署与回滚

先为现有 Worker 设置秘密，再通过显式命令手工部署：

```bash
pnpm --filter @mahoshojo/d1-gateway exec wrangler secret put D1_GATEWAY_HMAC_SECRET
pnpm --filter @mahoshojo/d1-gateway run deploy
```

本应用没有自动生产部署 workflow。部署后需要回退时，先列出版本并显式选择目标版本：

```bash
pnpm --filter @mahoshojo/d1-gateway exec wrangler versions list
pnpm --filter @mahoshojo/d1-gateway exec wrangler rollback <version-id>
```

代码目录迁移可独立回退对应提交；不得在回退中修改 schema、D1 数据、secret 或 Access 策略。
