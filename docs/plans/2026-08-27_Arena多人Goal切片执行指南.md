# Arena 多人 `/goal` 切片执行指南

状态：`active / execution-guide`
日期：2026-08-27
指南标识：`GUIDE-arena-multiplayer-goal-slicing-v1`
适用分支：`refactor/platform-rearchitecture` 及从其切出的 Arena 多人功能分支/工作树
首个基线：`cbe29d8c3aff16c9a87a9c7e20d03056d7d5af85`

## 1. 用途与权威边界

本文用于把 Arena 多人 Hono + Redis v1 拆成适合 Codex `/goal` 持续推进的**单轮可验证切片**。它是执行索引、状态总账和停止条件，不是新的产品规格或架构 ADR。

权威优先级：

1. `docs/topics/2026-08-22_022000_平台重整与本地优先架构.md`：当前平台状态、并行授权与生产 blocker；
2. `ADR-arena-room-portable-runtime-hono-redis-first`：Room runtime 架构决策；
3. `SPEC-arena-multiplayer-hono-redis-runtime-amendment-v1` + 未被覆盖的 Arena v1 业务规格；
4. `PLAN-arena-multiplayer-hono-redis-v1`：阶段顺序和交付边界；
5. 本指南：如何把计划切成 `/goal` 工作单元。

若本文与上位 accepted ADR/spec 冲突，当前 Goal MUST 停止并以 ADR/spec 为准；不得为“完成 Goal”改写上位语义。

## 2. `/goal` 使用原则

Codex `/goal` 只保存短目标；长约束、验收和背景放在版本化文件中。推荐 Goal 文案：

```text
完成 docs/plans/2026-08-27_Arena多人Goal切片执行指南.md
中状态为 READY 的最前一个 GMR Goal。
只做该切片；遵守 Entry / Scope / Forbidden / Done / Validation。
验证失败先修复当前切片，不进入下一 Goal。
命中 Stop-and-escalate 时立即停止并汇报。
完成后更新本指南的状态/证据与必要的 docs/logs。
```

不要把整个 B1–G 重新复制进 `/goal` 文本；Goal 只指向本文和目标 GMR ID。

每个 Goal 必须执行同一闭环：

```text
read authority / current state
  -> plan only this slice
  -> implement
  -> targeted tests
  -> broader required validation
  -> inspect diff / failure modes
  -> repair until green
  -> update status + evidence
  -> stop
```

一次 Goal SHOULD 只解决一个可解释 milestone。若一个 Goal 无法在一轮“实现 + 验证 + 文档证据”中闭合，应继续拆分为 `GMR-xxA/B`，而不是扩大上下文或跳过验证。

## 3. 双门禁

### Development Gate：`PASS`

允许：

- 本地/CI/隔离 Redis/D1/fault-injection；
- `packages/contracts` / `packages/multiplayer-core`；
- `apps/api` RoomActor、Redis checkpoint、WSS、ticket、reconnect；
- feature-flagged Arena UI / Proposal；
- in-process Room generation publisher；
- 非生产 load/failure drills。

### Production / Integration Gate：`BLOCKED / DEFERRED`

在平台现有 blocker 和授权/runbook 完成前禁止：

- production Room WSS/ticket 对用户开放；
- DNS/LB/Access/credential 变更；
- production D1 migration/write/drill；
- 为多人功能放宽 production Web build / DR fail-closed guard；
- 把 `ACCEPT-018` / `ACCEPT-014` 的 `PARTIAL` 写成 PASS；
- 把 Room realtime 加入 Cloudflare DR manifest；
- 宣称活动 Room 可跨 Hono/VPS 故障域无缝热迁移。

## 4. Goal 状态规则

状态只使用：

- `READY`：依赖满足，下一次 `/goal` 可以执行；
- `BLOCKED`：依赖前置 Goal；
- `DEFERRED`：明确不属于当前 v1 开发窗口；
- `IN_PROGRESS`：仅在实际工作正在该 Goal 上进行时使用；
- `DONE`：Done + Validation + evidence 全部闭合；
- `FAILED_REVIEW`：实现存在但审查/验证未通过，必须修复本 Goal。

状态不能仅因“代码已写”改成 `DONE`。

## 5. Goal 总账

| Goal | 状态 | 依赖 | 主要结果 | 硬停止 |
| --- | --- | --- | --- | --- |
| `GMR-00` 文档 re-baseline | `DONE` | 无 | 双门禁、Hono+Redis 架构、Goal 指南一致 | 无 |
| `GMR-01` runtime-neutral state machine | `DONE` | GMR-00 | pure transition + epoch/revision fixture | 不引入 Hono/Redis |
| `GMR-02` Redis conditional checkpoint | `DONE` | GMR-01 | CAS checkpoint + TTL + fail-closed | 不做 WSS/UI |
| `GMR-03` single-writer RoomActor | `DONE` | GMR-02 | actor registry/queue/recovery/shutdown | 不做 multi-instance |
| `GMR-04` Node WSS security skeleton | `DONE` | GMR-03 | Node WS bootstrap + upgrade/security/backpressure | 不做产品 UI |
| `GMR-05` ticket/membership/reconnect/lifecycle | `DONE` | GMR-04 | membership/connection/epoch recovery | 不做 generation fan-out |
| `GMR-06` D1 directory/discovery | `DONE` | GMR-05 | derived directory + orphan cleanup | 不执行生产 migration |
| `GMR-07` Arena room UI | `DONE` | GMR-05 | feature-flagged create/join/status/reconnect | 不激活 production |
| `GMR-08` Proposal E2E | `DONE` | GMR-05,GMR-07 | typed Proposal server/UI 闭环 | 不扩展 private sharing |
| `GMR-09` generation publisher | `READY` | GMR-03,GMR-05,GMR-07 | single producer + Room safe fan-out/resync | 不复制 AI lifecycle |
| `GMR-10` hardening/fault/load audit | `BLOCKED` | GMR-06,GMR-08,GMR-09 | telemetry + failure drills + v1 exit audit | 不自动进入生产 |
| `GMR-11` production activation review | `DEFERRED` | GMR-10 + Production Gate | 独立生产 go/no-go | 必须人工/平台授权 |
| `GMR-H` multi-instance / DO evaluation | `DEFERRED` | 真实指标触发 | 新 ADR/PoC 决策 | v1 不预建 |

`GMR-06` 与 `GMR-07` 在 GMR-05 后 MAY 并行，但一个 `/goal` 仍只执行其中一个。`GMR-08` 和 `GMR-09` 只有在各自依赖满足后才可按冲突最小的顺序推进。

## 6. Goal 详细定义

### GMR-00 文档 re-baseline

**Objective**

让当前 topic、平台计划、目标架构、Arena runtime amendment 和 Hono+Redis plan 对“首发运行时 + 双门禁 + `/goal` 推进方式”只有一套现行解释。

**Done**

- active architecture 不再把 DO/`apps/arena-room` 写成 v1 主路径；
- runtime spec/plan 不再把完整 Phase 2.5 PASS 作为开发启动条件；
- platform plan 与最新 topic 的并行授权一致；
- 本指南存在并给出可执行 Goal 总账；
- 不改变任何生产运行代码。

**Validation**

- 文档链接/标识人工核对；
- `git diff --check`；
- 若以 patch 交付，按 patch 交付流程验证基线 blob、`git apply --check`、真实 apply 与应用后 SHA-256。

本指南初始 `GMR-00 = DONE` 的含义是：本文与配套四份 re-baseline 文档通过同一 patch 应用后，文档切片已闭合；若改为手工复制文件，必须重新执行等价一致性检查后才能沿用该状态。

### GMR-01 runtime-neutral state machine

**Entry**

- GMR-00 DONE；
- current `packages/multiplayer-core` tests 可运行。

**Scope**

只补真实 runtime 必需的 pure transition：

- room create/close；
- membership mutation；
- host publish；
- Proposal submit/resolve/withdraw；
- generation reservation/mirror；
- `roomEpoch` validation；
- transition result / error semantics。

优先复用已有 `projection/diff/conflicts/apply/selection`，不得重写已验证逻辑。

**Forbidden**

- Hono import；
- Redis client；
- Node WebSocket；
- D1 I/O；
- production config；
- 新 UI。

**Done / Validation**

- `packages/multiplayer-core` 无 framework/runtime import；
- current + new transition/epoch/secret-negative/old-new protocol fixtures 通过；
- mutation 的 predecessor/next-state 语义可供 Redis adapter 使用；
- package test/typecheck/lint 和仓库要求的相关 gate 通过。

**Evidence（2026-08-28）**

- Goal ID：`GMR-01`；source SHA：`b8c85ca08ae37f0a917471c335cf16fb033aa288`；
- changed files：`packages/multiplayer-core` state machine/model/provenance/fixtures/tests、package manifest/lockfile，以及 `ROOMRT-006A` 与对应实施计划边界；
- validation：multiplayer-core `65/65` tests、typecheck/build、lint、workspace boundary、全 workspace tests/lint/build 与 `git diff --check` 均通过；既有 naming audit `1378` 条维持 report-only，无新增阻断；
- fault cases：old epoch/revision/control sequence、重复/冲突 replay、terminal regression、伪造/序列化 authority capability、可信时间回填/到期边界、checkpoint sidecar/digest poisoning、aggregate oversize 与配额耗尽 fail closed；
- public wire/schema change：`no`（新增的是首次持久化前的内部 `authorityStateVersion=1` checkpoint schema）；production action：`no`；
- independent review：architecture、security/authority、compatibility/replay/data、test adequacy 最终均为 Critical `0` / Important `0` / Minor `0`；
- open findings：无；next READY Goal：`GMR-02`；完整证据见 [GMR-01 实施与审查整改日志](../logs/2026-08-28_014046_Arena多人GMR-01纯状态机实施与审查整改日志.md)。

### GMR-02 Redis conditional checkpoint

**Entry**

- GMR-01 DONE。

**Scope**

在 `apps/api` 建立 `RedisRoomStore` / checkpoint port adapter：

- versioned checkpoint；
- `roomEpoch + revision` 或等价 checkpoint version predecessor；
- `WATCH` + transaction、Lua CAS 或等价条件写；
- TTL；
- load/save/delete/expire；
- Redis unavailable fail closed；
- stale predecessor conflict；
- acknowledged mutation restart recovery。

提交顺序必须是：

```text
validate -> pure derive -> conditional checkpoint
-> install actor next state -> ack/broadcast
```

**Forbidden**

- 普通无条件 `SET` 覆盖；
- Pub/Sub/Streams 预建；
- WSS/ticket；
- D1 presence；
- production Redis flush/migration。

**Done / Validation**

- create/load/mutate/close/TTL；
- stale writer/old epoch 无法覆盖新 checkpoint；
- Redis restart 后恢复最后 acknowledged state；
- Redis unavailable 不产生 memory-only fake success；
- command timeout/conflict 有稳定内部错误；
- targeted tests + `apps/api` test/typecheck/lint 通过。

**Evidence（2026-08-28）**

- Goal ID：`GMR-02`；source SHA：`c80e6d6b3a1827f1b5c1aaa0a9cf27a7549ad28b`；
- changed files：`apps/api` 的 `RedisRoomStore`、`RedisRuntime` adapter、真实 Redis verifier、fixture/tests 与 verifier
  tsconfig，`packages/multiplayer-core` 的一次性 transition checkpoint receipt，以及 CI/repository ownership gates；
- validation：multiplayer-core `68/68`、API `207/207`、root `191/191`、Web `1893/1893` tests，受影响 package
  typecheck/build/lint、workspace boundary、完整 `pnpm run ci:verify` 与 `git diff --check` 均通过；既有 naming audit
  `1378` 条维持 report-only，physical D1 probe 与 preview environment 继续按既有口径 `DEFERRED`；
- fault cases：stale/old epoch、完整 predecessor payload collision、v1 active/v2 expiring compatibility、一次性 receipt、
  Redis unavailable/timeout/unknown response、malformed/secret-negative、delete/expire/TTL 后 same-epoch resurrection、
  ledger type/容量 fail-closed 且不污染，以及 Redis 8.2 full 与 AOF write → restart → read recovery；
- public wire/schema change：`no`；内部 Redis schema 增加 versioned checkpoint envelope 与每 `roomId` 最多 16 epoch
  的无 TTL negative ledger；production/schema migration/secret/release action：`no`；
- independent review：architecture、security/authority、compatibility/replay/data、test adequacy 最终均为 Critical `0` /
  Important `0` / Minor `0`；先前 expiry 单调性、完整 predecessor、receipt/epoch resurrection 与 destructive test
  coverage findings 均已关闭；
- open findings：无；next READY Goal：`GMR-03`。

### GMR-03 single-writer RoomActor

**Entry**

- GMR-02 DONE。

**Scope**

- `roomId -> RoomActor` registry；
- per-room serialized command queue；
- bounded queue；
- actor hydration/eviction；
- process restart 从 Redis warm recovery，并切新 epoch；
- shutdown 停止新 authority-changing command、drain/close；
- 单实例 fan-out 基础。

**Forbidden**

- 多 room-capable replica；
- Redis distributed lock/lease；
- Pub/Sub/Streams；
- DO；
- WSS product surface。

**Done / Validation**

- concurrent command ordering；
- queue overload/backpressure；
- restart + recovery fencing；
- old callback/actor rejected；
- graceful shutdown/fault test；
- single-writer invariant 可被测试证明。

**Evidence（2026-08-28）**

- Goal ID：`GMR-03`；source SHA：`2970400b7bda35b9e3ca2e11e1c42f4adb6a68bf`；
- changed files：`packages/multiplayer-core` recovery/quota-close authority 与 tests，`apps/api` RoomActorRegistry、Redis
  Room store、process lifecycle、真实 Redis verifier/tests，以及本 spec/plan/guide/log；
- validation：multiplayer-core `73/73`、API `235/235`、root `191/191`、Web `1893/1893` tests；API/core
  build/lint、workspace boundary、完整 `pnpm run ci:verify`、Next production build `188/188` pages 与
  `git diff --check` 通过；首次全仓并发运行有 10 个 unrelated Web test timeout，isolated `50/50` 与第二次完整
  Web `1893/1893` 均通过，未修改 timeout/测试实现；既有 naming audit `1378` 条保持 report-only，physical D1
  probe 与 preview environment 保持既有 `DEFERRED`；
- fault cases：同 Room 并发严格串行、bounded queue/actor/subscriber/fenced tombstone、checkpoint-before-install/fan-out、
  CAS conflict fencing、idempotent old actor、rich warm recovery/new epoch、terminal hydrate、recovery/quota conflict、
  exact replay quota runtime close、Redis unavailable retry、idle eviction、slow subscriber、graceful/force shutdown；
  Redis 8.2 full 与 AOF write → restart → read 覆盖 legacy load/bootstrap、GET→TTL race、未观察 legacy TTL 后
  client-chosen create 拒绝、old actor/epoch fence；
- create authority：普通 `execute(create)` 在 Redis/actor 前拒绝；唯一 runtime create entry 由服务端签发随机
  `roomId` / `roomEpoch` / timestamp，host role/membership/joinedAt 不取信客户端；
- public wire/schema change：`no`；内部 Redis active v1 envelope 保持兼容，incarnation ledger/load bootstrap 语义补强；
  production migration/secret/release action：`no`；当前没有 production Room 数据，activation 若发现 legacy key 必须
  先阻断并迁移 ledger；
- independent review：architecture/compatibility/replay/data、security/authority 与 test adequacy 最终均为 Critical `0` /
  Important `0` / Minor `0`；发现的 idempotent stale actor、legacy predecessor resurrection、quota close、terminal
  hydrate、容量/slow subscriber、legacy load TTL race 与 client-chosen identity findings 已全部关闭；
- open findings：无；next READY Goal：`GMR-04`。

### GMR-04 Node WSS security skeleton

**Entry**

- GMR-03 DONE。

**Scope**

- 按当前 Hono Node 官方方案接入 `ws` / `WebSocketServer` 或等价 adapter；
- WSS route/version envelope；
- server lifecycle + graceful shutdown；
- upgrade middleware isolation；
- exact Origin allowlist；
- schema/size/rate limit；
- per-user connection cap；
- ping/pong heartbeat + idle/dead cleanup；
- bounded send queue；
- slow-consumer close/resync skeleton。

**Forbidden**

- `@hono/node-ws` 新依赖；
- production public hostname/routing 变更；
- 完整 create/join UI；
- 绕过 ticket/auth 的“临时公开测试入口”。

**Done / Validation**

- real upgrade regression test；
- Origin allow/deny；
- oversized/flood；
- dead connection；
- connection cap；
- slow consumer；
- shutdown closes/drains sockets safely；
- HTTP existing routes 无回归。

**Evidence（2026-08-28）**

- Goal ID：`GMR-04`；source SHA：`891ccec3380d75d0b49648dd780151e94d91225a`；
- changed files：`packages/contracts` versioned Room WebSocket transport envelope/size parser/tests；`apps/api`
  `ws` dependency、isolated Hono upgrade app、Node dispatcher/server、gateway policy、main lifecycle、unit/real-upgrade tests，
  以及 root API production closure assertion；
- transport：固定 path `/api/arena/rooms/v1/ws` 与 subprotocol `mahoshojo.arena-room.v1`；`WebSocketServer`
  使用 `noServer`、64 KiB `maxPayload`、关闭 `perMessageDeflate`；HTTP middleware chain 与 upgrade route 隔离；
- security/lifecycle：raw Node method、key/version/protocol grammar、exact Origin 在 authorizer 前校验；无 Origin 的
  installed client 仍必须通过 authorizer；authorization grant 无 gateway-side pending state、使用 module-private brand
  且只可消费一次，active cap 在 `onOpen` 同步占用；connection/user rate、heartbeat、bounded send queue、slow-consumer
  close/resync、1012 graceful shutdown/timeout terminate 均已实现；
- activation：`main.ts` 使用空 browser Origin allowlist 与默认 deny authorizer；browser 返回 403、无 Origin client
  返回 503。成功 authorizer 只由测试注入，未实现或绕过 GMR-05 ticket/membership，未激活 production public WSS；
- validation：real Node upgrade + gateway `23/23`、API `258/258`、contracts `118/118`、root `191/191`、Web
  `1893/1893`、multiplayer-core `73/73`；API/contracts build/lint、API bundle、workspace boundary、完整
  `pnpm run ci:verify`、Next production build `188/188` pages 与 `git diff --check` 通过；既有 naming audit `1378`
  条保持 report-only，physical D1/preview 保持既有 `DEFERRED`；
- fault cases：Origin suffix、wrong/malformed protocol、raw `POST + Upgrade`、missing key、default deny、malformed
  handshake 后立即合法重连、grant replay/expiry/concurrent activation、active close/reconnect、binary/oversized/flood、
  shared user rate、dead pong、slow consumer、shutdown/HTTP close ordering与普通 HTTP no-regression；
- independent review：首轮发现 raw method 在 Hono adapter 重建 Request 后丢失，以及底层握手失败遗留 pending cap
  两项 Important、real close/reconnect 一项 Minor；`891ccec3` 全部整改并回归，architecture/compatibility/lifecycle、
  security/authority/backpressure 与 test adequacy 最终均为 Critical `0` / Important `0` / Minor `0`；
- public wire/schema change：`yes`（新增 versioned internal Development Gate WSS transport contract），但当前无可成功
  production authority；production/schema/secret/release action：`no`；
- open findings：无；next READY Goal：`GMR-05`。

### GMR-05 ticket / membership / reconnect / lifecycle

**Entry**

- GMR-04 DONE。

**Scope**

- short-lived signed ticket；
- ticket binds room/user/capability hint/exp/jti/protocol；
- 使用 server-owned signing capability；若必须新增独立 signing secret，先完成配置/轮换/日志脱敏设计，production secret provisioning 仍留到 Production Gate；
- current server membership 覆盖 role hint；
- membership 与 connection 分离；
- kick/leave/host close；
- multi-tab；
- same-epoch snapshot/bounded replay；
- new-epoch full snapshot/rejoin；
- host-offline/idle deadline；
- Redis TTL/lazy validation/process scheduler。

**Forbidden**

- Origin 作为 installed-client trust root；
- socket close == leave；
- timer 作为 destructive correctness 唯一依据；
- production activation。

**Done / Validation**

- refresh/network switch 不等于 leave；
- ticket replay/kick rejected；
- multi-tab 不重复成员；
- old epoch command rejected；
- process restart warm recovery；
- heartbeat/dead connection；
- deadline cleanup 幂等。

**Evidence（2026-08-28）**

- Goal ID：`GMR-05`；source SHA：`d99c07e9e258507f0e9122c580723015b16dd683`；
- changed files：`packages/contracts` ticket/reconnect transport contract，`packages/multiplayer-core` authority state v2、
  membership/presence/deadline capability 与兼容 parser，`apps/api` ticket codec、Redis replay、membership service、
  WebSocket authority/gateway、RoomActor lifecycle/replay/deadline、runtime composition、真实 Node/Redis tests/verifier；
- ticket/authority：45 秒、最长 60 秒的 domain-separated signed ticket 绑定 protocol/room/epoch/user/role hint/iat/exp/jti/
  reconnect cursor；upgrade 前 Redis 原子消费 `jti`，随后以 current checkpoint membership/role 覆盖 hint，kick/revoke、
  epoch stale、replay 与 unavailable 均 fail closed；
- membership/reconnect：account membership 与 connection presence 分离；multi-tab 复用同一 member，单 socket close 只
  更新 presence；same epoch 使用有界 replay 或 snapshot，recovery/new epoch 使用 full snapshot，fence/terminal 会关闭 peers；
- lifecycle：authority state v2 持久化 host-offline/idle deadline；严格 v1 load 以 exact-CAS + `KEEPTTL` 迁移，legacy
  open state 得到已到期 deadline 并 fail closed；scheduler、lazy recovery/resolve 与每个 queued command 的 apply
  线性化边界均重新验证 deadline，queued presence 不能在到期后清除期限；
- activation：`ARENA_MULTIPLAYER_ENABLED` 默认关闭，production/preview 明确拒绝 `true`；当前没有 create/join/ticket
  HTTP 产品入口，未激活 production WSS、DNS/LB/Access 或 secret；ticket 复用既有 server-owned signature service，
  以 `arena-room-ticket-v1` purpose 隔离；
- validation：API `300/300`、multiplayer-core `78/78`、contracts `120/120`，真实 Node authority upgrade/heartbeat、
  API/core/contracts build/lint、真实 Redis 7.0.15 full verifier 与 AOF write → restart → read ticket replay/recovery，
  完整 `pnpm run ci:verify` 与 `git diff --check` 通过；既有 naming/physical D1/preview debt 按原状态保留；
- fault cases：ticket expiry/tamper/replay、current membership/role/epoch override、kick terminal close、multi-tab、subscriber
  capacity rollback、checkpoint unavailable/fence peer close、half-open grace terminate、dead host heartbeat/reconnect、
  v1→v2 migration/TTL、restart replay、deadline/presence queue race 与 Redis unavailable；
- independent review：architecture/compatibility/replay/data、security/authority 与 test adequacy 最终均为 Critical `0` /
  Important `0` / Minor `0`；首轮 lifecycle/migration/capacity/fence/half-open/Redis-AOF/heartbeat findings，以及 deadline
  queued-presence、伪造 deadline capability bypass 与 idle deadline test-adequacy 复审 findings 已全部关闭；
- public wire/schema change：`yes`（新增 ticket/reconnect server transport 与内部 authority state v2）；Redis v1 只做
  lazy exact-CAS 兼容迁移，production D1/schema/secret/release action：`no`；
- open findings：无；next READY Goals：`GMR-06`、`GMR-07`；当前按顺序先执行 `GMR-06`。完整证据见
  [GMR-05 实施与审查整改日志](../logs/2026-08-28_083000_Arena多人GMR-05TicketMembership生命周期实施与审查整改日志.md)。

### GMR-06 D1 directory / discovery

**Entry**

- GMR-05 DONE。

**Scope**

- public/unlisted discovery metadata；
- pagination/index；
- create/close/expire directory update；
- orphan reconciliation/lazy cleanup；
- Redis checkpoint absence remains final not-found/stale；
- schema/migration code + isolated D1 migration test。

**Forbidden**

- D1 成为 Room state truth；
- presence/story chunk 写 D1；
- production migration/apply；
- orphan row 自动复活 Room。

**Done / Validation**

- orphan D1 row cannot recreate Room；
- cleanup/reconciliation idempotent；
- query bounded/indexed；
- isolated migration round-trip；
- no production resource mutation。

**Evidence（2026-08-28）**

- Goal ID：`GMR-06`；source SHA：`4f9b5295d4ed24a33294fb24b7bbc63ea9e394a8`；
- contract/schema：`packages/contracts` 增加有界 room directory page/query contract；`drizzle/0014_arena_multiplayer_rooms.sql`
  及两个 schema mirror 只保存 discovery metadata、`room_epoch` fence 和 public/host/reconciliation keyset indexes；
- authority：D1 始终是 derived index；lookup/list/reconcile 必须以 Redis checkpoint 最终验证 open/epoch/
  host，orphan D1 row 不能创建/恢复 Room；D1 write 不盲目重放，epoch rebind/delete 均 exact-fenced；
- compensation：Redis registration v2 使用 `pending-create` / `projecting` / `active` / `closing`、
  `targetRoomEpoch` / `projectedRoomEpoch` 保留可恢复 predecessor；v1 registration strict parse + exact-CAS
  迁移；D1 与 registration 都有独立低频有界 reconciler；
- atomic fences：create 的 pending registration 与 Redis checkpoint save 在同一 Lua CAS 验证/切换；cleanup
  在同一 Lua 对仍 absent 的 checkpoint 或严格 canonical terminal raw 做 exact fence，open、malformed、
  old/new epoch 或并发替换均 fail closed；`closing` tombstone 保留到 D1 删除确认完成；
- validation：D1 real SQLite migration/schema/query-plan/fence tests，API `341/341`、contracts `123/123`、
  multiplayer-core `78/78`、web `1895/1895`、root `191/191`、API/contracts/core/workspace lint/build、
  Next production build `188/188` pages、`git diff --check` 与完整 `pnpm ci:verify` 通过；真实 Redis
  7.0.15 full verifier 通过；
- fault cases：D1 read/write/delete 与 Redis confirm 失败、recovery epoch 前进、close tombstone 重试、
  pending grace、cleanup-first/save-first 竞态、malformed terminal-looking authority、v1 `get/list` 迁移、timer
  in-flight/cursor/error retry，均有单测或真实 Redis 故障注入；
- independent review：architecture/data/compatibility、security/authority 与 test adequacy 最终均为
  Critical `0` / Important `0` / Minor `0`；predecessor 丢失、pending cleanup 两种交错、v1 迁移、
  missing-registration D1 orphan、真实 EVAL/list/timer 证据与 malformed authority findings 均已关闭；
- production/schema/secret/release：公开 directory contract 与 D1 migration code 已增加，但没有 production
  migration/write/deploy/flag activation、secret 变更、push、release 或 tag；既有 naming/physical D1/preview debt
  继续 report-only / `DEFERRED`；
- open findings：无；next READY Goal：`GMR-07`。完整证据见
  [GMR-06 实施与审查整改日志](../logs/2026-08-28_113000_Arena多人GMR-06D1目录发现实施与审查整改日志.md)。

### GMR-07 Arena room UI

**Entry**

- GMR-05 DONE；
- Development Gate 仍 PASS。

**Scope**

在现有 `/arena`：

- feature-flagged create/find/join；
- room status/members；
- leave/host close；
- reconnect/degraded/replacement-room states；
- 未登录不发 Room 请求。

**Forbidden**

- 第二套 Multiplayer Arena route；
- production flag 默认开启；
- member remote view 触发 host-only AI/write；
- 把 failover 描述为透明无缝。

**Done / Validation**

- single-player Arena 行为无回归；
- flag off 时无公开多人行为漂移；
- reconnect/degraded copy 清晰；
- auth/permission UI 与 server contract 对齐；
- accessibility/interaction tests 通过。

**Evidence（2026-08-28）**

- Goal ID：`GMR-07`；source SHA：`34e8868107efc921e6b99a450107396716639e56`；
- product entry：仅在既有 `/arena` 增加 feature-flagged 多人面板；未登录、flag off 与 `/arena-stream` 均不发
  Room 请求或建立 WSS，production/preview 对启用值继续启动时 fail closed；
- HTTP/authority：新增 create/list/join/session/ticket/leave/close 受鉴权 contract，严格 body、Origin/cookie mutation
  guard、Redis 限速与 `no-store`；create/join 从同一已提交状态返回 session，leave/close 携带并校验
  `expectedRoomEpoch`，ticket role hint 漂移在消费 jti 前拒绝；
- client/replay：create/join 网络、5xx 或畸形 success 进入 `ROOM_RESULT_UNKNOWN` 且不自动重放；unknown create
  与 unknown join 分离，前者只能由显式 reset/access transition 清除；reconnect 只使用 fresh ticket + cursor，validated
  control frame 才重置预算，重复 1013 有界；epoch/sequence gap 进入 snapshot/reconnect；
- UI：呈现 create/find/join、room/member/status、leave/close、reconnecting/degraded/replacement/unknown 状态；同步锁
  阻止 async create 双击；只通过 `ArenaRoomSharedConfig` 白名单投影同步 BattleStore，不传私有卡完整内容、Provider
  配置、credential、生成结果或 UI-only 状态；
- validation：contracts `129/129`、API `354/354`、Web 当前 HEAD `1932/1932`、真实 WSS authority upgrade、
  contracts/API/Web typecheck/lint/build、workspace boundary/generated/naming/Hosted DR gates、Next production build 与完整
  `pnpm ci:verify` 通过；最后 wiring/unknown-state delta 另以真实 hook/client/auth/fake fetch+WebSocket interaction tests、
  完整 Web suite、typecheck、lint 与 `git diff --check` 复验；
- independent review：architecture/compatibility/replay/data、security/authority/replay 与 test adequacy 最终均为
  Critical `0` / Important `0` / Minor `0`；create/join post-commit unknown、epoch-fenced exit、1013 reconnect budget、
  production wiring、async double-click、close mapping 和 unknown-operation isolation findings 已全部关闭；
- production/schema/secret/release：新增公开 Room HTTP contract、Web client 与 disabled-by-default UI；没有 production
  deploy/cutover、remote migration/write、production Redis 操作、secret/Access/credential 变更、push、release 或 tag；
- open findings：无；next READY Goals：`GMR-08`、`GMR-09`；按冲突最小顺序先执行 `GMR-08`。完整证据见
  [GMR-07 实施与审查整改日志](../logs/2026-08-28_131500_Arena多人GMR-07房间产品入口与UI实施审查整改日志.md)。

### GMR-08 Proposal E2E

实施设计与原子计划见 [GMR-08 Proposal 端到端设计](../specs/2026-08-28_143000_Arena多人GMR-08Proposal端到端设计.md)
与 [GMR-08 Proposal 端到端实施计划](./2026-08-28_143000_Arena多人GMR-08Proposal端到端实施计划.md)。

**Entry**

- GMR-05、GMR-07 DONE。

**Scope**

- member snapshot -> local working copy -> diff -> submit；
- host per-change review；
- typed `expectedBase`；
- `versionToken`；
- dependsOn / atomicGroup；
- partial accept/reject；
- RoomActor apply + conditional checkpoint；
- ack 后 broadcast。

**Forbidden**

- arbitrary JSON Patch；
- member local/private payload sharing；
- client conflict result 作为服务器权威；
- ack before checkpoint。

**Done / Validation**

- stale same-target conflict；
- changed/deleted/permission-changed ref；
- partial accept dependency；
- old epoch；
- Redis conflict/failure；
- sensitive payload negative fixtures。

**Evidence（2026-08-28）**

- Goal ID：`GMR-08`；source SHA：`a3538a950faab9f608fd64fa4769d3abe0a00a2a`；
- contract/authority：strict versioned submit/resolve/withdraw DTO，server-normalized author/status/time，stable intent identity，
  exact Origin/cookie guard、Redis operation limit、minimal `no-store` response、old epoch/revision 和 checkpoint-before-ack；
- data ownership：metadata-only D1 verifier 不读取/返回/记录卡正文，changed/deleted/permission/review/kind/version drift 均在
  checkpoint 前 fail closed，member private card 不因 Room membership 扩权；
- projection/replay：host 看全部 Proposal，author 只看自己，other member 不看 foreign ID/changes；initial/live/
  same-epoch replay 保持连续 controlSeq，mixed visibility 不丢失作者 terminal event；
- unknown/recovery：Redis save-result unknown 立即 quarantine Actor，不服务 stale state 且不重放 mutation；下次读从
  checkpoint 恢复新 epoch。Web unknown 绑定 operation/proposalId，无关 event 不解锁，显式 `GET session` + fresh ticket
  对账；
- product/UI：member detached safe working copy、typed diff/preview、submit/withdraw，host per-change selection、dependency/
  atomic validation、accept-selected/reject 闭环；dirty draft 遇 config update 保留并标记 stale；
- validation：contracts `22 files / 131 tests`、core `10 / 82`、API `40 / 402`、Web `357 / 1955`；真实 Node
  upgrade `2/2`；本机 Redis 7.0.15 隔离 lifecycle verifier 通过（`proposalLifecycle:true`）；contracts/core/API/Web
  typecheck/lint/build、workspace boundary/generated/naming report-only/Hosted DR gates、Next `188/188 pages`、root `19 files /
  191 tests` 与 `pnpm ci:verify` 通过；
- independent review：architecture/compatibility/replay/data、security/authority/replay 与 test adequacy 最终均为
  Critical `0` / Important `0` / Minor `0`；commit-then-throw stale Actor、withdraw oracle、wildcard Origin、terminal
  replay、unknown current-cursor lock、mixed visibility、production UI chain 和 mutable D1 drift findings 已全部关闭；
- production/schema/secret/release：未 deploy/cutover，未做 remote migration/write/Redis flush，未变更 secret/Access/
  credential，未 release/tag/push/history rewrite；
- open findings：无；next READY Goal：`GMR-09`。完整证据见 [GMR-08 实施与审查整改日志](../logs/2026-08-28_151800_Arena多人GMR-08Proposal端到端实施与审查整改日志.md)。

### GMR-09 authoritative generation publisher

**Entry**

- GMR-03、GMR-05、GMR-07 DONE；
- G25R stable generation identity/recovery seam 仍通过。

**Scope**

- host membership/epoch validation；
- publish pending host config；
- stable `generationRequestId`；
- Room reservation checkpoint；
- frozen revision/config/ref versions/participant snapshot；
- in-process `RoomGenerationPublisher`；
- batched story delta；
- `generationId + chunkSeq`；
- terminal mirror；
- gap -> resync；
- final report from authoritative generation storage。

**Forbidden**

- host browser 作为唯一 relay；
- 第二套 AI execution lifecycle；
- reconnect 自动重发 provider POST；
- per-token Room publish；
- Room checkpoint 存完整 provider secret/host-local payload。

**Done / Validation**

- duplicate start == one AI execution；
- host refresh/disconnect；
- old epoch/attempt terminal rejected；
- story gap/resync；
- process failure先 reconcile generation state；
- final terminal/R2/D1 semantics 与现有 generation contract 一致。

### GMR-10 hardening / fault / load audit

**Entry**

- GMR-06、GMR-08、GMR-09 DONE。

**Scope**

- active rooms/sockets；
- RoomActor queue/latency；
- Redis checkpoint bytes/latency/error/memory/eviction；
- reconnect/snapshot/resync；
- publisher backlog/drop；
- CPU/RSS/heap/event-loop；
- failure drills；
- reasonable non-production load baseline；
- v1 exit audit + remaining risks。

至少演练：

1. socket disconnect；
2. host refresh；
3. Redis unavailable；
4. Hono restart + Redis survives；
5. Redis checkpoint loss；
6. D1 orphan；
7. generation mid-flight process failure；
8. slow consumer；
9. oversized/flood；
10. VPS unreachable。

**Done / Validation**

- recoverable cases recover；
- unrecoverable Room explicitly terminates/rebuilds；
- no duplicate generation/rating/settlement；
- durable business facts correct；
- no secret/content logging；
- metrics support Phase H decision；
- no fabricated production SLA。

### GMR-11 production activation review

**Status：`DEFERRED`**

这是新的 go/no-go，不是 GMR-10 自动续跑。

只有 Production / Integration Gate 的外部条件关闭并获得相应生产授权后，才建立独立 Goal/plan/runbook，确认：

- stable logical HTTPS/WSS routing；
- production Access/origin protection；
- production migration；
- rollback；
- capacity/alerts；
- compatibility；
- production fault drill；
- Room 是否进入 DR manifest。

不得由 `/goal` 自主把 `DEFERRED` 改为 `READY`。

### GMR-H multi-instance / Durable Object evaluation

只有真实信号触发：

- 一个 room-capable Hono instance 容量不足；
- global RTT 成为用户体验问题；
- Room 连续性目标要求 Hono/VPS failure 后更强恢复；
- Redis ownership/fencing 复杂度开始接近独立协调 runtime；
- Cloudflare Room DR 的业务价值明确。

触发后 MUST 新建 ADR/PoC，不在当前 v1 Goal 中顺手实现 multi-instance lock 或 DO。

## 7. Stop-and-escalate

命中以下任一条件，当前 Goal 必须停止，保留已验证的最小改动并提出决策，不得自行扩大范围：

1. 需要改变 Hono + Redis v1 主运行时或重新把 DO 设为前置条件；
2. 需要启用第二个 room-capable Hono replica、sticky routing、lease 或 distributed lock；
3. 需要把 final generation/rating/settlement/account/audit 等永久业务 truth 放入 Redis；
4. 需要改变现有 public multiplayer wire 的不兼容语义；
5. 需要新增 member private/local payload sharing 或改变 host-local secret boundary；
6. 需要改变 Better Auth/Legacy/session/ticket 的信任根；
7. 需要执行 production D1 migration/write、Redis flush、DNS/LB/Access/credential 变更；
8. 需要放宽现有 production build / DR fail-closed guard；
9. 需要把 Room realtime 加入 Cloudflare DR manifest；
10. 发现 accepted ADR/spec 之间新的实质冲突；
11. 发现一次 Goal 无法在合理单轮闭合，且继续只能靠跳过测试/验收。

以下通常**不需要**升级为架构决策，只要不改变公开 contract/安全边界即可在 Goal 内选择并记录：

- `apps/api/src/arena-room/*` 的内部文件拆分；
- pure helper / internal error 名称；
- test fixture 组织；
- WSS versioned path 的内部候选命名（在公开激活前仍可调整）；
- heartbeat/queue/bytes 等非产品 contract 的初始测试常量；
- Redis CAS 选择 `WATCH` transaction 或 Lua，只要语义和测试满足规范。

## 8. Evidence / 状态更新

每个 Goal 完成时至少记录：

```text
Goal ID
source SHA
changed files
tests / validation commands + result
fault cases covered
public wire/schema change: yes/no
production action: must be no for GMR-01..10
open findings
next READY Goal
```

优先把短状态写回本指南；达到 B1/B2/B3/C/D/E/G 这种有独立运行时意义的 milestone 时，再在 `docs/logs/` 留实施/退出证据。不要为每个几行代码的微步骤制造新的权威文档。

任何验证失败时，状态为 `IN_PROGRESS` 或 `FAILED_REVIEW`，不能提前把下一个 Goal 改成 READY。

## 9. 外部执行指南（非规范性）

- OpenAI Codex Developer Commands：<https://developers.openai.com/codex/cli/slash-commands>
  `/goal` 保存短、持久的目标；详细说明放文件中再引用。
- OpenAI — Run long horizon tasks with Codex：<https://developers.openai.com/blog/run-long-horizon-tasks-with-codex>
  参考持久 plan、单 milestone acceptance criteria、validation/repair loop 和状态/决策日志。
- Redis Transactions：<https://redis.io/docs/latest/develop/using-commands/transactions/>
  `WATCH` 提供 optimistic locking / CAS；Room checkpoint 也可采用经过测试的等价 Lua CAS。
- Redis Pub/Sub：<https://redis.io/docs/latest/develop/interact/pubsub/>
  Pub/Sub 是 at-most-once 在线消息机制，不作为 durable Room state/replay。
- Hono Node.js / WebSocket：<https://hono.dev/docs/getting-started/nodejs>、<https://hono.dev/docs/helpers/websocket>
  Node WSS 使用当前 `@hono/node-server` 支持方式；upgrade path 单独审计 header middleware。
- OWASP WebSocket Security Cheat Sheet：<https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html>
  参考 Origin、消息验证/限额、连接上限、heartbeat、backpressure 与安全日志。

## 10. 关联文档

- [平台重整与本地优先架构主题](../topics/2026-08-22_022000_平台重整与本地优先架构.md)
- [Arena Room 运行时可移植与 Hono + Redis 首发决策](../decisions/2026-08-25_104400_ArenaRoom运行时可移植与HonoRedis首发决策.md)
- [Arena 多人 Hono + Redis 运行时实施规格修订](../specs/2026-08-25_104400_Arena多人HonoRedis运行时实施规格修订.md)
- [Arena 多人 Hono + Redis 首发实施计划](./2026-08-25_104400_Arena多人HonoRedis首发实施计划.md)
- [平台重整目标架构](../architecture/2026-08-22_022500_平台重整目标架构.md)
- [平台重整分阶段实施计划](./2026-08-22_022700_平台重整分阶段实施计划.md)
