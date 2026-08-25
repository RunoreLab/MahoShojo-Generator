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

## Deploy 与 rollback

`pnpm --filter @mahoshojo/web deploy` 使用本目录 `wrangler.jsonc`。CI 分别以 `production` 或 `preview` environment 部署；G25D 本身不执行 deploy/cutover。

回滚应用 relocation 时应整体 revert G25D-1；root/CI ownership 收口可独立 revert G25D-2。不得只把部分 route 或静态资产移回根形成双 owner。
