# `@mahoshojo/web`

这是 MahoShojo 的 Next.js/OpenNext Web 应用，也是 Hosted Web 的 Cloudflare DR adapter owner。

## Ownership

- source：`app/`、`components/`、`lib/`、`middleware.ts`；
- static：`public/`、`styles/`；
- lifecycle：本目录 `package.json`、Next/OpenNext/Wrangler、TypeScript、Vitest、ESLint、PostCSS 配置；
- environment contract：`env.example` 与 `.dev.vars`；真实 secret 不进入仓库；
- tests/operations：`tests/` 与 app-specific `scripts/`。

跨 runtime 的 Hono route inventory 仍由仓库根 `config/hono-api-routes.json` 持有；D1 migration history 仍由根 `drizzle/` 持有。Web 不导入其他 app source。

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

Web 应用不新增一个会绕过真实页面、Route Handler 或 DR capability 检查的通用“假健康”接口。G25D 的
发布前 readiness 定义为：`check:wrangler:d1`、全量 test/lint、Next production build、OpenNext Cloudflare
build 与 `wrangler deploy --dry-run --env preview` 全部通过；运行时的 capability readiness 继续由各个
server-owned adapter fail closed。Hosted 主执行面、DR 选择和综合容量 readiness 仍由 `apps/api` 与后续
G25E 控制面负责，G25D 不启用自动 failover。

## Deploy 与 rollback

`pnpm --filter @mahoshojo/web deploy` 使用本目录 `wrangler.jsonc`。CI 分别以 `production` 或 `preview` environment 部署；G25D 本身不执行 deploy/cutover。

回滚整个 G25D 时按提交逆序先 revert 最终审查整改/验收文档提交，再 revert `fb8dd77e`，最后 revert
`39825c1f`。应用 relocation 与 root/CI ownership 位于同一原子提交，避免中间状态留下双 owner 或不可部署的
半应用；不得只把部分 route 或静态资产移回根。
