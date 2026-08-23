# G25B-2 Creator 与残兽生成族 shared-service 收口实施计划

> **For agentic workers:** 本计划由当前 `/goal` 内联执行；行为修改必须遵循 RED → GREEN，最终必须经过 Builder self-review、独立 review 与 `GOAL-061` 验收。

**Goal:** 将 Creator generate/stream 与残兽 generate/stream 四条深 composition Hosted route 收口到 `@mahoshojo/hosted-api` business service + 唯一 server runtime composition + Next/Hono adapter 边界，保持现有 questionnaire、build-rule、Provider、安全、签名、活动与 stream contract。

**Architecture:** `@mahoshojo/hosted-api` 为 Creator 与残兽分别暴露非流式/流式 service factory，显式固定各 route 的 method、JSON、prepare、Provider、限速、安全、生成、活动和 finalize 顺序；不使用一个弱类型大管线抹平四条 route 的差异。`lib/hosted-api/*` 保留复杂 questionnaire/preset/DataCard、build-rule、Prompt/schema、Provider、签名与 AI meta runtime composition，并提取只在这些 composition 间复用的 questionnaire helper。Next handler 与 Hono adapter 引用同一 default service 实例，生成 registry 不再加载四个 Next route module。

**Tech Stack:** TypeScript、Web Standards `Request`/`Response`、Zod v3 compatibility、Vitest 4、Hono、Next.js、pnpm workspace。

**Governance:** `MONO-003`、`MONO-004`、`MONO-005`、`MONO-006`、`MONO-009`、`DR-004`、`DR-008`、`AI-006`、`AUTHORITY-001`、`AUTHORITY-002`、`COMPAT-001`、`COMPAT-002`、`GOAL-040`、`GOAL-050`、`GOAL-061`。

---

## 1. 当前基线、范围与 stopping condition

- source commit：`19423e61`；启动时工作树干净，分支为 `refactor/platform-rearchitecture`。
- 当前 manifest：24 条 route，`6 shared-service / 18 legacy-next`。
- 本 Goal 保留并迁移四条已经位于 Hono 白名单的 capability：
  - `creator/generate`
  - `creator/generate-stream`
  - `generate-canshou`
  - `generate-canshou-stream`
- 预期完成后为 `10 shared-service / 14 legacy-next`；不增加 Hono route，不改变客户端路由选择。
- 保留理由：四条均为项目承担成本的 Hosted generation；两条 stream 具有长连接/abort/Cloudflare CPU 价值，非流式同族继续承担 questionnaire/DataCard、签名与结果结构；当前没有 route 退出 Hono 会提升可靠性或降低成本的证据。
- 不包含 G25B-3 的魔法少女详情/升华、G25B-4/5 的状态型 route、`apps/api`/`apps/web` relocation、Hosted DR 自动切流或 Arena Room runtime。

Stopping condition 转换为以下机械结果：

1. 四条 route 的 generated registry 均只加载 `server/adapters/*`，不动态导入 `app/api/*`。
2. Next 与 Hono 对每条 route 绑定同一 default service composition。
3. Creator 非流式保留 build-rule runtime recompute、request validation、`creationInputs`/`buildState` 与签名；Creator stream 保留 build-rule prompt、SSE/普通 stream 与 abort。
4. 残兽非流式保留 preset/DataCard 原生许可、answer limit、lore、签名与 AI meta；残兽 stream 保留 lore、Provider、SSE/普通 stream 与 abort。
5. 四条 route 的 Provider resolution、限速、安全、AI、活动与 response/finalize 顺序有 package contract 与 production-composition 证据。
6. package/server/workspace/boundary/Next/OpenNext build 验证通过，独立 review 无未关闭 Critical/Important finding。

## 2. 文件结构与责任

- Create `packages/hosted-api/src/questionnaire-generation.ts`
  - `StepResult` 基础上的私有 orchestration helper；只处理 Web `Request`、步骤短路和错误 wire，不读取环境或秘密。
- Create `packages/hosted-api/src/generate-creator.ts`
  - 暴露 `createGenerateCreatorService` 与 `createGenerateCreatorStreamService`；显式保留非流式 Provider-before-rate-limit、流式 Provider-after-safety 差异。
- Create `packages/hosted-api/src/generate-canshou.ts`
  - 暴露残兽非流式/流式 service factory；保留 method/JSON/empty answers/错误 wire 和副作用顺序。
- Modify `packages/hosted-api/package.json`
  - 新增显式 exports；不暴露内部源码深层路径。
- Create `packages/hosted-api/tests/creator-canshou-generation.test.ts`
  - 手写 dependency ports，验证四条 service 的 RED/GREEN 顺序、短路、异常 wire、activity once 与 Request.signal 透传。
- Create `lib/hosted-api/questionnaire-generation.ts`
  - 提取现有三条 composition 中逐字等价的 questionnaire selection/normalization/lore/native permission/DataCard/answer-limit helper；preset 与 DataCard 通过窄 loader 注入以便真实逻辑测试。
- Create `tests/hosted-api-questionnaire-generation.test.ts`
  - 覆盖 safe preset path、preset/DataCard `nativeAllowed`、upload 拒绝、`useLore=false`、required questionnaire、answer compaction/limit 与 lore。
- Create `lib/hosted-api/generate-creator.ts`
- Create `lib/hosted-api/generate-creator-stream.ts`
- Create `lib/hosted-api/generate-canshou.ts`
- Create `lib/hosted-api/generate-canshou-stream.ts`
  - 承接原 handler 的唯一 runtime composition；复用现有 AI/provider/build-rule/questionnaire/signature/activity 实现，不复制 package 已拥有的流程控制。
- Modify four `app/api/**/handler.ts`
  - 变为薄兼容导出；route 文件、method surface 与 import 路径不变。
- Create four `server/adapters/**.ts`
  - 只引用对应 default service；不得回导 Next route/handler。
- Modify `config/hono-api-routes.json`、regenerate `server/generated/routes.ts`
  - 四条 ID 从 legacy 原子移动到 shared；总数保持 24。
- Modify `tests/server/route-manifest.test.ts`
  - 断言 `10/14` 与 generated source 无四条 legacy import。
- Create `tests/server/creator-canshou-adapters.test.ts`
  - 断言 Next/Hono handler identity、method/validation wire 和 Hono dispatcher production composition。
- Modify `tests/public-stream-abort-signal.test.ts`
  - 增加 Creator/残兽两个 stream route 的原 `Request.signal` 与上游 body/header 证据。
- Update current-state docs and create G25B-2 implementation log after review closure.

## 3. Task 1：RED——package service contract

- [ ] 先新增 package test 并导入尚不存在的 factory。
- [ ] 用事件数组分别冻结：

```text
Creator non-stream:
method/body -> prepare -> resolve-provider -> rate-limit -> safety
-> generate -> activity -> finalize

Creator stream:
method/body -> prepare -> rate-limit -> safety -> resolve-provider
-> generate(signal) -> activity -> response

Canshou non-stream/stream:
method/body -> prepare -> rate-limit -> safety -> resolve-provider
-> generate(signal for stream) -> activity -> finalize/response
```

- [ ] 覆盖每个 step 返回 `Response` 时后续步骤不运行；activity 只在生成完成后调用一次；异常调用 route-specific logger 并返回现有 500 body。
- [ ] 运行 RED：

```bash
pnpm --filter @mahoshojo/hosted-api exec vitest run --config vitest.config.ts tests/creator-canshou-generation.test.ts --reporter=verbose
```

Expected：目标 module 不存在；失败不是 fixture/环境错误。

## 4. Task 2：GREEN——package services

- [ ] 实现四条显式 factory；公共依赖形状如下，实际 Creator/残兽文件用具体名称暴露，不向消费者暴露无语义的 route config：

```ts
type GenerationDependencies<Prepared, Execution, Generated> = {
  prepare(request: Request, body: unknown): Promise<StepResult<Prepared>>;
  resolveExecution(request: Request, input: Prepared): Promise<StepResult<Execution>>;
  checkRateLimit(request: Request, input: Prepared): Promise<Response | null>;
  enforceSafety(request: Request, input: Prepared): Promise<Response | null>;
  generate(request: Request, input: Prepared, execution: Execution): Promise<StepResult<Generated>>;
  recordActivity(request: Request): void;
  buildResponse(request: Request, input: Prepared, generated: Generated): Response | Promise<Response>;
  logError(error: unknown, input?: Prepared): void;
};
```

- [ ] 保留 Creator 非流式 invalid JSON 的 `400 Invalid JSON body`，其余三条 malformed JSON 进入各自既有 `500` wire。
- [ ] 不在 package 中引入 Provider secret、preset JSON、DataCard、Next/Hono、数据库或环境变量。
- [ ] 运行 GREEN：

```bash
pnpm --filter @mahoshojo/hosted-api test
pnpm --filter @mahoshojo/hosted-api lint
pnpm --filter @mahoshojo/hosted-api build
```

## 5. Task 3：RED/GREEN——questionnaire 与 runtime composition

- [ ] 先新增 questionnaire helper 测试，导入尚不存在的 module，确认 RED。
- [ ] 从 legacy handlers 等价提取共同 helper，保留：
  - preset path allowlist 与 same-origin URL；
  - preset `nativeAllowed !== false` 与 DataCard `nativeAllowed === true` 的现有差异；
  - upload/不可信来源不能取得签名；
  - required questionnaire、`useLore=false`、unmatched answer 与 answer limit 语义；
  - server 仍重新决定 `allowNativeSignature`，不相信客户端声明。
- [ ] 将四个 legacy handler 的 runtime 实现搬入 `lib/hosted-api/*`，按 package port 拆为 prepare/provider/rate/safety/generate/finalize；Prompt/schema、Provider `CUSTOM`/system fallback、AI meta、signature payload 和日志文案保持不变。
- [ ] Next handler 变成薄兼容导出，运行既有 Creator/安全回归与新增 helper tests：

```bash
pnpm exec vitest run \
  tests/hosted-api-questionnaire-generation.test.ts \
  tests/creator-endpoints.test.ts \
  tests/creator-request-guards.test.ts \
  tests/creator-build-rule-projection.test.ts \
  tests/creator-build-rule-runtime.test.ts \
  tests/creator-build-rule-selection.test.ts \
  tests/creator-build-rules.test.ts \
  tests/public-ai-input-safety.test.ts --reporter=verbose
```

## 6. Task 4：RED/GREEN——双 adapter、manifest 与 production contract

- [ ] 先把 manifest test 改为期待 `10 shared / 14 legacy`，为四条 adapter identity/dispatcher/abort 增加测试；运行确认旧 manifest/缺 adapter 导致 RED。
- [ ] 新建四个 Hono adapter、原子移动 manifest、运行 generator；不改变 24 条总 route 或客户端 `hono-api-routes` 消费。
- [ ] production contract 至少证明：
  - Creator build-rule runtime result 由服务端重算，response 含 canonical `creationInputs`/`buildState`；
  - 原生签名只在 server-resolved questionnaire permission 后产生；
  - 残兽 preset/DataCard/lore 进入现有 prompt/finalize；
  - AI meta、activity header/order、stream headers/body 与 abort 保持；
  - Next/Hono handler identity 与 method/validation wire 一致。
- [ ] 运行：

```bash
pnpm run server:routes
pnpm exec vitest run \
  tests/server/route-manifest.test.ts \
  tests/server/creator-canshou-adapters.test.ts \
  tests/server/route-dispatcher.test.ts \
  tests/server/hono-app.test.ts \
  tests/public-stream-abort-signal.test.ts --reporter=verbose
pnpm run check:workspace:boundaries
pnpm exec tsc --noEmit -p tsconfig.server.json
pnpm run build:server
```

## 7. Task 5：文档、Builder self-review 与 independent review

- [ ] 更新 topic、`packages/README.md`、`server/README.md` 为实际 `10 shared / 14 legacy`，并记录剩余 G25B-3..5 family。
- [ ] 新增 G25B-2 实施日志，记录 source commit、TDD、capability 保留/退出裁决、验证、回滚、影响和下一 Goal 重估。
- [ ] Builder self-review 完整 diff：architecture/dependency、secret/authority、questionnaire/DataCard/signature、Provider/activity/AI meta、stream/replay/data、compatibility 与 test adequacy。
- [ ] 使用独立 subagent 按同样四维审查；Critical/Important 必须先补 RED 再修复，Minor 修复或给出不阻塞理由。

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

如 runtime smoke 仍因缺少本地 Redis/D1 Gateway 安全隔离环境 fail-closed，只能按实际说明是否阻塞本 Goal；不得使用生产依赖替代。production deploy/cutover、远程 DB/Redis、secret、release/tag 均不执行。

## 9. 回滚

- 代码回滚：按 atomic commit 逆序 revert，恢复四个 legacy handler、package exports、manifest `6 shared / 18 legacy` 与 generated registry。
- runtime 回滚：Web 同源 Next adapter 始终保留；若未来部署本实现，Hono 使用既有 artifact/container runbook 回退上一 bundle。
- 无 schema migration、数据回填、secret/Access/credential 变更、release/tag；无需数据或凭据回滚。
