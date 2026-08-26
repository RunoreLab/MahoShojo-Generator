# G25H-2 Details 与 Sublimation 双入口实施计划

> 状态：`completed`（2026-08-26）

> **执行要求：** 使用 executing-plans；每项行为修改遵循 test-driven-development；完成前使用 verification-before-completion 与独立 review。

**Goal：** 四条 Details / Sublimation 路由采用 Hono primary + Next DR 的同一 shared service，保留签名、问卷、安全、Provider、Arena history/finalize 与 wire 兼容，并形成可比较的 operation/placement telemetry。

**基线重估：** `05b64453`，18 shared / 10 exited / 0 legacy；四个 legacy handler 共 2,341 行。预计 6–8 小时，拆为五个可回滚 checkpoint；若 Sublimation 的纯规则下沉暴露不能在本 Goal 闭合的 schema 冲突，Details checkpoint 可独立保留，Sublimation 必须标记 BLOCKED，不能移动验收标准。

## Task 1：基线与 RED 合同

**Files：** `packages/domain/tests/*sublimation*`、`packages/hosted-api/tests/*details*sublimation*`、`tests/*parity*`

1. 运行当前 domain/hosted-api/hosted-runtime/api/web targeted tests，记录 baseline。
2. 为角色卡转换、Arena history/finalize 的 package ownership 写测试；确认因 export/实现缺失而 RED。
3. 为 Details/Sublimation 应用服务的 method、步骤顺序、短路、异常脱敏、abort 写测试；确认 RED。
4. 为四路 Hono/Next 默认 service identity、route manifest 22/6/0 写测试；确认 RED。

## Task 2：Checkpoint 1 — Sublimation 领域规则下沉

**Files：** `packages/domain/src/sublimation.ts`、`packages/domain/package.json`、`apps/web/lib/data-card-converter.ts`、`apps/web/lib/sublimation/{arena-history,finalize}.ts`、相关 tests

1. 将角色目标模板转换、retention normalization、history entry/strategy、final data merge 下沉到 domain。
2. Web converter 对 magical-girl/canshou/general 目标调用 domain implementation 后用既有 schema parse；场景转换保持 Web 内部实现。
3. Web Sublimation helper 改为 thin re-export，避免双份权威规则。
4. 运行 domain tests + Web converter/finalize/history tests + typecheck/lint。
5. 形成原子提交；回滚为 revert 本 checkpoint。

## Task 3：Checkpoint 2 — Details shared runtime

**Files：** `packages/hosted-api/src/generate-magical-girl-details.ts`、`packages/hosted-runtime/src/generate-magical-girl-details*-runtime.ts`、package exports/default-services、Web thin handlers、相关 tests

1. 先补 Details structured/stream runtime RED：native questionnaire/signature、over-limit、答案映射、安全逐项短路、Provider wire、AI meta、activity、SSE/reasoning 与 abort。
2. 实现 shared application service 与两个 runtime，复用 questionnaire/static assets/Node ports。
3. 扩展 default services；Web 两个 handler 改为同一默认 service adapter。
4. 运行 hosted-api/runtime/Web targeted tests、typecheck/lint 与 ownership boundary。
5. 形成原子提交；inventory 仍保持 Next-only，回滚不影响其他路由。

## Task 4：Checkpoint 3 — Sublimation shared runtime

**Files：** `packages/hosted-api/src/generate-sublimation.ts`、`packages/hosted-runtime/src/generate-sublimation*-runtime.ts`、default-services、Web thin handlers、相关 tests

1. 先补 Sublimation structured/stream runtime RED：模板推断/转换 fallback、字段保留、guidance/history/lore 裁剪、安全排除 signature/userAnswers、Provider、签名 verify/re-sign/fail-closed、Arena history/current_state/finalize、AI meta、SSE/reasoning 与 abort。
2. 实现 shared service/runtime，native lore 仅由服务端 selection 重载，默认问卷来自 package static assets。
3. 扩展 default services；Web 两个 handler 改为同一默认 service adapter。
4. 运行 domain/hosted-api/runtime/Web targeted tests、typecheck/lint 与 compatibility checks。
5. 形成原子提交。

## Task 5：Checkpoint 4 — Hono re-entry 与 telemetry

**Files：** `apps/api/src/adapters/*`、`config/hono-api-routes.json`、generated routes、telemetry、CORS exposure、API/root tests、README/topic/plan/log

1. 先补四个 Hono adapter identity/success/error/stream abort 与 telemetry RED。
2. 新增 adapter；inventory 改为 22 shared / 6 exited / 0 legacy，运行生成器。
3. 增加 fixed operation/placement lifecycle observation；Hono snapshot 聚合，Next DR 结构化输出；不记录用户载荷。
4. 更新 route-manifest、Hono app/client/parity、ownership/compatibility 测试和机器可读配置。
5. 更新 `apps/README.md`、`packages/README.md`、`apps/api/README.md`、topic 与本 Goal 实施日志。
6. 运行 API/Web targeted tests、routes、runtime verification、boundary tests、Hono bundle 与 Cloudflare build。
7. 形成原子提交。

## Task 6：全量验证、自审与独立审查

1. Builder self-review：逐项核对 accepted MUST/MUST NOT/ACCEPT、diff、secret/log、app/package boundary、non-idempotent replay 与 rollback。
2. 运行 Goal 完整 contract/server/workspace/build 验证，保存准确命令、exit code 与既有 warning。
3. 使用独立 subagent/Codex context 审查 architecture、security/authority、compatibility/replay/data、test adequacy。
4. 修复所有 Critical/Important；Minor 修复或在日志说明不阻塞 stopping condition 的依据；重新运行相关验证。
5. 更新实施日志、topic、退出审计材料；确认 stopping condition 后才完成 Goal。

## 完整验证矩阵

```bash
pnpm --filter @mahoshojo/domain test
pnpm --filter @mahoshojo/domain build
pnpm --filter @mahoshojo/domain lint
pnpm --filter @mahoshojo/hosted-api test
pnpm --filter @mahoshojo/hosted-api build
pnpm --filter @mahoshojo/hosted-api lint
pnpm --filter @mahoshojo/hosted-runtime test
pnpm --filter @mahoshojo/hosted-runtime build
pnpm --filter @mahoshojo/hosted-runtime lint
pnpm --filter @mahoshojo/api test
pnpm --filter @mahoshojo/api build
pnpm --filter @mahoshojo/api lint
pnpm --filter @mahoshojo/web test
pnpm --filter @mahoshojo/web lint
pnpm server:routes
pnpm verify:server:runtime
pnpm build:server
pnpm build:cf
pnpm test
pnpm lint
pnpm typecheck
```

若 manifest、边界或 contract 跨 workspace 证据需要，追加仓库既有 `ci:verify`；不得把未运行命令写成通过。

## 完成记录

五个 checkpoint 及 review 整改已按可回滚提交闭合。最终实现满足 22/6/0 inventory、同 service 双入口、DataCard ownership 与 native signature fail-closed、Sublimation history/finalize 权威、固定 operation/placement telemetry 和流式终态最多一次。完整命令、审查 finding、状态矩阵与回滚顺序见 [G25H-2 实施与退出审计](../logs/2026-08-26_160740_平台重整G25H-2_Details与Sublimation双入口实施与退出审计.md)。
