# G25B-1 常规 Hosted 生成族 shared-service 收口实施计划

> **For agentic workers:** 本计划由当前 `/goal` 内联执行；行为修改必须遵循 RED → GREEN，最终必须经过 Builder self-review、独立 review 与 `GOAL-061` 验收。

**Goal:** 将 `generate-game-card`、Free generate/stream 与 Scenario generate/stream 五条低状态 Hosted generation route 收口到 `@mahoshojo/hosted-api` business service + Next/Hono runtime adapter 边界，同时保持现有公开行为和副作用顺序。

**Architecture:** `@mahoshojo/hosted-api` 负责不可信请求解析、方法约束、限速/安全/生成/活动/结果处理顺序、短路和错误 wire；legacy root 的 `lib/hosted-api/*` 只组合 Provider、AI、签名、内容安全、日志等 runtime port。Next Route Handler 与 Hono adapter 引用同一 default service 实例；生成 registry 只从 `server/adapters/*` 加载 shared route，并由边界检查禁止 adapter 回导 `app/api`。

**Tech Stack:** TypeScript、Web Standards `Request`/`Response`、Zod v3 compatibility、Vitest 4、Hono、Next.js、pnpm workspace。

**Governance:** `MONO-003`、`MONO-004`、`MONO-005`、`MONO-006`、`MONO-009`、`DR-004`、`AI-006`、`COMPAT-001`、`COMPAT-002`、`GOAL-040`、`GOAL-050`、`GOAL-061`。

---

## 1. 当前基线与范围裁决

- 当前 manifest 为 `1 shared-service / 23 legacy-next`，共 24 条。
- 本 Goal 保留并迁移 5 条 route：
  - `generate-game-card`
  - `generate-free`
  - `generate-free-stream`
  - `generate-scenario`
  - `generate-scenario-stream`
- 预期完成后为 `6 shared-service / 18 legacy-next`，不增加 Hono capability。
- 保留理由：这些能力已经在 Hono 白名单中，属于项目承担成本的 Hosted generation；流式能力有明确的长连接/Cloudflare CPU 价值，非流式同族共享安全、Provider 和回滚 composition。当前没有逐 capability 新证据足以证明退出 Hono比保持 Hono 主执行面更可靠或更省成本。
- 延后理由：Creator、残兽、魔法少女详情、升华与 questionnaire/DataCard/build-rule/signature 组合更深，不与本批共享同一 service composition；Arena/session/tea-party/regenerate 属于 G25B-2 原定高风险状态族。

## 2. 文件结构与责任

- Create `packages/hosted-api/src/regular-generation.ts`
  - 共享 custom-provider/request schema、step result 与 JSON response helper；不读取环境变量或导入 runtime。
- Create `packages/hosted-api/src/generate-game-card.ts`
  - Game Card 请求校验及 `safety -> rate-limit -> generate -> output-policy -> activity -> response` 顺序。
- Create `packages/hosted-api/src/generate-free.ts`
  - Free 非流式/流式请求 schema、附件上限与 `rate-limit -> safety -> generate -> activity -> response` 顺序。
- Create `packages/hosted-api/src/generate-scenario.ts`
  - Scenario 非流式/流式输入、短路、生成、活动、签名/响应顺序。
- Modify `packages/hosted-api/package.json`
  - 只导出上述显式公共入口。
- Create `packages/hosted-api/tests/regular-generation.test.ts`
  - 以手写 dependency port 验证方法、请求、短路、调用顺序、wire 与错误。
- Create `lib/hosted-api/generate-game-card.ts`
- Create `lib/hosted-api/generate-free.ts`
- Create `lib/hosted-api/generate-scenario.ts`
  - 承接现有 Provider/AI/内容安全/签名/活动/AI meta runtime composition；不得复制 package 已拥有的流程判断。
- Modify five legacy `app/api/**/handler.ts`
  - 保留兼容导出，但只引用对应 default service；route 文件和对外路径不变。
- Create five `server/adapters/**.ts`
  - Hono adapter 只引用对应 default service；保持原 route module 的 method surface。
- Modify `config/hono-api-routes.json` and regenerate `server/generated/routes.ts`
  - 将五条 route 从 `legacyRouteIds` 原子移动到 `sharedRouteIds`。
- Modify `scripts/check-workspace-boundaries.mjs` and `tests/check-workspace-boundaries.test.ts`
  - `server/adapters` 禁止导入 `app/api`、`pages/api` 或 route module，形成 `MONO-009` 防回退门禁。
- Modify `tests/server/route-manifest.test.ts`
  - 断言 6/18、shared adapter module surface，以及 generated source 不含对应 Next route import。
- Create `tests/server/regular-generation-adapters.test.ts`
  - 断言 Next 与 Hono adapter 使用同一 service handler，并用无上游副作用请求比较 wire。
- Preserve existing route behavior tests
  - `tests/generate-game-card-handler.test.tsx`
  - `tests/public-stream-abort-signal.test.ts`
  - `tests/public-ai-input-safety.test.ts`
  - `tests/hono-api-client.test.ts`

## 3. Task 1：RED——shared service contract 与边界门禁

- [ ] 在 package test 中先导入尚不存在的五条 service factory，覆盖：
  - 非 POST 的现有 405 status/body/content-type；
  - 无效 body 的现有 400 status/body；
  - Game Card 的 safety 在 rate-limit 前；Free/Scenario 的 rate-limit 在 safety 前；
  - rate-limit、安全和 output policy 短路后不调用 AI、活动或签名；
  - 成功路径只记录一次 activity；Scenario 非流式保持 activity 在签名前；
  - stream executor 接收原 `Request.signal`，响应正文/headers 原样返回；
  - exception 保持各 route 的既有 500 wire 和日志上下文。
- [ ] 在 boundary test 中加入 `server/adapters/example.ts -> app/api/example/handler` fixture，预期 `MONO-009-HONO-ADAPTER-LEGACY` violation。
- [ ] 在 route manifest test 中先期望 6 shared / 18 legacy。
- [ ] 运行 RED：

```bash
pnpm --filter @mahoshojo/hosted-api test
pnpm exec vitest run tests/check-workspace-boundaries.test.ts tests/server/route-manifest.test.ts --reporter=verbose
```

预期：package module 不存在、边界规则未实现、manifest 仍为 1/23；失败原因均来自待实现能力。

## 4. Task 2：GREEN——package business services

- [ ] 实现 shared request/custom-provider schema，保持既有字段、默认值、上限与错误文本；不新增网络、secret 或 runtime 依赖。
- [ ] 实现 Game Card service，显式保持：

```text
method/body -> input safety -> rate limit -> AI generate
-> output sensitive policy/shield normalization -> activity -> response
```

- [ ] 实现 Free generate/stream services，显式保持：

```text
method/body -> rate limit -> bounded combined safety text
-> AI generate/stream -> activity -> canonical response
```

- [ ] 实现 Scenario generate/stream services，显式保持：

```text
method/body -> rate limit -> answers safety -> AI generate/stream
-> activity -> non-stream signature/final response | stream response
```

- [ ] 运行 package GREEN、lint、typecheck：

```bash
pnpm --filter @mahoshojo/hosted-api test
pnpm --filter @mahoshojo/hosted-api lint
pnpm --filter @mahoshojo/hosted-api build
```

## 5. Task 3：GREEN——runtime composition 与双 adapter

- [ ] 将五条现有 handler 的 Provider resolution、AI config/prompt/output schema、签名和日志实现移入三个 `lib/hosted-api/*` composition 文件；只保留一份 production implementation。
- [ ] Next handler 改为薄兼容导出，保持现有 test import 和 route method surface。
- [ ] 新建 Hono adapter，直接引用同一 default service；不得导入 Next route/handler。
- [ ] 运行既有行为回归：

```bash
pnpm exec vitest run \
  tests/generate-game-card-handler.test.tsx \
  tests/public-stream-abort-signal.test.ts \
  tests/public-ai-input-safety.test.ts \
  tests/hono-api-client.test.ts --reporter=verbose
pnpm exec tsc --noEmit -p tsconfig.server.json
```

## 6. Task 4：GREEN——manifest、机械门禁与跨 adapter contract

- [ ] 实现 Hono adapter legacy-import AST/path 门禁。
- [ ] 原子移动五条 manifest ID，运行 generator，确认总路由数仍为 24。
- [ ] 增加 Next/Hono adapter identity 和 method/wire contract 测试。
- [ ] 运行：

```bash
pnpm run server:routes
pnpm exec vitest run \
  tests/check-workspace-boundaries.test.ts \
  tests/server/route-manifest.test.ts \
  tests/server/regular-generation-adapters.test.ts \
  tests/server/route-dispatcher.test.ts \
  tests/server/hono-app.test.ts --reporter=verbose
pnpm run check:workspace:boundaries
pnpm run build:server
```

## 7. Task 5：文档、self-review 与 independent review

- [ ] 更新 topic、`packages/README.md`、`server/README.md` 的当前 6/18 事实与剩余 family。
- [ ] 新增 G25B-1 实施日志，记录 source commit、route 理由、TDD、验证、回滚、影响和下一入口；不回写旧日志伪造历史。
- [ ] Builder self-review 完整 diff，逐项检查：
  - package/app/runtime 依赖；
  - auth/activity header、content safety、Provider secret、签名与 activity 顺序；
  - stream abort/body/headers；
  - public wire 与 Legacy/Better Auth；
  - manifest 客户端消费与回滚；
  - 测试是否只证明 mock，而没有 adapter/production regression。
- [ ] 使用独立 subagent 从 architecture、security/authority、compatibility/replay/data、test adequacy 四个维度审查完整 diff。
- [ ] 所有 Critical/Important 先补 RED 再修复并重跑 targeted validation；Minor 修复或在日志说明不阻塞理由。

## 8. Task 6：最终 `GOAL-061` 验收

实际运行并读取完整输出：

```bash
pnpm --filter @mahoshojo/hosted-api test
pnpm --filter @mahoshojo/hosted-api lint
pnpm --filter @mahoshojo/hosted-api build
pnpm run test:server
pnpm exec tsc --noEmit -p tsconfig.server.json
pnpm run build:server
pnpm run check:workspace:boundaries
pnpm run workspace:verify
pnpm test -- --reporter=dot
pnpm lint
pnpm build
XDG_CONFIG_HOME=$PWD/.tmp/xdg-config pnpm build:cf
pnpm run verify:server:runtime
git diff --check
```

如本 Goal 未改变 database/schema/secret/release/production 配置，则相应状态为 `NOT_APPLICABLE`；不得把未授权 production deploy/drill 写成 PASS。

## 9. 回滚

- 代码回滚：独立 revert 本 Goal 提交，恢复 manifest `1 shared / 23 legacy`、生成 registry、原 handler 和 package exports。
- runtime 回滚：Web 同源 Next adapter 始终保留；若未来部署该提交，可按现有 Hono artifact/container runbook 回退上一 bundle。
- 无数据库 migration、数据回填、secret 轮换、Access 变更或 release/tag，因此无需数据/凭据回滚。
