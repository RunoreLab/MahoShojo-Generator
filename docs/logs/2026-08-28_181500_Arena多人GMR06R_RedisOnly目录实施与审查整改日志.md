# Arena 多人 GMR-06R Redis-only Room Directory 实施与审查整改日志

状态：`completed`
日期：2026-08-28
Goal：`GMR-06R Redis-only directory amendment`
规范：`SPEC-arena-multiplayer-redis-only-directory-amendment-v1`
基线 source SHA：`0e53b8d1`
代码整改 source SHA：`79e700f5`

## 1. Objective 与当前 stopping condition

本切片把 Arena 多人 v1 的活动 Room directory 从 D1 derived projection 收敛为 Redis-only derived
record/index，同时保留 GMR-07 房间产品入口与 GMR-08 Proposal 行为。

代码、schema、真实 Redis/AOF、workspace CI 与 production D1 只读退出审计已经完成。三路独立复审最终均为
Critical `0` / Important `0`；全部 Minor 已修复或以不弱化断言的明确 stopping-condition 理由关闭。GMR-06R
stopping condition 满足，Goal ledger 已转为 `DONE`，GMR-09 解锁为 `READY`。

## 2. 原子 checkpoint

1. `0e53b8d1` — `docs: Arena 多人 v1 移除 D1 Room Directory / Redis-only 规范修订`
2. `1441d6ab` — `docs(arena): 建立 Redis-only 目录清理门禁`
3. `955ae8a6` — `feat(arena): 将房间目录收敛为 Redis-only`
4. `5600e8c9` — `docs(arena): 同步 Redis-only 目录权威口径`
5. `3f6c63f1` — `fix(web): 清理房间目录 schema 残留导入`
6. `cbbd89a3` — `fix(arena): 修复 Redis-only 目录审查问题`
7. `79e700f5` — `test(arena): 闭合 Redis-only 目录故障门禁`

每个 checkpoint 都可独立回退；D1 历史实现另由 GMR-06 归档文档保存，不通过覆盖共享文件恢复。

## 3. 最终设计与实现

- Redis checkpoint 是活动 Room 唯一 session authority；directory record 与 public lexicographic sorted-set 只生成
  候选，public 单页上限 50，内部最多读取 51 条形成 cursor。
- public create、authority recovery/lifecycle mutation、close/expire/delete 对 checkpoint、record、index 使用同一
  Lua/CAS 原子边界。Redis 回包未知时 RoomActor quarantine；恢复从已提交 checkpoint 换新 epoch，不盲重放 create。
- public/unlisted lookup 与 list 返回前重验 current checkpoint 的 open lifecycle、exact epoch、host 与 deadline。
- stale cleanup 比较 exact raw 和 current `publicIndexMember`；旧 zset member 可以删除，但不得删除并发 replacement
  record 或其 current member。
- `sync-presence` 使用显式 `directoryMutation: preserve`，不读取/改写/重排目录；低频 lifecycle refresh 只延长 exact
  record TTL，不写 zset。
- `arena_multiplayer_rooms` migration、D1 adapter、registration、compensation/tombstone、两类 reconciler 以及 schema
  mirror 已删除；storage-neutral HTTP/wire/UI contract 保留。
- accepted ADR、平台 `MULTI-015`、Hono + Redis ADR/计划和主题索引通过 superseding ADR 收敛；旧 D1 设计历史不删除。

## 4. Production / preview D1 只读退出审计

审计只使用仓库当前 `apps/d1-gateway/wrangler.jsonc` 中的 machine-readable binding，并通过 Wrangler 对 production
D1 执行两条只读 metadata query；没有执行 migration、DDL、DML、transaction、restore 或 deploy。

实际查询等价命令：

```bash
pnpm --filter @mahoshojo/d1-gateway exec wrangler d1 execute mahoshojo --remote --json --command "SELECT name, type FROM sqlite_master WHERE name = 'arena_multiplayer_rooms'"
pnpm --filter @mahoshojo/d1-gateway exec wrangler d1 execute mahoshojo --remote --json --command "SELECT name FROM d1_migrations WHERE name = '0014_arena_multiplayer_rooms.sql' OR name LIKE '%arena_multiplayer_rooms%'"
```

结果：

- production `sqlite_master`：只有正常 metadata 响应，没有 `arena_multiplayer_rooms` table/view；
- production `d1_migrations`：没有 `0014_arena_multiplayer_rooms.sql` 或同名 migration；
- 两次响应均为 `changed_db: false`、`rows_written: 0`；
- preview control-plane/config：`not-provisioned`，没有可独立审计的 preview D1，记为 `NOT_APPLICABLE`；
- 因共享环境不存在该 schema，不需要也未执行 `DROP TABLE`。若未来发现其他共享环境已应用，必须另立人工 schema
  operation，不得从本日志推导删除授权。

## 5. 测试与故障验证

### 5.1 定向与 API 完整验证

```bash
pnpm --filter @mahoshojo/api exec vitest run --config vitest.config.ts tests/redis-room-store.test.ts tests/redis-room-directory-store.test.ts tests/room-directory-service.test.ts
pnpm --filter @mahoshojo/api test
pnpm --filter @mahoshojo/api run build
pnpm --filter @mahoshojo/api run lint
git diff --check
```

结果：最新定向 `3 files / 39 tests`、API `38 files / 382 tests` 全部通过；两个 TypeScript project、ESLint 与 diff
whitespace 检查通过。

### 5.2 真实 Redis 7.0.15 完整故障矩阵

隔离实例只监听 `127.0.0.1:6398`：

```bash
REDIS_URL=redis://127.0.0.1:6398 ROOM_REDIS_VERIFY_KEY_PREFIX=gmr06r-review-final pnpm --filter @mahoshojo/api run verify:room-redis
```

结果为 `roomRedis:true, phase:full`，并明确返回：

- `directoryAtomicCreateIndex`、`directoryUnlistedKnownJoin`、`directoryRecoveryRebind`；
- `directoryLifecycleTtlRefresh`、`directoryActiveSubscriberTtlRefresh`、`directoryPresenceWriteIsolation`；
- `directoryStaleIndexRecordPreservation`、`directoryConcurrentReplacementPreservation`；
- `directoryCreateReplyLossRecovery`、`directoryBoundedPagination`；
- `directoryMalformedMemberCleanup`、`directoryAuthorityCandidateCleanup`；
- `directoryFaultMatrixFailClosed`、`directoryStorageTypeFailClosed`、`directoryAtomicCreateStorageTypeFailClosed`；
- `directoryDisconnectedRuntimeFailClosed`；
- close/stale/malformed/TTL/ticket/recovery/epoch/fence 的既有全部场景。

真实 fault 包括 Lua 已提交后模拟 client reply lost 并证明只执行一次 SAVE、52 个 public Room 的 50+2 页、active
subscriber 经 registry scheduler 在 1 秒 record TTL 后完成低频 refresh、malformed zset member、wrong
epoch/host/closed/expired candidate、absent checkpoint 下 record/index WRONGTYPE，以及真实 Redis client 断连后的
create/close fail-closed。所有失败分支都检查 checkpoint/fence/record/index 无 partial commit 或保持原值。finally cleanup
限定在隔离 key prefix，保留命名错误与 stack 作为失败证据，同时确定删除测试 key 以保证重复执行且不污染共享本机 Redis；
该 Minor 取舍不弱化断言，也不用于生产 Redis。

### 5.3 AOF restart

使用 `appendonly yes`、`appendfsync always` 的单独临时目录执行：

```bash
REDIS_URL=redis://127.0.0.1:6398 ROOM_REDIS_VERIFY_PHASE=write ROOM_REDIS_VERIFY_TOKEN=gmr06r-final-aof ROOM_REDIS_VERIFY_KEY_PREFIX=gmr06r-final-aof pnpm --filter @mahoshojo/api run verify:room-redis
REDIS_URL=redis://127.0.0.1:6398 ROOM_REDIS_VERIFY_PHASE=read ROOM_REDIS_VERIFY_TOKEN=gmr06r-final-aof ROOM_REDIS_VERIFY_KEY_PREFIX=gmr06r-final-aof pnpm --filter @mahoshojo/api run verify:room-redis
```

中间完整关闭并从同一 AOF 目录重启 Redis。write 返回 checkpoint/ticket/directory 全部 `true`；read 返回
`restartRecovery`、`roomActorRestartRecovery`、`oldActorFence`、`incarnationFence`、`ticketReplayAfterRestart`、
`directoryAfterRestart`、`directoryRecoveryRebindAfterRestart`、`directoryCleanupAfterRestart` 全部 `true`。
实例停机后已删除单独的 AOF 与日志夹具。

### 5.4 Workspace / build / boundary

```bash
pnpm ci:verify
rg -n "arena_multiplayer_rooms|D1RoomDirectoryStore|RedisRoomDirectoryRegistration|room-directory-reconciler|roomDirectoryRegistration" apps packages drizzle config scripts
```

第二条在 runtime/schema/machine-readable 范围无结果。`pnpm ci:verify` 首轮的 workspace 并发测试出现纯 timeout：API
route manifest 与 6 个既有 Web suite 在 15–37 秒超时，无业务断言失败；隔离复跑分别 `3/3`、`17/17` 立即通过。
随后完整 `pnpm ci:verify` 从头通过，包括：

- contracts `131`、multiplayer-core `82`、hosted-api `162`、hosted-runtime `328`；
- API `382`、Web `1953`、root `191`；
- workspace boundary、全部 lint/typecheck/build、Hosted DR contract/evidence；
- Next production build `188/188` static pages。

既有 naming audit 为 report-only `1418` 条；本切片没有新增 naming gate 失败。preview physical D1 与 hosted control plane
仍按全仓既有状态 `DEFERRED/not-provisioned`，不被本切片伪装为已完成。

## 6. 独立审查与整改

初次三路独立审查为 Critical `0`：

- architecture/data：Important `3`，分别是 lifecycle refresh 未延长 directory TTL、active accepted 文档仍有 D1
  冲突、远程 D1 只读退出审计缺少正式证据；
- security/authority：Important `2`，分别是 stale old index 可能误删 current record、presence 写会更新/重排目录；
- test adequacy：Important `5` / Minor `2`，要求真实 reply-loss、TTL、52+ 分页、WRONGTYPE/fault matrix、malformed
  member、wrong epoch/host 与远程审计证据。

上述实现整改进入 `cbbd89a3`，最终 test-adequacy 故障门禁进入 `79e700f5`，权威文档与审计证据进入本批文档。
最终关闭状态：

- security/authority/replay/data：Critical `0` / Important `0` / Minor `0`；初审 stale cleanup 与 presence mutation
  两项 Important 均关闭；
- architecture/data/compatibility：代码与测试 Critical `0` / Important `0`，active subscriber -> registry scheduler ->
  directory TTL 缺口已关闭；最终日志未同步与未纳入 Git 的 `I1/M1` 由本次定稿及 `git add -f` 关闭；
- test adequacy：Critical `0` / Important `0` / Minor `1`；上轮 Important 全部关闭。唯一 Minor 是 finally cleanup
  会减少失败现场；本日志已明确唯一测试 prefix、原异常/stack 保留和确定 cleanup 的可重复性取舍，因此按不弱化断言、
  不污染共享本机 Redis 的 stopping-condition 理由关闭。

最终没有 open Critical / Important finding，也没有未处理 Minor。

## 7. 状态、影响与回滚

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Redis-only directory implementation | `PASS` | 原子 lifecycle、authority revalidation、bounded pagination |
| GMR-07/GMR-08 compatibility | `PASS` | API/Web/workspace 完整验证通过 |
| production D1 migration/schema | `NOT_APPLICABLE` | 只读审计确认未应用/未建表，无需回滚 |
| preview D1 audit | `NOT_APPLICABLE` | preview D1 未纳管 |
| production Redis / deploy / cutover | `DEFERRED` | 未写、未 flush、未部署、未切流 |
| secret / Access / credential | `NOT_APPLICABLE` | 无变更 |
| release / tag / push | `DEFERRED` | 未执行 |
| independent re-review | `PASS` | 三路 Critical/Important 清零；Minor 已修复或明确关闭 |

代码回滚按 `79e700f5`、`cbbd89a3`、`3f6c63f1`、`5600e8c9`、`955ae8a6`、`1441d6ab`、`0e53b8d1` 逆序
revert。由于 production/preview 没有应用 `0014`，不存在远程 down migration；不得为了回滚本地代码而对生产 D1 或
Redis 做删除/flush。若未来需要重评估 D1，使用历史归档和新的 ADR，不直接覆盖 GMR-07/GMR-08 之后的共享文件。
