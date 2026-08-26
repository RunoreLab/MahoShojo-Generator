# `@mahoshojo/web`

这是 MahoShojo 的 Next.js/OpenNext Web 应用，也是 Hosted Web 的 Cloudflare DR adapter owner。

## Ownership

- source：`app/`、`components/`、`lib/`、`middleware.ts`；
- static：`public/`、`styles/`；
- lifecycle：本目录 `package.json`、Next/OpenNext/Wrangler、TypeScript、Vitest、ESLint、PostCSS 配置；
- environment contract：`env.example` 与 `.dev.vars`；真实 secret 不进入仓库；
- tests/operations：`tests/` 与 app-specific `scripts/`。

跨 runtime 的 Hono route inventory 仍由仓库根 `config/hono-api-routes.json` 持有，replay/secret/provider/control-plane
契约由 `config/hosted-dr-capabilities.json` 持有；D1 migration history 仍由根 `drizzle/` 持有。Web 不导入其他 app source。

## Local lifecycle

```bash
pnpm --filter @mahoshojo/web dev
pnpm --filter @mahoshojo/web test
pnpm --filter @mahoshojo/web lint
pnpm --filter @mahoshojo/web build
pnpm --filter @mahoshojo/web build:cf
```

根目录的 `pnpm dev/test/lint/build/build:cf` 是上述命令的 compatibility proxies。

## Readiness

Web 应用不提供会绕过真实 Route Handler 或 DR capability 检查的通用“假健康”接口。G25E-1 新增的
`GET|HEAD /api/hosted/dr-readiness` 是 manifest 中明确登记的代表性 safe-read capability：它与 Hono 共用
`@mahoshojo/hosted-api` contract，只通过 native `DB.withSession()` 执行固定查询，缺 binding/session/query 时固定
503，且不返回 bookmark、SQL、URL 或 secret；它不代表全部业务 readiness。G25D 的
发布前 readiness 定义为：`check:wrangler:d1`、全量 test/lint、Next production build、OpenNext Cloudflare
build 与 `wrangler deploy --dry-run --env preview` 全部通过；运行时的 capability readiness 继续由各个
server-owned adapter fail closed。所有 manifest shared Next route 在 production 进入 service 前经过统一 guard；
`fail-closed` capability、缺必要 secret 或缺 native D1 Sessions 时不调用 handler，也不回退 Hono HTTP D1 路径。
production cross-origin 请求还必须配置 manifest 指定的 `HONO_CORS_ORIGINS`；空值、`*`、HTTP、
localhost/loopback 或非法 origin 均 fail closed，OPTIONS 与实际响应复用同一 policy。非 production 本地开发可显式
使用既有 HTTP D1 adapter，但不会被标记成 native binding，也不能作为 DR 验收证据。
Hosted 主执行面、实际 DR 选择和综合容量 readiness 仍由外部控制面负责；当前 manifest 明确为
`not-provisioned`，未启用自动 failover。

客户端 `honoApiConfig.origin` 只读取 manifest 的 `stableOrigin`，不读取或选择物理 primary/DR origin，也不在
Hono 失败后自行重放请求。实际 LB/DNS/Worker 产品配置与故障演练属于 G25E-2/后续生产授权范围。

## Deploy 与 rollback

`pnpm --filter @mahoshojo/web deploy` 使用本目录 `wrangler.jsonc`。CI 分别以 `production` 或 `preview` environment 部署；G25D 本身不执行 deploy/cutover。

回滚整个 G25D 时按提交逆序先 revert 最终审查整改/验收文档提交，再 revert `fb8dd77e`，最后 revert
`39825c1f`。应用 relocation 与 root/CI ownership 位于同一原子提交，避免中间状态留下双 owner 或不可部署的
半应用；不得只把部分 route 或静态资产移回根。
