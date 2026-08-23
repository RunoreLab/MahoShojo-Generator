# G25C apps/api 真实应用激活与 Hono Telemetry 收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不保留 app→legacy root 源码耦合的前提下，把仍有明确 Hosted 价值的 Hono runtime 激活为真实 `apps/api` workspace app，并补齐该 runtime 可真实观测的 AI、D1、Redis 容量 telemetry。

**Architecture:** 14 条尚未形成 shared service 的 route 从 Hono manifest 退出，但其 Next 公开路径继续保留；已经通过 contract/review 的 10 条 `shared-service` route 全部保留。保留 route 的 server-only runtime composition 从 legacy root 提取到 `@mahoshojo/hosted-runtime`，Next 与 Hono 分别以 runtime adapter 配置同一 package；Hono source、manifest、tests、env、health、bundle、Docker 与 deploy 进入 `apps/api`。AI/D1 telemetry 由 shared runtime 的低基数 observer port 注入，Redis telemetry 由 API app 自己采集；入口控制面仍未提供的 DR selection/failover reason 继续明确为 `not-observed`。

**Tech Stack:** TypeScript、Hono、`@hono/node-server`、pnpm workspace、Vitest、ESLint、esbuild、Redis、D1 Gateway、AI SDK、Docker、GitHub Actions。

**Implements:** `MONO-002`、`MONO-003`、`MONO-004`、`MONO-005`、`MONO-006`、`MONO-009`、`RESOURCE-003`、`RESOURCE-005`、`GOAL-040`、`GOAL-061`。

**Preserves:** `AI-006`、`AUTHORITY-001..006`、`DR-004..011`、`DR-013..014`、`COMPAT-001..002`、`ACCEPT-008`；不改变 Arena v1 wire/authority，也不把 generation 标记为可透明重放。

---

## 启动裁决与验收矩阵

当前 source commit 为 `dc3d90c4`，manifest 是 `10 shared-service / 14 legacy-next`。G25C 原计划假定 Phase 2.5B 已结构退出，但当前分支尚未完成 G25B-3..5；本次不把约三个 Goal 的业务重构并入目录迁移，而按计划允许的 capability exit 路径处理：

- 保留 10 条已经具有 shared business service、Next/Hono contract 和 review 证据的 Hosted capability；
- 退出 14 条仍需动态 import Next handler 的 Hono capability；
- 退出只改变物理 Hono 执行面，Next 同源公开 route、wire、认证、数据和回滚面保持不变；
- 不新增 Hono route，不以覆盖率为目标；后续若重新进入 Hono，必须另有 shared seam、运行时收益和 replay/side-effect 证据。

Stopping condition 验收表：

| 条件 | 机械/行为证据 |
| --- | --- |
| `apps/api` 有真实 source/manifest/test/lint/build/env/health/deploy ownership | app manifest、README/env、app tests、bundle、Docker/Compose、workflow |
| root 不持有 API runtime dependencies | manifest dependency ownership test + lockfile importer |
| Docker/CI/deploy 只使用 app 真实 dependency closure | Dockerfile ordering/negative test + workflow test + local build |
| Hono 不导入 Web/root internals | workspace boundary + generated registry dependency graph |
| AI/D1/Redis telemetry 真实收口 | seam unit tests + Hono snapshot integration；secret/body canary negative test |
| 无法观测的入口选择不伪造 | `selection.status=not-observed` 与 `failoverReason=null` contract |
| build/health/readiness/rollback 等价 | config/health/runtime tests、bundle smoke、compose config、deploy script tests |
| 完整验证与独立 review | package/app/server/workspace/root/Next/OpenNext/Docker 验证，Critical/Important=0 open |

## 文件结构与责任

### 新增 workspace package

- `packages/hosted-runtime/package.json`：server-only runtime dependencies 与显式 source exports。
- `packages/hosted-runtime/src/`：保留的 10 条 Hosted service composition，以及其真正共享的 AI、Provider、安全、签名、D1、活动、questionnaire/build-rule runtime；不得导入 `apps/*`、Next、Hono 或 Cloudflare binding。
- `packages/hosted-runtime/src/telemetry.ts`：低基数 AI/D1 observer port、默认 no-op、runtime 注册与测试 reset。
- `packages/hosted-runtime/tests/`：runtime composition identity、AI/D1 指标、secret/body 负向测试。
- legacy root 的 `lib/hosted-api/*` 只保留 Next runtime adapter/兼容 export；不能反向成为 package 的依赖。

### 新增真实 API app

- `apps/api/package.json`：`dev`、`start`、`test`、`lint`、`build`、`build:bundle`、`verify:runtime`、`deploy:prepare`。
- `apps/api/src/`：从 `server/` 迁移并去除 root alias 的 Hono app、config、health、middleware、Redis、routes、telemetry、adapters 与 entrypoint。
- `apps/api/scripts/generate-route-manifest.mjs`：只读取 machine-readable route inventory 与 app adapters，不扫描 root Next 源码。
- `apps/api/scripts/build.mjs`、`apps/api/scripts/verify-runtime.mjs`：app-owned bundle/runtime smoke。
- `apps/api/tests/`：原 server tests 迁入，并新增 ownership、dependency、telemetry 与 TCP abort 证据。
- `apps/api/env.example`、`apps/api/README.md`：变量名、运行、health/readiness、telemetry、部署与回滚，不写 secret。
- `apps/api/Dockerfile`、`apps/api/deploy/compose.yml`、`apps/api/deploy/deploy-bundle.sh`：app-owned container/artifact lifecycle。

### 根编排与权威文档

- `package.json`：server lifecycle 变成 workspace filter 兼容入口；Hono/Redis runtime dependencies 移到 app，root 只保留自身真实依赖/工具。
- `Dockerfile.hono` 与 `deploy/hono/*`：迁移完成后删除，避免双 owner。
- `.github/workflows/hono-deploy.yml`：调用 app scripts、Dockerfile 与 artifact path；生产 branch/environment/SSH gate 不变。
- `scripts/check-workspace-boundaries.mjs`：识别 `apps/api` source，并禁止它通过 alias/relative/workspace package 间接回到 root/Web。
- `config/hono-api-routes.json`：`legacyRouteIds=[]`、保留 10 条 shared route。
- `docs/topics/2026-08-22_022000_平台重整与本地优先架构.md`、`apps/README.md`、`packages/README.md`、原 `server/README.md` 导航、`docs/2026-08-22_034220_Hono服务部署与自动发布指南.md` 与 Goal plan：同步 current state、capability exit 和新 ownership。

---

### Task 1：冻结 capability exit 与 apps/api ownership RED

**Files:**

- Modify: `tests/server/route-manifest.test.ts`
- Modify: `tests/workspace-structure.test.ts`
- Modify: `tests/check-workspace-boundaries.test.ts`
- Modify: `tests/hono-deploy-workflow.test.ts`
- Modify: `config/hono-api-routes.json`

- [ ] **Step 1：写 route 与 app ownership 失败测试**

新增精确断言：manifest 总数为 10、`legacyRouteIds` 为空、10 条 retained ID 不变；`apps/api/package.json`、`src/index.ts`、README/env/Docker/deploy 文件必须存在；root `server/`、`Dockerfile.hono` 和 `deploy/hono` 在迁移完成态不得存在。

```ts
expect(routeInventory.legacyRouteIds).toEqual([]);
expect(new Set(routeInventory.sharedRouteIds)).toEqual(new Set(RETAINED_SHARED_ROUTE_IDS));
expect(existsSync('apps/api/package.json')).toBe(true);
expect(existsSync('server/index.ts')).toBe(false);
```

- [ ] **Step 2：写 dependency/CI ownership 失败测试**

fixture 必须证明 `apps/api -> lib/server/app/pages/components/types` 的直接、间接和 workspace-name import 都被拒绝；Docker test 只要求 `apps/api` 与其 workspace dependency closure，不再动态要求 `apps/d1-gateway` 或未来 app 进入 API image；workflow 只引用 app-owned paths。

- [ ] **Step 3：运行 RED**

```bash
pnpm exec vitest run tests/server/route-manifest.test.ts tests/workspace-structure.test.ts tests/check-workspace-boundaries.test.ts tests/hono-deploy-workflow.test.ts --reporter=verbose
```

Expected: 旧 10/14 manifest、缺少 `apps/api`、root server/Docker owner 仍存在而失败；失败不得来自语法或 fixture 错误。

- [ ] **Step 4：只执行 capability manifest 原子修改并生成旧 registry**

把 14 条 legacy route 从 Hono inventory 删除，保留 10 条 shared route；运行 generator，确认公开 Next 文件没有删除。

```bash
pnpm run server:routes
pnpm exec vitest run tests/server/route-manifest.test.ts tests/server/route-dispatcher.test.ts --reporter=verbose
```

Expected: 10 条 Hono route 全为 `shared-service`；被退出 capability 的 Next route characterization 继续通过。

### Task 2：提取 `@mahoshojo/hosted-runtime`，消除 retained adapter 的 root 依赖

**Files:**

- Create: `packages/hosted-runtime/package.json`
- Create: `packages/hosted-runtime/tsconfig.json`
- Create: `packages/hosted-runtime/vitest.config.ts`
- Create: `packages/hosted-runtime/eslint.config.mjs`
- Create: `packages/hosted-runtime/src/telemetry.ts`
- Move/refactor: `lib/hosted-api/*.ts`、retained services 可达的 server-only `lib/ai*`、`lib/stream*`、D1/runtime modules、签名/安全/活动/questionnaire/build-rule modules
- Modify: root compatibility imports and `server/adapters/*`
- Test: `packages/hosted-runtime/tests/*.test.ts`

- [ ] **Step 1：写 package portability 与 composition RED**

测试要求 package 可从 clean workspace 独立 typecheck/bundle；10 个 default service 与 legacy Next adapter 使用同一 service identity；package source 不出现 `@/`、`app/`、`server/`、`next/*`、Hono、Cloudflare binding 或非字面量 module load。

```ts
expect(defaultGenerateFreeService).toBe(nextGenerateFreeService);
expect(scanHostedRuntimeImports()).toEqual([]);
```

- [ ] **Step 2：写 AI/D1 telemetry port RED**

`beginAiUpstream()` 返回 attempt handle，支持一次 TTFB 与一次 terminal；`observeD1RoundTrip()` 接受 latency、rows 与 error class；输出只包含数值与固定枚举，不接受 URL、provider name、SQL、request body 或 credential。

```ts
const attempt = observer.beginAiUpstream();
attempt.recordTtfb(12);
attempt.finish({ outcome: 'aborted', durationMs: 30 });
observer.observeD1RoundTrip({ durationMs: 8, rowsRead: 2, rowsWritten: 0, outcome: 'ok' });
```

- [ ] **Step 3：运行 package RED**

```bash
pnpm --filter @mahoshojo/hosted-runtime test
```

Expected: package/module 尚不存在导致失败。

- [ ] **Step 4：最小提取 server-only runtime**

以保持行为为第一目标移动唯一实现，不复制业务 handler；root Next adapter 改为只配置 OpenNext/D1 runtime 差异并从 package re-export，未来 `apps/api` 直接注入 Hono D1/telemetry adapter。共享 package 不读取 Hono Context，不导入 Next/OpenNext，也不持有 app source。

- [ ] **Step 5：把 AI/D1 observer 接到真实调用 seam**

AI 非流式 attempt 记录 active/TTFB/duration/success/error/abort/timeout；流式 attempt 在首个 upstream chunk 记录 TTFB，在 complete/cancel/error 只结束一次。D1 HTTP transport 每个真实 round trip 记录 latency、rows read/written 与稳定 error class；safe-read retry 的每个 attempt 分开计数，mutation 仍不透明重放。

- [ ] **Step 6：运行 GREEN 与边界验证**

```bash
pnpm --filter @mahoshojo/hosted-runtime test
pnpm --filter @mahoshojo/hosted-runtime lint
pnpm --filter @mahoshojo/hosted-runtime build
pnpm --filter @mahoshojo/hosted-api test
pnpm run check:workspace:boundaries
pnpm exec vitest run tests/server/regular-generation-adapters.test.ts tests/server/regular-generation-hono-success.test.ts --reporter=verbose
```

Expected: package/app boundary 无违规，10 条 route identity/contract 不漂移。

### Task 3：迁移 Hono source 与生命周期到真实 `apps/api`

**Files:**

- Create: `apps/api/package.json`、tool configs、README/env
- Move/refactor: `server/**` -> `apps/api/src/**`
- Move/refactor: `scripts/build-hono-server.mjs`、`scripts/generate-hono-route-manifest.mjs`、`scripts/verify-hono-runtime.mjs` -> `apps/api/scripts/**`
- Move/refactor: `tests/server/**` -> `apps/api/tests/**`
- Modify: `package.json`、`pnpm-lock.yaml`、`tsconfig.server.json`/root test config as needed

- [ ] **Step 1：建立 app manifest 与 package-local alias**

`@mahoshojo/api` 的生产依赖只声明实际运行需要的 Hono/Redis/shared packages；dev dependencies 自有 TypeScript/Vitest/ESLint/esbuild/tsx/dotenv。`#/*` 或相对路径只指向 `apps/api/src`，不得复用 root `@/*`。

- [ ] **Step 2：迁移 source、generator、tests 与 runtime smoke**

生成器只允许 10 条 shared adapters；任何 `legacyRouteIds` 非空都 fail closed。route definitions 不引用 root Next path。health/live/ready、CORS、Bearer/Hybrid auth compatibility、Redis fail-open/required、request metadata、stream/socket lifecycle保持现有测试。

- [ ] **Step 3：root scripts 变为 filter 兼容入口**

```json
"dev:server": "pnpm --filter @mahoshojo/api run dev",
"start:server": "pnpm --filter @mahoshojo/api run start",
"build:server": "pnpm --filter @mahoshojo/api run build:bundle",
"server:routes": "pnpm --filter @mahoshojo/api run routes",
"verify:server:runtime": "pnpm --filter @mahoshojo/api run verify:runtime",
"test:server": "pnpm --filter @mahoshojo/api run test"
```

- [ ] **Step 4：运行 app GREEN**

```bash
pnpm install --offline --trust-lockfile
pnpm --filter @mahoshojo/api test
pnpm --filter @mahoshojo/api lint
pnpm --filter @mahoshojo/api build
pnpm --filter @mahoshojo/api run build:bundle
pnpm run check:workspace:boundaries
```

Expected: app 自身生命周期全部 exit 0，bundle 只含 10 条 shared route，无 root alias/import。

### Task 4：收口 Hono AI/D1/Redis/runtime telemetry

**Files:**

- Modify: `apps/api/src/telemetry/runtime.ts`
- Modify: `apps/api/src/redis/runtime.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `packages/hosted-runtime/src/telemetry.ts` 与真实 AI/D1 seam
- Test: `apps/api/tests/runtime-telemetry.test.ts`
- Test: `apps/api/tests/redis-runtime.test.ts`
- Test: `packages/hosted-runtime/tests/runtime-telemetry.test.ts`

- [ ] **Step 1：写扩展 snapshot RED**

固定 `schemaVersion=2`；原 process/event-loop/http 字段保持，新增：

```ts
type HostedTelemetrySnapshot = {
  ai: { active: number; peakActive: number; attempts: number; success: number; error: number; abort: number; timeout: number; ttfbSamples: number; ttfbTotalMs: number; ttfbMaxMs: number; durationTotalMs: number; durationMaxMs: number };
  d1: { roundTrips: number; errors: number; latencyTotalMs: number; latencyMaxMs: number; rowsRead: number; rowsWritten: number };
  redis: { commands: number; errors: number; latencyTotalMs: number; latencyMaxMs: number; keyspaceHits: number | null; keyspaceMisses: number | null; usedMemoryBytes: number | null; evictedKeys: number | null };
  runtime: { origin: 'hono-node'; selection: 'not-observed'; failoverReason: null };
};
```

- [ ] **Step 2：写 Redis 真实采集 RED**

每个 `ping`/`fixedWindow`/INFO command 记录 latency/error；周期采样 `INFO memory` 与 `INFO stats`，解析 `used_memory`、`evicted_keys`、`keyspace_hits`、`keyspace_misses`。Redis 未配置/不可用时保持 `null` 或 error counter，不伪造 0；telemetry fail-soft，不能改变 rate-limit/readiness authority。

- [ ] **Step 3：写敏感信息和一次终态 RED**

在 env、request、SQL、provider 中放入 canary secret/body，断言 JSON snapshot 不包含；stream complete/cancel/error 重复触发只减少一次 active 并只增加一个 terminal counter。

- [ ] **Step 4：实现聚合与接线**

app 启动时把同一 telemetry recorder 注册给 hosted runtime 和 Redis runtime；周期 export 等待外部 gauge 采样但使用 `unref()`，shutdown 输出最终快照。入口层未注入可信选择事实，因此保留 `not-observed/null`。

- [ ] **Step 5：运行 telemetry GREEN**

```bash
pnpm --filter @mahoshojo/hosted-runtime test
pnpm --filter @mahoshojo/api test -- --runInBand
pnpm --filter @mahoshojo/api run build:bundle
```

Expected: 指标 seam、stream once、Redis INFO、fail-soft、secret/body negative tests 全部通过。

### Task 5：迁移 Docker、CI 与 deploy ownership

**Files:**

- Create: `apps/api/Dockerfile`
- Move: `deploy/hono/compose.yml` -> `apps/api/deploy/compose.yml`
- Move: `deploy/hono/deploy-bundle.sh` -> `apps/api/deploy/deploy-bundle.sh`
- Modify: `.github/workflows/hono-deploy.yml`
- Delete: `Dockerfile.hono`、空的 `deploy/hono/`
- Test: ownership/workflow/app deploy tests

- [ ] **Step 1：让 Docker dependency layer 只复制真实 closure**

install 前仅复制 root workspace metadata、`apps/api/package.json` 及 `@mahoshojo/api` 的实际 workspace dependency manifests；使用 pnpm filter 安装 app closure。不得复制 `apps/d1-gateway`、未来 admin/desktop/mobile manifest。

- [ ] **Step 2：迁移 workflow/artifact path**

统一 CI 仍执行 root/workspace no-regression；Hono targeted、Docker、bundle 和 artifact 使用 app scripts/paths。`deploy.if`、Environment、SSH host key、checksum、两分钟 readiness rollback 保持不变；public probe 改为 retained route，不触发生产执行。

- [ ] **Step 3：运行 deploy/Docker GREEN**

```bash
pnpm exec vitest run tests/workspace-structure.test.ts tests/hono-deploy-workflow.test.ts --reporter=verbose
docker build --file apps/api/Dockerfile .
docker compose -f apps/api/deploy/compose.yml config
```

Expected: tests 与 Docker/Compose exit 0；若本机 Docker daemon 不可用，保留完整环境证据，不能弱化 Actions gate。

### Task 6：Targeted、完整验证与 Builder self-review

- [ ] **Step 1：运行受影响层完整验证**

```bash
pnpm install --frozen-lockfile --offline --trust-lockfile
pnpm --filter @mahoshojo/hosted-runtime test
pnpm --filter @mahoshojo/hosted-runtime lint
pnpm --filter @mahoshojo/hosted-runtime build
pnpm --filter @mahoshojo/hosted-api test
pnpm --filter @mahoshojo/api test
pnpm --filter @mahoshojo/api lint
pnpm --filter @mahoshojo/api build
pnpm run build:server
pnpm run verify:server:runtime
pnpm run check:workspace:boundaries
pnpm run workspace:verify
```

- [ ] **Step 2：运行 root/Web/Cloudflare/CI 验证**

```bash
pnpm exec vitest run --reporter=dot --maxWorkers=4
pnpm lint
pnpm build
XDG_CONFIG_HOME=$PWD/.tmp/xdg-config pnpm build:cf
pnpm run ci:verify
git diff --check
```

- [ ] **Step 3：Builder self-review**

逐项检查 accepted ADR/spec、app/package/runtime 依赖方向、secret/auth/authority、D1 no-replay、Redis non-authority、Next/Hono wire、schema/producer-consumer、shutdown/rollback、测试 adequacy。任何行为 finding 先写失败测试再修。

### Task 7：Independent review、修复与文档收口

**Files:**

- Create: `docs/logs/2026-08-24_平台重整G25C_apps-api真实应用激活与Telemetry收口实施日志.md`（实施完成时在日期后补实际 `HHmmss`，正文和 topic 只引用最终文件名）
- Modify: topic、Goal plan、apps/packages README、Hono deployment guide and navigation

- [ ] **Step 1：独立 review**

至少分离 Builder 视角覆盖：

- architecture/dependency 与真实 app ownership；
- security/authority/secret/auth；
- compatibility/data/replay/Redis authority；
- telemetry accuracy/privacy 与 test adequacy。

Critical/Important 必须关闭；Minor 修复或给出不阻塞 stopping condition 的可复核理由。

- [ ] **Step 2：修复后重跑 affected + final verification**

任何 finding 修复先运行对应 targeted RED/GREEN，再重跑 Task 6 的高影响集合与 Docker/workflow gate。

- [ ] **Step 3：写最终实施日志与更新 current state**

日志必须记录 source/plan/实现/review commits、10 retained / 14 exited capability、退出理由、实际命令/结果、PASS/NOT_APPLICABLE/DEFERRED/BLOCKED、rollback、production/schema/secret/release 影响、剩余 Phase 2.5 与下一 Goal 重估。

- [ ] **Step 4：最终 stopping condition 审计**

只有 Objective、所有必要 stopping condition、`GOAL-061` 与独立 review 均闭合后才完成 G25C；不得把未执行 production deploy/cutover 写成 PASS。

## 回滚边界

1. capability exit 可独立把 14 个 ID 恢复到 `legacyRouteIds`，前提是同时回退到仍拥有 legacy root 的上一 Hono bundle；不得在新 `apps/api` 中恢复 app→root import。
2. runtime package extraction可按原子提交 revert，Next compatibility wrapper 恢复旧 composition；无 schema/数据回滚。
3. `apps/api` relocation 可回退到上一 root `server/` artifact；生产若未来部署，使用既有 checksum release 目录和 readiness rollback，不透明重放生成请求。
4. telemetry 只记录 lossy aggregates，可独立关闭/回退；不影响业务 authority、schema 或持久化事实。

## 非目标与高风险边界

- 不执行 production deploy/cutover、远程 D1 migration/write/restore、生产 Redis flush、secret/Access/credential 变更、release/tag、push、force push 或历史重写。
- 不修改 Legacy/Better Auth 用户语义、Arena v1 wire/authority、签名算法、数据库 schema、持久化格式或 Hosted replay class。
- 不在 G25C 重写 14 条退出 route 的业务 service；它们重新进入 Hono 必须由后续独立 Goal 提供证据。
- 不设置无生产基线的 CPU/latency 告警阈值，不伪造入口层 DR selection/failover reason。
