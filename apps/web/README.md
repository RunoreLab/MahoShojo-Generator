# `@mahoshojo/web`

这是 MahoShojo 的 Next.js/OpenNext Web 应用，也是 Hosted Web 的 Cloudflare DR adapter owner。

## Ownership

- source：`app/`、`components/`、`lib/`、`middleware.ts`；
- static：`public/`、`styles/`；
- lifecycle：本目录 `package.json`、Next/OpenNext/Wrangler、TypeScript、Vitest、ESLint、PostCSS 配置；
- environment contract：`env.example` 与 `.dev.vars`；真实 secret 不进入仓库；
- tests/operations：`tests/` 与 app-specific `scripts/`。

跨 runtime 的 Hono route/method inventory 由仓库根 `config/hono-api-routes.json` 持有；公开 origin、probe 与 Web DR
operation safety 由小型 `config/hosted-routing.json` 持有。secret、binding 与 DatabaseProvider 约束留在实际服务端代码，
D1 migration history 仍由根 `drizzle/` 持有。Web 不导入其他 app source。

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

Web 应用不提供会绕过真实 Route Handler 或 DR capability 检查的通用“假健康”接口。
`GET|HEAD /api/hosted/dr-readiness` 是运行配置明确登记的代表性 safe-read operation：它与 Hono 共用
`@mahoshojo/hosted-api` contract，只通过 native `DB.withSession()` 执行固定查询，缺 binding/session/query 时固定
503，且不返回 bookmark、SQL、URL 或 secret。client-preflight 会额外发送 canonical capability/method header；
handler 复用同一 capability guard 检查目标 operation 的实际 secret、binding 与 database session，并只接受精确
回显，因此通用 readiness 不会被误当成全部业务 readiness。G25D 的
发布前 readiness 定义为：`check:wrangler:d1`、全量 test/lint、Next production build、OpenNext Cloudflare
build 与 `wrangler deploy --dry-run --env preview` 全部通过；运行时的 capability readiness 继续由各个
server-owned adapter fail closed。所有 shared Next route 在 production 进入 service 前经过统一 guard；未列入 Web DR
运行规则的 route、缺必要 secret 或缺 native D1 Sessions 时不调用 handler，也不回退 Hono HTTP D1 路径。
production cross-origin 请求还必须配置 `HONO_CORS_ORIGINS`；空值、`*`、HTTP、
localhost/loopback 或非法 origin 均 fail closed，OPTIONS 与实际响应复用同一 policy。非 production 本地开发可显式
使用既有 HTTP D1 adapter，但不会被标记成 native binding，也不能作为 DR 验收证据。
production 默认使用小型运行配置的 `client-preflight`：每个新 generation intent 先以无凭据、`no-store`
的有界 GET 探测 Hono primary；只有 primary non-ready 且 route + method 明确为 `safe-read` 或已验证
`new-non-idempotent` 时，才再探测同源 Next DR 并固定唯一 placement。未登记或 `durably-idempotent` 的 operation
不会探测或 dispatch DR；业务 fetch 一旦调用，写操作的 transport、未知 5xx、SSE EOF-before-done 或 stream 断链只记录
ambiguous outcome，不跨 runtime 重放；明确 SSE `done` / `error` 分别作为成功/失败终态释放 intent latch。production 不接受
`NEXT_PUBLIC_HONO_API_ORIGIN` 覆盖；preview 仍必须显式使用小型 routing config 的 preview origin，local/test 只允许
loopback。Next 与 OpenNext build 在产物生成后都会执行 Hosted DR client bundle safety gate：完整公开 routing token 必须存在，
所有客户端 JavaScript 中的服务端 secret/binding 名称与静态 internal/IP
endpoint 必须 absent；只对 framework URL parser 的精确 synthetic fixture 做受限豁免。该 gate 失败时构建 fail closed。

## Deploy 与 rollback

`pnpm --filter @mahoshojo/web deploy` 使用本目录 `wrangler.jsonc`。CI 分别以 `production` 或 `preview` environment 部署；G25D 本身不执行 deploy/cutover。

历史 production control-plane bootstrap seam 仍保留在独立 `dr-candidate` Wrangler environment，但状态是
`optional-disabled` / `reference-only`，不进入默认 workflow 或 build。只有未来重新形成 accepted ADR、预算与生产授权后，
才可显式同时设置
`NEXT_PUBLIC_HOSTED_API_ENVIRONMENT=production` 与 `HOSTED_DR_ACTIVATION_CANDIDATE=true` 才允许构建 bootstrap
artifact；`dr-candidate` 强制 `assets.run_worker_first=true` 并使用独立的
最外层 Worker entry，在 Cloudflare static assets、OpenNext image handler 与 Next middleware 之前只放行
`GET|HEAD /api/hosted/dr-readiness`，其余路径固定 503。Next
middleware 同时保留防御性限制，非法 candidate 开关同样 fail closed。candidate 使用独立
Worker/service/rate-limit namespace，但复用 production D1 authority，只执行 readiness 的固定 safe-read 查询；不得用
`dr-candidate` 覆盖 `production` environment，也不得把 bootstrap 探针描述为完整业务 DR readiness。本轮没有部署该
environment，没有创建 LB/DNS/monitor/Worker route，也没有修改 Access、secret 或生产数据。

回滚整个 G25D 时按提交逆序先 revert 最终审查整改/验收文档提交，再 revert `fb8dd77e`，最后 revert
`39825c1f`。应用 relocation 与 root/CI ownership 位于同一原子提交，避免中间状态留下双 owner 或不可部署的
半应用；不得只把部分 route 或静态资产移回根。
