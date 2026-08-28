# Arena 多人 GMR-10 运行时 Hardening 与退出审计实施计划

日期：2026-08-28

状态：`implementing`

实现基线：`14d0e58d`

关联设计：[Arena 多人 GMR-10 运行时 Hardening 与退出审计设计](../specs/2026-08-28_235400_Arena多人GMR-10运行时Hardening与退出审计设计.md)

## 1. Atomic checkpoints

### Checkpoint A：telemetry v5 contract（TDD）

- 先扩展 `runtime-telemetry.test.ts`：schemaVersion 5、Room 固定词汇、interval reset、active/peak gauge、fail-soft、无敏感字段；
- 新增 `arena-room/runtime-observer.ts`，再让 `HonoRuntimeTelemetry` 实现 observer；
- targeted telemetry test + API build/lint；
- checkpoint：`feat(api): 增加 Arena Room telemetry v5`。

### Checkpoint B：Room component instrumentation（TDD）

- actor/registry：open/resident gauge、queue/depth/latency/overload、create/recover/fence/quarantine/replacement-required；
- Redis store/runtime：checkpoint op/outcome/serialized bytes 与 Room Redis latency/error；
- WSS authority/gateway：Room socket、reconnect/current/replay/snapshot/resync、outbound backlog/slow consumer；
- publisher/service：active/in-flight、published/rejected/drop/error；
- 每个模块先写负向/observer-throw 回归，确保 telemetry fail-soft；
- targeted Room/Redis/WSS/publisher tests + API full test/build/lint；
- checkpoint：`feat(api): 接入 Room hardening 指标`。

### Checkpoint C：fault manifest 与副作用证据（TDD）

- 新增十类 drill manifest + validator + root CI check；
- 真实 Redis generation verifier 增加 rating settlement/story impact exactly-once counters；
- 增加 exact checkpoint loss 与组合 VPS-unreachable drill；
- targeted tests、generation verifier、secret scan；
- checkpoint：`test(arena): 固化 GMR-10 故障与副作用证据`。

### Checkpoint D：安全负载 verifier

- opt-in、loopback-only、安全 prefix、精确 namespace cleanup 在任何连接/spawn/SCAN/DEL 前验证；
- 32 rooms × 4 real ws × 20 transitions，输出真实 telemetry 与 Redis process delta；
- 纳入 API verifier tsconfig、lint/build、package script；普通测试覆盖非法 URL/prefix 零连接；
- 本机 Redis 7.0.15 真实运行并记录事实；
- checkpoint：`test(arena): 增加 Room 非生产负载基线`。

### Checkpoint E：退出审计与独立复审

- 更新 design/plan/topic/Goal guide/API README，新增 GMR-10 实施日志；
- targeted → API → workspace → `pnpm ci:verify`；
- 三路独立 review：architecture/authority、security/replay/data、test adequacy/load；
- 修复全部 Critical/Important，Minor 修复或记录明确 non-blocking stopping rationale；
- checkpoint：`docs(arena): 记录 GMR-10 hardening 退出证据`。

## 2. Stop / blocker

命中 Goal 指南第 7 节即停止并提案，尤其是需要多实例 ownership/DO、修改 public wire/Room data ownership、放宽 secret/
authority/fail-closed、不安全清理、生产操作或凭空设置 SLA。普通内部 observer shape、测试 workload 与固定 metric 名称可在本 Goal
内依据证据调整。

## 3. Validation order

每个 checkpoint 运行受影响 tests/typecheck/lint；最终至少运行：

```text
pnpm --filter @mahoshojo/api test
pnpm --filter @mahoshojo/api run build
pnpm --filter @mahoshojo/api run lint
pnpm run check:arena-room-hardening
真实 loopback Redis Room/generation/process/hardening verifiers
pnpm ci:verify
git diff --check
```

既有 naming report-only、preview/physical production D1 与 production control plane 继续 no-new-regression / `DEFERRED`。
