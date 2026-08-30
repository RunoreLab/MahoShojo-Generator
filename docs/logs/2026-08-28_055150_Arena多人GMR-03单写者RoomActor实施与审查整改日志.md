# Arena 多人 GMR-03 单写者 RoomActor 实施与审查整改日志

日期：2026-08-28  
Goal：`GMR-03 single-writer RoomActor`  
source SHA：`2970400b7bda35b9e3ca2e11e1c42f4adb6a68bf`  
结论：`PASS / DONE`

## 1. Objective 与 stopping condition

本切片在单一 room-capable Hono process 内建立 `roomId -> RoomActor` 单写者 runtime：每 Room command 串行、
checkpoint 成功后才安装/确认/broadcast、queue/actor/subscriber/fenced tombstone 有界、显式 warm recovery 切换新
epoch、old actor/callback 被 fence、idle eviction 与 process shutdown 可 drain/force close。未引入 WSS、ticket、
Pub/Sub、Streams、distributed lock、DO、多实例 ownership、D1 presence 或 production surface。

stopping condition 已闭合：实现、fault tests、真实 Redis 8.2 full/AOF restart、完整 workspace CI 与三路独立终审
均通过，Critical/Important/Minor finding 为 `0/0/0`。

## 2. 关键设计与权威文档变更

- `RoomActorRegistry` 同步占用 actor map 后才允许 command 入队；同 Room transition 与 Redis save 严格串行，
  CAS conflict 立即 fence actor，不安装 next state、不 fan-out、不自动重放。
- `recover(roomId)` 是唯一有副作用的 hydrate/epoch rollover 入口；普通外部 command 不隐式 load/recover，closed
  checkpoint 保持 terminal idempotency，active checkpoint 使用 opaque recovery authority 切新 epoch。
- `create()` 是唯一 runtime Room 创建入口，不接收调用方提供的 `roomId`、`roomEpoch` 或 timestamp；默认使用
  `randomUUID()` 与服务端时间，并由服务端构造 host role、active membership、joinedAt。通用 `execute(create)`
  在 actor/Redis 前拒绝，关闭未观察 legacy checkpoint 到期后的 client-chosen same-epoch resurrection 可达路径。
- exact replay sidecar 达到配额时，原 command 稳定 `capability-denied`；actor 使用 scope-bound opaque runtime
  capability checkpoint close 当前 Room。Redis 暂时失败时只保持本地 close-only 并重试，CAS conflict 则 fence。
- active v1 legacy load 在严格 schema parse 后补种无 TTL incarnation ledger。若 checkpoint 在 GET 与 Lua 之间
  到期，Lua 仍对已验证 raw/room/epoch 补种并返回 absent；不同 raw 只 conflict/re-read。
- fan-out 只接受同步 subscriber；返回 thenable 的 slow subscriber 在第一次调用后移除，避免无界异步 backlog。
- `main.ts` 把 registry stop/drain/force close 纳入既有 single-run graceful shutdown，idle sweep 使用单一 process timer。

accepted runtime spec 与首发计划新增 server-owned Room identity 不变量、legacy lazy bootstrap 的能力边界，以及
production activation 前 legacy ledger 检查/迁移门禁。当前多人 Room 未在 production 暴露或写入，因此本轮没有
production migration；未来发现旧 key 时不得把 lazy load 当成已迁移证据。

## 3. Atomic checkpoints

1. `48f956e5 feat(multiplayer): 增加 Room recovery epoch rollover`
2. `238b59e4 feat(api): 增加 single-writer RoomActor registry`
3. `30825433 fix(multiplayer): 收紧 RoomActor recovery 与配额关闭`
4. `4319d1da fix(api): 补齐 legacy load fence 与 quota 回归`
5. `5eb2700a fix(api): 围住 legacy load 到期竞态`
6. `2970400b fix(api): 由服务端签发 Room identity`

每个整改先以失败回归或独立 finding 固定场景，再修改实现并执行 targeted validation；没有重写历史或 push。

## 4. Fault / negative coverage

- concurrent command ordering、queue overload、registry capacity 与 subscriber/fenced tombstone 上限；
- checkpoint-before-install/fan-out、Redis unavailable、unknown result、CAS conflict、old actor/idempotent stale actor；
- rich recovery 保留 members、pending Proposal、generation mirror/ledger 与 collaborative provenance；
- concurrent hydrate 只有一个 recovery writer，closed hydrate 保持 terminal close idempotency；
- generation/collaborative/member/proposal exact replay quota close、close checkpoint failure retry、close CAS fence；
- active v1 predecessor/successor ledger、load bootstrap、GET 后到期竞态、TTL 后 same-epoch resurrection；
- 未观察 legacy checkpoint 自然到期后，client-chosen old Room identity 的 runtime create 在 Redis 前拒绝；
- idle eviction、subscriber 抛错/async slow consumer、graceful drain、force close 与 hydration/shutdown race；
- Redis 8.2 full 与 RoomActor write → AOF restart → recovery new epoch → old writer fence。

## 5. 实际验证

最终实现与文档阶段实际运行：

```text
pnpm --filter @mahoshojo/api exec vitest run \
  tests/redis-room-store.test.ts tests/room-actor-registry.test.ts
  PASS — 2 files / 45 tests

pnpm --filter @mahoshojo/api test
  PASS — 24 files / 235 tests

pnpm --filter @mahoshojo/multiplayer-core test
  PASS — 8 files / 73 tests

pnpm --filter @mahoshojo/api run build
pnpm --filter @mahoshojo/api run lint
git diff --check
  PASS

REDIS_URL=redis://127.0.0.1:<loopback-port> \
  ROOM_REDIS_VERIFY_KEY_PREFIX=<isolated-prefix> \
  pnpm --filter @mahoshojo/api run verify:room-redis
  PASS — Redis 8.2 full；包含 legacy load expiry race 与 server-issued identity

ROOM_REDIS_VERIFY_PHASE=write ... verify:room-redis
docker restart <temporary-redis-8.2>
ROOM_REDIS_VERIFY_PHASE=read ... verify:room-redis
  PASS — acknowledged RoomActor checkpoint、AOF restart recovery、old actor/epoch fence

pnpm run ci:verify
  PASS — workspace boundaries、contracts、packages/apps tests、lint、build、root 191、Web 1893、
  API 235、multiplayer-core 73、Next production build 188 pages

pnpm run lint:repo
  PASS — 对完整 CI 最后阶段单独确认 exit 0
```

首次完整 CI 的并行 workspace run 有 10 个 unrelated Web 测试因 15 秒预算超时；原样 isolated 重跑为
`10 files / 50 tests PASS`，第二次完整 Web suite 为 `347 files / 1893 tests PASS`，未修改测试、timeout 或 Web
实现。既有 naming audit `1378` 条保持 report-only；physical D1 probe、preview environment 与 hosted DR 独立 Redis
integration gate 保持既有 `DEFERRED`，未被本 Goal 提升。

所有 Redis verifier 只连接 loopback 一次性容器；容器和临时数据均已删除。没有读取用户提供的 SSH 私钥，也没有
连接远程服务器。

## 6. Independent review 与关闭状态

实施后由三个独立上下文累计审查 architecture/compatibility/replay/data、security/authority 与 test adequacy。
主要 finding 与关闭方式：

- old actor 的 idempotent success 绕过 Redis 当前状态、legacy recovery 只记录 successor epoch；改为完整 checkpoint
  比对，并在同一 Lua 中记录 predecessor/successor；
- fenced Room 占用 actor capacity、失败 create 遗留空 actor、closed hydrate 丢失 close idempotency；拆分 bounded
  tombstone、queue drain 后 abandonment、terminal hydrate；
- command 可触发隐式 recovery/epoch rollover；改为 pre-parse + 显式 `recover()`；
- exact replay quota 只有失败结果而未 runtime close，及 close failure/conflict 分支不足；增加 opaque quota closer、
  retry/fence 与 generation/collaborative E2E；
- slow subscriber、queue shutdown、rich restart recovery 与 concurrent hydrate coverage 不足；全部补齐回归；
- active legacy load 后 TTL 可 same-epoch resurrection，以及 GET→Lua 间 TTL race；增加原子 ledger bootstrap 与
  expired 分支；
- 从未被观察的 legacy key 到期后无法 lazy 补历史；移除 client-chosen Room identity 的 runtime 可达性，创建只由
  服务端签发，并加入真实 Redis fault verifier 与 activation migration 门禁。

最终复核：

| 维度 | Critical | Important | Minor | 状态 |
| --- | ---: | ---: | ---: | --- |
| architecture / compatibility / replay / data | 0 | 0 | 0 | `PASS` |
| security / authority | 0 | 0 | 0 | `PASS` |
| test adequacy | 0 | 0 | 0 | `PASS` |

open findings：无。

## 7. 状态、影响与回滚

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| GMR-03 stopping condition | `PASS` | single-writer、recovery、shutdown、fault、review 全闭合 |
| public wire/API route | `NOT_APPLICABLE` | 未新增 HTTP/WSS product surface；Arena v1 wire 未改变 |
| production/schema migration | `NOT_APPLICABLE` | 内部 Redis 兼容/ledger 语义补强；尚无 production Room 数据 |
| secret/credential | `NOT_APPLICABLE` | 未新增、读取或变更 secret；SSH key 未读取 |
| deploy/cutover/release | `NOT_APPLICABLE` | 未部署、远程写入、push、release 或 tag |
| preview / physical D1 evidence | `DEFERRED` | 既有平台门禁，不属于 GMR-03 |
| remaining blocking finding | `NOT_APPLICABLE` | 无 |

回滚使用普通 `git revert`：先回退本日志/状态文档提交，再按 `2970400b` → `5eb2700a` → `4319d1da` →
`30825433` → `238b59e4` → `48f956e5` 逆序回退。没有数据库 migration、远程 Redis、外部资源或生产状态需要恢复。

当前剩余工作从 `GMR-04 Node WSS security skeleton` 开始；只接入 Node WebSocket lifecycle、独立 upgrade
middleware、Origin/schema/bytes/rate/cap/heartbeat/backpressure/slow-consumer 防线，不提前实现 ticket/membership、
产品 UI 或 production routing。
