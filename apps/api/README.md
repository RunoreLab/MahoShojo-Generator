# Hono 独立服务端

`preview` 分支由 `.github/workflows/preview-deploy.yml` 发布到同一 VPS 上的独立实例：部署目录
`/opt/mahoshojo-hono-preview`、容器 `mahoshojo-hono-preview`、回环端口 `8081`、公网域名
`homura-preview.colanns.me`。首期允许与生产共用 Redis 网络，但由 `RedisRuntime` 统一施加
`REDIS_KEY_PREFIX=preview`，不暴露 destructive Redis command；D1、R2 与 authority secret 复用 production
runtime 配置。完整初始化及回滚约束见 `docs/2026-08-26_223558_预览环境自动部署说明.md`。

生产 Hono 使用 D1 Gateway 时，`D1_GATEWAY_URL` 必须是无凭据、路径、查询或片段的 HTTPS root origin，并要求
HMAC 或 Bearer transport credential。loopback HTTP 只可在显式 `HOSTED_DR_LOCAL_FAULT_INJECTION=true` 的
local/test fault-injection 中使用；该身份由 `HOSTED_API_ENVIRONMENT` 显式声明，不从 `NODE_ENV` 推导，缺失或未知
target 会在 production config check 中 fail closed。Gateway URL 与 runtime env 由同一 trust owner 管理，不使用
同 owner 的重复 origin allowlist 自证安全；需要更强 egress policy 时应由独立 deploy/platform trust owner 提供。

当前实现建立了可并行验证的 Hono Node 服务，不会改变原有 `pnpm dev` 和 Cloudflare Next 部署：

- 通过 `config/hono-api-routes.json` 的 `sharedRouteIds` 挂载经裁决保留的生成类 API，并用 `exitedRouteIds` 冻结继续由 Next 承载的退出清单；
- shared route 由 Hono adapter 与 Next Route Adapter 调用同一 `@mahoshojo/hosted-api` application service；
- 为旧 handler 提供 Node 版 `waitUntil`；
- D1 访问经 `hono-d1-primary` DatabaseProvider 使用内部 Gateway Worker，并保留 Cloudflare 管理 API 作为 Hono 迁移回退；该 provider 始终给出 primary 强语义，不伪造 Cloudflare D1 Session bookmark；
- Redis 提供跨实例 API 限流；
- 生产 Hono 默认使用 `HONO_AUTH_MODE=bearer`，受保护端点只接受用户 `authkey`；
- `/health/live` 和 `/health/ready` 分离进程存活与依赖就绪状态；
- 每 60 秒以单行 JSON 日志导出 Node 进程、event-loop 和 HTTP 容量基线。

另有只读基础设施端点 `GET|HEAD /api/desktop/releases/stable`，向官网提供固定 Desktop stable 版本的已验证公开投影。
它不进入 `sharedRouteIds`，由 `createHonoApp` 显式注册，仍受既有 `/api/*` Redis 限速；不会读取或转发来访者的 Cookie、Authorization 或 Query，
也不接收可变仓库、版本或上游 URL。它只查询固定 GitHub repo/tag，并要求 Release 非 draft/pre-release，安装包、签名、SHA 清单与 `latest.json`
四项资产齐全且下载 URL 与契约一致后，才返回只含 status/version/三个 URL 的 JSON。单 Node 进程缓存该最小 validated projection 300 秒并合并
并发 miss；未发布/资产未齐为 `204` 空体 `no-store`，超时、网络、上游 HTTP/限流或 JSON 错误为 `503` 空体 `no-store`，失败只通过 DESK-084
限定的低基数诊断 header 表达。未发布或失败结果另有 120 秒单目标查询冷却；上游限流给出合法 `Retry-After` 且超过 120 秒时，按该值冷却，最多 3600 秒。
冷却结果不会作为发布成功缓存或授权依据，成功缓存过期后失败也不会回退到旧版本。上游响应无论是否声明 `Content-Length`，读取均受 1 MiB 上限约束；fetch 与 body read 共用 5 秒总超时。

Phase 2.5C 建立的 10 条 shared-service route 包括 `generate-magical-girl`，G25B-1 收口的
`generate-game-card`、Free generate/stream、Scenario generate/stream，以及 G25B-2 收口的 Creator、残兽
generate/stream。Hono 从 `apps/api/src/adapters/*` 加载这些 adapter，不再动态导入对应 Next route；Next wrapper
继续保留，两个 runtime 使用同一默认 service composition，业务顺序与错误 wire 由
`@mahoshojo/hosted-api` 负责。G25R 又让 `arena/generate-stream` 与 generation request lookup/stream/status/cancel 四条控制面
通过 server-owned lifecycle 精确进入 shared route registry；稳定逻辑入口为：

- `POST /api/arena/generate-stream`；
- `GET /api/arena/generation-requests/:generationRequestId`；
- `GET /api/arena/generations/:generationId/stream`；
- `GET /api/arena/generations/:generationId`；
- `POST /api/arena/generations/:generationId/cancel`。

create 使用稳定 `generationRequestId` 和 actor-scoped semantic hash；Redis reservation 保证单 producer，断线后的
subscriber 只通过 `Last-Event-ID`/`after` 恢复同一 generation，不会把请求 signal 传播给 Provider。terminal 由
D1 claim 与确定性 R2 snapshot 兜底，只有显式 cancel 才中止 generation-owned signal。Phase 2.5B 退出审计将
14 条 capability 从 Hono 执行清单退出；G25R 只让 `arena/generate-stream` 精确 re-entry，另新增四条 generation
控制面 shared route。G25H-1 又将 `arena/generate`、`generate-battle-story` 与
`arena/session/generate-next` 归位为 Hono primary + Next DR shared companion service。角色修复
`arena/repair-combatant-meta` 也进入同一 Hosted companion runtime：它先从 D1 核验 generation 归属、完成态、
finalization 与实际 Provider/model provenance，再按原生成通道精确执行 AI 修复；BYOK 只接受客户端保存的
该次生成内存快照，不允许切换 Provider 后降级或回退。G25H-2 继续将
Details 与 Sublimation 的 generate/stream 四路归位到同一 shared service/runtime；Next/OpenNext 只保留带
`next-dr` lifecycle observation 的薄 adapter，Hono 不通过公开 Web URL 回取 preset 或执行 AI self-hop。G25E-1
增加 `GET|HEAD /api/hosted/dr-readiness` 代表性 safe-read 双入口；Hono adapter 使用同一 application contract 与
`hono-d1-primary` provider，固定执行 `SELECT 1 AS ok`，并绕过 Redis 限速依赖以免把 Redis 故障伪装成 D1 capability
结果。因此当前 registry 为 24 条 shared route，同时仍有 6 条 exited capability 对应的 Next 公开 route 保持原有实现、wire、鉴权和数据语义，未来若要重新进入 Hono，必须先形成 shared seam 和
副作用/replay 证据。生成器在 `legacyRouteIds` 非空时 fail closed，生成的 registry 也不再拥有动态导入
legacy Next handler 的 adapter 类型或代码路径。当前 registry 为 `24 shared-service / 6 exited / 0 legacy-next`；
Hono source、route inventory、测试、生成器和 bundle 构建已由 `apps/api` 独占。生成后的实际 registry 为
`apps/api/src/generated/routes.ts`，不得手工修改。

`check:workspace:boundaries` 还会扫描 `apps/api/src/adapters`，禁止 shared adapter 回导 root legacy route 或
`apps/web/app/api`、`apps/web/pages/api` 源码；新增 shared route 必须先形成 service/runtime composition，而不是把
Next handler 换一个入口继续加载。

## 容量遥测

Hono 主进程启动 `HonoRuntimeTelemetry`，默认每 60 秒向 stdout 输出一行固定
`schemaVersion=6`、`event=hono.runtime.telemetry` 的 JSON。当前快照包含：

- process 累计 CPU 时间与采样间隔 utilization、RSS、heap used/total/limit；
- event-loop utilization、active/idle 时间与 delay samples/mean/p99/max；
- active/peak HTTP request、response stream 和 Node socket。request 在 handler 结束时释放，stream
  在响应体消费、取消或异常时释放，socket 在连接关闭时释放；
- AI upstream active/peak/started/completed attempt、固定终态分类、TTFB 和 duration；
- 每次 D1 HTTP round trip 的 latency、固定 outcome/error class、rows read/written；
- Redis connect/ping/rate-limit/INFO 的固定 operation/outcome 与 latency；周期 `INFO MEMORY/STATS`
  提供 used memory、eviction 和 keyspace hit/miss。Redis 未连接时只记录 `unavailable`，不伪造 round-trip latency，
  server stats 尚未采到时显式为 `not-observed`；
- Arena Room 的 open active/resident actor、actor queue/operation latency、checkpoint operation/bytes/latency、Room socket、
  reconnect/replay/snapshot/resync、publisher backlog/drop 与固定 incident outcome；observer 只接受低基数 union，
  不接受 room/user/ticket/generation ID、正文、错误原文或任意 metadata，异常时 fail-soft；
- Arena request/resume/replay bytes/snapshot、provider attempt、generation duration、D1/R2 phase、cancel、
  producer-lost、Redis 与 terminal outcome 的固定低基数计数，以及 generation duration p50/p95/p99；Arena reasoning
  仅聚合 done/unavailable 计数与事件数、字符数，不保存正文；terminal audit
  只记录 generation ID、固定 outcome/runtime、reasoning 聚合事实与故障事实，不记录 actor、request body、prompt、正文或凭据；
- Arena companion 的受信 operation、Hono primary / Next DR placement、固定 outcome 与 duration；Hono 聚合
  到 runtime snapshot，Cloudflare DR 使用同一 bounded observation vocabulary 输出结构化日志；
- Hosted readiness 的 probe arrival、ready/not-ready、固定 latency bucket、Redis/D1 ready boolean 与 D1 transport
  class；这些数据按采样周期聚合，不为每个成功 readiness GET 输出普通 request log；
- Details / Sublimation 四路的固定 operation、Hono primary / Next DR placement、固定 outcome 与 duration；
  流式请求在响应体完成、取消或异常时结算，既不把正文、问卷、URL 或 Provider 配置写入 observation，也不新增
  response header/CORS wire；
- runtime origin 明确为 `hono-node`。当前 Hono 进程看不到入口层的真实 DR 选择，因此
  `selection` 诚实记为 `not-observed`，不根据部署角色推断实际流量来源。

该日志不记录 URL、request ID、用户标识、header、Prompt 或输出正文，也不新增公网
metrics endpoint。`RESOURCE-005` 中可由 Hono 进程、Hosted 调用 seam 和 Redis client 真实观测的最小集合
已收口；入口控制面没有注入可信 DR selection/failover reason，继续显式 `not-observed/null`，不得根据部署
角色或错误猜测。

Room hardening 由真实 fault/resource 测试和按需 verifier 保护，不再维护独立 evidence manifest 或固定十类 drill
登记表。Redis/WSS verifier 必须显式设置
`HOSTED_API_ENVIRONMENT=local|test`、loopback `REDIS_URL`、对应 opt-in 与非默认隔离 prefix；清理只覆盖各
verifier 声明的隔离 Room/generation namespace，且运行时拒绝 default/production/preview/local/test 等保留 prefix，
禁止 `FLUSH*`。`verify:room-hardening-load` 的固定非生产 workload 是 32 Room × 4 个真实 WSS
client × 20 次权威 transition；输出仅为本地容量事实，`serviceLevelObjective` 固定为 `null`，不得外推生产 SLA。

Hono 执行范围只包括 machine-readable 清单中明确保留的 API；具体清单以
`config/hono-api-routes.json` 为准。已退出的 capability 与 `/api/tachie/generate` 继续由 Next.js Route Handler 承载。
其余 API 也继续由 Next.js Route Handler 承载。Hono 对未列入白名单的 API 返回 `404`；这里的白名单指生成类 shared-route registry，
另有显式注册于基础设施层的 `/api/health/*` 与 `/api/desktop/releases/stable`，不加入该 registry。
新增 shared route 仍必须先修改白名单、重新生成路由清单并补充测试；新增基础设施例外则必须在 `createHonoApp` 显式注册并增加端到端 app 测试。

## 限速

除 `/api/health/live`、`/api/health/ready` 与代表性 `/api/hosted/dr-readiness` 由各自 handler 独立表达
liveness/dependency/capability readiness 外，Hono 对
其余 `/api/*` 使用 Redis 固定窗口限速：每个客户端 IP 每 60 秒 600 次。客户端 IP 按
`CF-Connecting-IP`、`X-Forwarded-For` 首项、`X-Real-IP` 的顺序解析；生产反向代理必须清理外部传入的
这些请求头。无法识别 IP 的请求共享 `unknown` 身份。Redis 不可用且 `REDIS_REQUIRED=false` 时中间件会
记录错误并降级放行；`REDIS_REQUIRED=true` 时会稳定返回 `503 RATE_LIMIT_UNAVAILABLE`，同时应让流量入口
根据就绪探针摘除异常实例。

各生成 handler 原有的用户/IP 冷却、会话并发和突发额度限制仍会叠加执行，不会被 Hono 全局限速取代。

`HONO_CORS_ORIGINS` 支持逗号分隔的精确来源，也支持形如 `https://*.colanns.me` 的子域通配符。
通配符只匹配相同协议和端口下的子域（包括多级子域），不匹配裸域 `colanns.me`。
Hosted DR shared route 的 Hono 与 Next/OpenNext adapter 复用同一 CORS policy；production 配置拒绝
空值、`*`、HTTP、localhost/loopback 和非法 origin，不允许两侧出现宽松度漂移。

Arena Room 使用独立的 `ARENA_ROOM_ALLOWED_ORIGINS`。多人功能启用时该列表必须非空，只能包含无凭据、
path、query、fragment 或 wildcard 的精确网页 Origin，并且每一项还必须被 `HONO_CORS_ORIGINS` 覆盖。
HTTP Room mutation 与浏览器 WebSocket 共用这份精确列表；这里填写发起请求的网页 Origin，不是 API/WSS
目标 hostname。production/preview 是否接受多人 request 只由各自 `.env.hono` 的
`ARENA_MULTIPLAYER_ENABLED` 控制，本 Origin 配置本身不构成激活授权。

Room create 叠加 `5/min` 突发限流与新 Room intent 的账号 `32/24h` 长窗口预算；已有 receipt 的结果确认
不重复消耗新 Room 预算。公开 create 请求必须携带客户端生成的
`creationRequestId`；服务端只在 Redis 保存账号绑定 key 下的请求摘要与 `roomId`，并与 checkpoint/directory
同一 Lua 提交、保留 24 小时。同 ID、同 intent 可用于确认未知结果（包括 `unlisted` Room），同 ID 改 payload
或 receipt 指向已结束 Room 时返回 `409`，不会创建 replacement。

## 鉴权

独立 Hono 服务推荐设置 `HONO_AUTH_MODE=bearer`。需要登录的 handler 使用现有统一认证链，客户端通过
`Authorization: Bearer <authkey>` 传入用户表中的 `authkey`；只有 Cookie、没有 Bearer header 的请求会返回
`401`。该模式不会初始化 Better Auth，因此不需要 `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL` 或
`BETTER_AUTH_TRUSTED_ORIGINS`。

`HONO_AUTH_MODE=hybrid` 仅用于需要同时兼容 Better Auth session 的环境，此时上述 Better Auth 配置仍是
生产必填项。`BETTER_AUTH_URL` 必须指向承载 `/api/auth/*` 的可信主站 origin；除本机开发外必须使用
HTTPS，服务不会从请求 URL 或 `Host` 推断携带 Cookie/Access Service Token 的子请求目标。未显式要求身份的生成端点仍可匿名访问；端点是否强制认证继续由各 handler 的
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

## 前端 Hosted 路由

生产 Web 使用 `apps/web/config/hono-api.ts` 的 `client-preflight` 模式。客户端从 `config/hosted-routing.json` 读取公开
Hono primary、同源 Next DR placement、probe path、timeout 和最小 route/method safety；Hono route/method inventory
独立由 `config/hono-api-routes.json` 持有。客户端先按 inventory 区分 primary-only 与 DR-selectable；只有后者在业务
dispatch 前最多探测 primary 一次，并在需要时最多探测 DR 一次。已知 Hono primary-only 直接向 Hono primary dispatch，
未知 route/method 在业务 dispatch 前 fail closed。
选择后固定 placement；POST/stream 一旦越过 dispatch boundary，任何断线、timeout 或未知终态都不得改发另一 runtime。
Tachie 与其他 exited route 继续使用原同源 Next 路由。

Hono 的 `GET /api/health/ready` 返回 `service=mahoshojo-hono`、`placement=hono-primary`、共享
`contractVersion` 与 `Cache-Control: no-store`，并复用严格 production CORS；readiness 绕过 Redis 业务 limiter，但不会
绕过全局连接/平台保护。probe 不携带 Authorization、Cookie、业务 body 或用户标识。Next DR probe 另以 canonical
capability/method 触发目标 capability guard，并要求响应精确回显；该低基数 identity 不包含真实资源 ID 或用户输入。

旧 capability/schema/drill manifest 和生成投影已经退场。普通 route/fault tests 保护真实行为，客户端 bundle scanner
继续拒绝 secret/binding 名称与内部 endpoint；Cloudflare LB/DNS evidence、projection drift 和历史 drill 状态不再作为
build/merge 门禁。readiness 的 contract compatibility 与 dispatch 后禁止跨 runtime 重放仍保留。

## 构建与容器运行

```bash
pnpm run build:server
pnpm run start:server
```

根命令只是 `@mahoshojo/api` workspace script 的兼容代理；bundle 输出为
`apps/api/dist/index.mjs`。容器与本地 Compose 也由 app 持有：

```bash
docker build --file apps/api/Dockerfile .
docker compose -f apps/api/compose.local.yml config
```

Docker install layer 只复制 `@mahoshojo/api...` 的实际 workspace manifest 闭包，不把 D1 Gateway 或未来
Admin/Desktop/Mobile app 带入 Hono image。生产 Dockerfile、release-local Compose 与部署脚本的 runtime
预检必须使用同一 `node:22-alpine@sha256:<digest>`；更新时三处同步修改并通过 release contract 测试，禁止通过
Arcane 单独拉取浮动 tag 更新生产容器。

生产启动会检查以下配置并在缺失时直接失败：Redis、有效 AI provider、32 字符以上的
`SIGNATURE_SECRET_KEY`、明确的生产 CORS、D1 Gateway 凭据（或临时使用 Cloudflare 管理 API三项凭据），
以及 Arena terminal/finalization 所需的 `ARENA_FINALIZATION_URL`、独立且至少 32 字符的
`ARENA_FINALIZATION_HMAC_SECRET`、R2 access key/secret/bucket/account（或显式 HTTPS endpoint）。finalization secret
不得复用签名、D1 Gateway 或 Better Auth secret。可设置 `HONO_CONFIG_CHECK_ONLY=true` 只执行配置预检而不监听端口。

Arena 可恢复生成不新增 D1 migration。共享 Redis 持有 reservation、producer token/lease、running/finalizing、
snapshot 与 replay；Redis 不可用时 create 必须在 Provider 前 fail closed。D1 只复用现有
`battle_report_generations` 保存终态及有界 reconciliation manifest，`large_objects`/R2 保存完整正文；完整本地卡片
和更新结果不得写入 D1。Provider 已结束但 bounded finalization 尚未收口的 D1 行以
`finalizationCompleted=false` 表达真实终态而不对外伪装完成；只有先取得 Redis expired-lease CAS 的 reaper 才能
重试收口，create 遇到该状态必须 fail closed，不能启动第二 Provider。Next/OpenNext DR 没有共享 Redis 时也只允许
恢复已完成 D1/R2 terminal，不以 process memory 替代 active lifecycle。

### Room 未启动任务取消（默认关闭）

`ARENA_ROOM_STARTING_CANCEL_ENABLED` 默认关闭。兼容版本仍读取并原样写回 authority v2；仅在显式启用后的
新 generation reservation CAS 中创建 authority v3 / `room-generation-start-gate-v1`。旧 intent 不升级。
新版 Room create 使用同进程可信 context；直接重放 PVP 签名到通用 create 不能获得 Room producer 权限。

启用前先确认同一 Redis namespace 的所有 Room/core writer 已升级，旧进程及其捕获的 start 已不再执行。
仅升级路由或等待 lease TTL 不足以满足这一条件。普通部署不自动改开关、不跑 Room 迁移、不安排停服。
无法确认时继续关闭，按[发布检查清单](../../docs/runbooks/2026-09-01_193300_Arena多人发布最小检查清单.md)另行安排启用。

关闭开关后，已有 v3 仍可读取、恢复与取消，原执行围栏继续生效；这类 Room 拒绝新 start，不能降级为 legacy。
写过 v3 后只可热回滚至兼容 v3 reader/gate 的版本，不可删围栏或强降级 checkpoint。新取消的 durable 结果复用现
D1 generation 表，不新增 migration；D1 缺失/未知只保留取消围栏，不能报告 cancelled。

本地可执行 `pnpm --filter @mahoshojo/api exec node --import tsx scripts/verify-room-starting-cancel-local.ts /absolute/path/to/redis-server`。
该 verifier 仅启动指定官方二进制的私有 loopback Redis，用随机认证和 PID 核验隔离，禁用持久化，不读取现有
`REDIS_URL`；generation/D1 端口均用合成数据，无真实模型。它验证服务竞态，不代表生产已启用或 Desktop 按钮已开放。

### 排位实体与参战正文绑定

Hono 与 Next DR 的共用 Arena executor 在可能计分的请求中验证参战正文与所声明的线上卡/预设来源，
把服务器生成的有界内容摘要、版本与读取权限证据写入现有终态 manifest。签名或客户端预检不能代替该绑定。
独立的身份投影只豁免已知顶层传输字段、签名和可变历战/当前状态；未知正文仍参与比较。
未申请计分的普通生成不新增来源查询；来源缺失或失配不阻断普通生成，但 Strict/Free 均显式不计分。
Free 保留原有状态读取与非原生角色政策，私有来源只以实际账号认证确认所有者，不以活动 token 提权。

Next 结算消费同一证据，并在双边评分的同一条 SQL 中校验两张线上卡的完整正文、版本与可见性，
避免生成后更新、撤回或同时间戳改卡把分数记给另一份设定。已计分事件保留历史事实；旧 pending 仅在
已持久化的双边 after-state 可确认时恢复收口，其他缺证据旧/在途请求不新增评分。
评分更新与事件 applied 标记目前仍分两步持久化；若标记前崩溃又遇评分重置，现有数值恢复不能可靠重建历史应用状态。
后续需独立将评分增量与事件完成标记原子持久化，不能把本次来源绑定视为绝对 exactly-once 保证。
滚动发布宜先更新 Hono 证据生产端，再更新 Next 结算端；混合版本窗口可能出现明确的未计分结果，
不得为兼容旧生产端而回退信任客户端来源。该变更不需要数据库迁移。

Arena create 先认证，再按原始字节增量读取；超过 12 MiB 的首个字节立即取消并在 Provider 前返回 413。
combatants 最多 32，裁定事件最多 100，questionnaire/narrative-history 各 50；共享房间配置中的
aux-scenario 与 material 累计最多 256，四类引用进入 Hosted runtime 后仍合计受 256 项 sanity budget 约束。D1 terminal
`extra_json` 最大 96 KiB，local reconciliation 候选最大 64 KiB，combatant fallback/终态角色行各最多
32。blocking replay 唤醒后会通过 Lua 重新验证 cursor；过期 producer 的 heartbeat、append 和
finalization mutation 均被 fenced。durable finalization 失败时 Redis 保持 `finalizing`，交给 expired-lease
reaper 对账，不伪造可对外读取的 failed/completed 终态。

## GitHub Actions 自动发布

`.github/workflows/hono-deploy.yml` 继续保留受保护生产分支、Environment、SSH host key 和
`cancel-in-progress: false`，build/container/artifact 路径只引用 `apps/api` owner。发布物由
`index.mjs`、release-local `compose.yml` 与 `deploy-bundle.sh` 组成；`release.manifest` 覆盖这三个运行资产，
其 SHA-256 是 release id，连同 manifest 本身构成五文件 release。生产 workflow 将本次构建的 artifact id、
ZIP 摘要和 release id 传给部署 job，由 runner 使用仅含 `actions: read` 的 Actions 访问权限获取临时下载链接，
再通过 SSH stdin 交给 VPS。GitHub token 不离开 runner，临时链接不写日志或配置文件。
VPS 使用 HTTPS 下载压缩包，核对 ZIP 摘要和五文件 manifest，在临时目录内校验通过后才放入
`releases/<release-id>`；同名 release 仅核对、不覆盖。下载失败最多刷新链接重试三次，校验失败直接停止。
产物准备与执行目录内的 `deploy-bundle.sh` 分为两个步骤，重试下载不会重复部署；现有健康检查和回滚不变。
生产拉取使用服务器已有的 Python 3 标准库，不需要 unzip、常驻 agent 或长期 GitHub token。
preview workflow 仍使用原来的 SCP 五文件上传流程。本次不改变五文件 release 格式或引入历史 tuple 兼容层。

PR、手动 Repository CI 与本地完整验收仍执行 `pnpm run ci:verify`。生产流水线并行运行
`ci:verify:checks`（原有测试、lint 和边界检查，不重复 workspace build）、Hono 构建与类型检查、
以及使用 production 环境变量的 Cloudflare 构建。三者全部成功后才进入发布。
Web 的完整 OpenNext 产物只构建一次，压缩打包保留隐藏文件及符号链接；发布 job 按本次运行的
artifact id 下载、复验打包摘要，使用同一 commit 的 Wrangler 配置部署，不重新构建。

生产互斥锁只覆盖 `.github/workflows/production-release.yml` 的完整 Hono → Web 发布过程，不阻塞准备阶段。
仅尚未完成的验证/构建可被更新任务取消，已经开始的发布不会被新 push 中断。取得发布锁后，
尚未开始发布的过时 commit 会被跳过；Hono 健康检查和公网 smoke 成功后才发布 Web。
`.github/workflows/cloudflare-deploy.yml` 保留手动关闭多人入口的 Web-only 紧急发布，并使用同一把发布锁；
它不自动监听 push。preview 流水线不受本次调整影响。runtime 是否接受
Room request 由 `.env.hono` 的 `ARENA_MULTIPLAYER_ENABLED` 决定；workflow 手工入口只控制 Web exposure，
不会覆盖服务器 flag。

脚本先复验 candidate 和当前 `current`（如有），执行 release-local Compose 与固定 Node runtime 配置预检，
再启动 candidate。只有本机 readiness、公网 `/api/health/ready`、`/api/generate-magical-girl` CORS wire，
以及 Room HTTP/WebSocket 鉴权 smoke 全部通过后，才原子切换 `current`。任一步失败都会在当前发布进程内重启
previous release；首次发布失败则停止 candidate。

脚本只保留一个非阻塞 `flock` 防止并发发布，不写 persistent journal，也不在下一次启动时推断历史事务。
旧布局、旧 gate tuple 和 format marker 不再受支持。显式回滚直接选择仍保留在 `releases/<release-id>` 的
五文件 release，并运行：

```bash
current_dir="$(readlink -f /opt/mahoshojo-hono/current)"
target_id='<64-hex-release-id>'
"$current_dir/deploy-bundle.sh" rollback "$target_id" https://homura.colanns.me
```

回滚与普通发布使用同一套 checksum、配置与 smoke；它只切换 Hono release，不修改 Redis、D1 或 R2 数据。
部署主机必须提供 Docker Compose、`curl`、`flock`、`mktemp`、`realpath`、`stat`、`id`、`sha256sum` 和标准
POSIX 工具。`.env.hono` 必须是当前部署用户所有、权限为 `0600` 的普通文件且不得为符号链接。

生产切流只应将 `config/hono-api-routes.json` 中的精确路径转发到 Hono origin；其他 `/api/*` 继续访问 Next.js。前端继续使用
同源相对路径，旧 Next API 至少保留两个发布周期用于回滚。Arena generation 的 create 与后续 control 请求在一次 generation
内不得跨 runtime 盲目 replay；回滚时应先把 `arena/generate-stream` 移回 exited manifest，并同步撤销三个 control surface 的
入口转发，再回滚 Web resume。当前阶段不提供 `/ws`。

### Desktop Arena SSE 期望账号断言

Arena create、lookup、status、resume 与两种 stop 共用实际 actor 认证；可选
`X-Mahoshojo-Arena-Expected-User-Id: v1:<userId>` 要求认证结果是严格相同的正安全整数账号。
声明不授予身份；无效、缺失或失效的认证不能降级为匿名。未携声明的旧 Web 请求仍保留既有语义。

只有本 Hono 运行时已装配断言实现且原 readiness 成功时，公开
`GET /api/hosted/dr-readiness` 才附带
`arenaHosted={contractVersion:"arena-hosted-sse-v1",expectedUserIdAssertion:"v1",stream:"sse-v1"}`。
Native 必须在创建及跨重启首次恢复前以不携 Cookie、actor token、Provider Key 的 GET 验证该证据，
旧服务缺少该字段即不可派发；Next 不声明此能力，也没有兜底创建。此声明不是生成健康保证，
实际创建仍独立执行 Redis、签名及 durable finalization readiness。本片代码不代表线上部署。

### 本地 generation replay 成本基准

运行 `pnpm --filter @mahoshojo/api benchmark:replay-local /absolute/path/to/redis-server`，使用来自 Redis 官方来源的本地二进制。脚本只启动仅绑定 127.0.0.1 的临时实例，以每次随机认证和进程 PID 校验避免误连，禁用持久化，不读取 `REDIS_URL`，退出时清理合成数据。

输出区分 Redis 脚本 CPU、本地往返、请求协议字节和 state 重写字节；`small-state-control` 仅隔离内嵌 snapshot 的开销，不是可部署 adapter。在 snapshot 预算内的增长区间，保留全量 snapshot 的同频上传仍有累计平方成本，不能用小 state 对照的延迟代替完整优化结果。此基准不覆盖生产网络、并发订阅、持久化或副本负载，也不设跨机器耗时门槛。

### 不确定追加后的终态恢复

新版 writer 在 append 结果未知时不重试写入，也不再发布 running checkpoint；终态内部记录 `replayUncertain`。新版 reader 对显式 true 的 completed 成功只接受该 writer 留下的完整终态 snapshot，以既有 replace 语义恢复后发送唯一 terminal；超预算或正文证据损坏时返回现有内容不可用/transport 错误。failed、cancelled、producer_lost 缺少完整快照时只传递已验证的精确终态，不发空 snapshot，不清除已收到的正文或 reasoning。D1/R2 目前不能证明完整 reasoning，不拿 body-only 回退冒充完整快照；异常活动租约接管也不会伪造完整恢复。正常历史记录在 Redis TTL 退出后由 durable 重建缓存，继续走原 legacy 恢复路径。

该保证要求所有相关 writer/reader 已升级；旧记录缺少内部标记时保留原兼容行为，不宣称已证明无缺口。整份 Redis state 丢失后也无法仅由 D1 还原该标记。内部标记不加入 public SSE/status/Room/D1 字段。

### Generation replay 布局兼容能力（默认关闭）

adapter 的 `enableSnapshotSidecar` 仅决定新 reservation：默认继续创建原内嵌 snapshot 的 v1；显式 opt-in 创建 `storageVersion: 2`，正文写入独立 `:snapshot` key，state 只保留 cursor/status/updatedAt/摘要。所有读写依现存记录原子选择布局，不迁移在途 generation；未知版本与缺失/错配正文 fail closed。小 state 消除 append/heartbeat/cancel 重复处理正文，在 snapshot 预算内仍保留完整 snapshot 同频上传成本。

当前 `RedisRuntime` **未接入激活选项或环境变量**，部署本兼容代码不会自动提速。生产仍限定单实例 Redis。兼容版 A 先升级所有 reader、writer、后台进程和回滚镜像；激活版 B 再单独接线允许新建 v2。A 已声明/读取 `:snapshot` key，因此部署前也要检查受限 ACL 的 key pattern；命令仍为原 EVAL/GET/Stream 范围，无 EVALSHA 或 SCRIPT LOAD 新要求。

关闭 B 只停止新建 v2，不能回滚到不识别 v2 的旧镜像。必须继续保留 A，直至全部 v2 state（含无 snapshot 的 reserved、会续租的 active 和仍有 terminal TTL 的记录）退出；不能仅检查 sidecar 或等待固定一小时。TTL 数值、精确裁剪、flush 节奏和 public SSE contract 不随布局调整。

运行 `pnpm --filter @mahoshojo/api verify:replay-local /absolute/path/to/redis-server` 可在同样隔离的临时实例验证 A/B 混用、租约/取消/终态、全 key TTL、显式 KEYS 重验、未知写入结果和裁剪窗口。成本基准另包含完整 `sidecar-v2` 路径，需与 `small-state-control` 成本隔离组区分。
