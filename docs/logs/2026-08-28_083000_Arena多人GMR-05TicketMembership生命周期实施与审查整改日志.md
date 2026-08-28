# Arena 多人 GMR-05 Ticket、Membership 与生命周期实施及审查整改日志

日期：2026-08-28  
Goal：`GMR-05 ticket / membership / reconnect / lifecycle`  
source SHA：`d99c07e9e258507f0e9122c580723015b16dd683`  
结论：`PASS / DONE`

## 1. Objective 与 stopping condition

本切片在 GMR-04 Node WSS 安全骨架上完成可恢复的 Room authority：短期签名 ticket、Redis one-shot replay、
current membership 授权、membership/connection 分离、multi-tab、kick/leave/host close、same/new epoch reconnect、
host-offline/idle deadline、checkpoint v1→v2 兼容与真实 Node/Redis restart fault coverage。

stopping condition 已闭合：所有 authority-changing 结果仍先 Redis checkpoint 后 ack/fan-out；refresh/network switch/
socket close 不等于 leave，ticket replay/kick/old epoch/deadline race 均 fail closed；完整 API/core/contracts/workspace CI、
真实 Node、Redis 7.0.15 full/AOF restart 与三路独立终审通过，最终 Critical/Important/Minor 为 `0/0/0`。

当前没有 create/join/ticket HTTP 产品入口；feature 默认关闭且 production/preview 配置拒绝开启。本切片没有 generation
fan-out、D1 directory、多人 UI、production activation、远程 migration/write、secret provisioning 或 release。

## 2. 关键设计与 authority 边界

- ticket 固定 contract version 与 protocol version，绑定 `roomId`、`roomEpoch`、server-issued `userId`、`roleHint`、
  `iat`、`exp`、`jti` 及可选 reconnect cursor；默认 45 秒、硬上限 60 秒、最大 4 KiB。
- ticket 通过既有 server-owned signature service 签名，但使用 `arena-room-ticket-v1` purpose 做 domain separation；
  ticket 字段不包含 account credential、API key、provider secret 或 host-local payload。
- upgrade authorization 先验签并原子消费 Redis `jti`，再加载 current checkpoint membership；role hint、epoch、user
  均不得覆盖 current authority。replay store unavailable、ticket replay、epoch stale、revoked/kicked membership 均拒绝。
- account membership 与 socket connection 分离；同 account multi-tab join 复用同一 member，connection 使用独立
  presence。单 socket close、refresh 或 network switch 只清 connection；explicit leave/kick/host close 才改变 membership/
  lifecycle，kick 会关闭现有 peers。
- same epoch cursor 连续时发送 bounded replay，窗口缺失发送 snapshot；process recovery 切新 epoch，旧 ticket/cursor
  stale，新 ticket 进入后发送 full snapshot。fenced actor 向 peers 发送 1013，terminal membership close 使用 1008。
- authority state v2 持久化 logical deadlines。严格 v1 checkpoint 使用 exact raw CAS + `KEEPTTL` 原位迁移；由于旧
  presence 连续性不可证明，open v1 的 deadline 取可信 `lifecycle.updatedAt` 并在 recovery/lazy validation 时关闭。
- deadline correctness 不依赖 timer：scheduler、registry recover/execute、membership resolve 及每个 queued command 的
  `RoomActor.apply` 线性化边界都会使用 server clock 复核。到期 close 必须先 checkpoint CAS/安装/fan-out，再拒绝原
  command；queued presence 不能清除已到期 host/idle deadline。
- apply 边界只允许通过 core WeakSet brand 验证的 in-process deadline capability 绕过自动检查；客户端 JSON 或
  structured clone 的 `{ kind: 'room-deadline-closer' }` 不能拖延 cleanup。
- gateway closing session 有 bounded grace，未完成 close 的 half-open socket 最终 terminate、释放 cap 并 dispose；
  heartbeat dead socket 会走同一 authority presence lifecycle。

## 3. Atomic checkpoints

1. `b85f8987 feat(api): 完成 Arena 房间 ticket 与生命周期权威`
2. `c3a61b0c fix(api): 关闭 Arena 生命周期审查缺口`
3. `41150c6f fix(api): 在线性化边界关闭到期 Arena 房间`
4. `d99c07e9 fix(api): 验证 Arena 期限关闭 capability`

所有整改均先以失败回归或独立 finding 固定场景，再修改实现并做 targeted/full 验证；没有重写历史或 push。

## 4. Fault / negative coverage

- ticket malformed/oversized/tamper/future/expired、signature purpose isolation、Redis `jti` replay 与 restart replay；
- role hint mismatch、current membership revoked/kicked、old epoch ticket、reconnect replay/snapshot/new epoch full snapshot；
- multi-tab member dedupe、connection presence rebuild、socket close != leave、host/member explicit leave、kick peer close；
- subscriber capacity rollback、actor fence terminal fan-out、checkpoint unavailable→1013/cap release；
- half-open close grace terminate、dead host heartbeat terminate→deadline/membership active→deadline 前重连；
- authority state v1 exact-CAS/TTL migration、malformed/conflict、legacy fail-closed；
- host-offline 与 room-idle deadline、scheduler/lazy cleanup、queued presence race、伪造 capability bypass 与重复清理幂等；
- Redis full predecessor/fence/TTL/terminal/delete、RoomActor warm recovery/old writer fence、authority gateway true wiring。

## 5. 实际验证

```text
pnpm --filter @mahoshojo/api exec vitest run <GMR-05 targeted suites>
  PASS — actor/membership/replay/WebSocket authority targeted regression

pnpm --filter @mahoshojo/api run test
  PASS — 32 files / 300 tests（真实 Node 用例在获准的本机网络命名空间监听 loopback）

pnpm --filter @mahoshojo/multiplayer-core test
  PASS — 9 files / 78 tests

pnpm --filter @mahoshojo/contracts test
  PASS — 20 files / 120 tests

pnpm --filter @mahoshojo/api run lint
pnpm --filter @mahoshojo/api run build
pnpm --filter @mahoshojo/multiplayer-core run lint
pnpm --filter @mahoshojo/multiplayer-core run build
pnpm --filter @mahoshojo/contracts run lint
pnpm --filter @mahoshojo/contracts run build
git diff --check
  PASS

REDIS_URL=redis://127.0.0.1:6389 ROOM_REDIS_VERIFY_KEY_PREFIX=<isolated-prefix> \
  pnpm --filter @mahoshojo/api run verify:room-redis
  PASS — Redis 7.0.15 full；authorityGatewayRedisWiring、authorityStateV1Migration、ticketReplay 等为 true

ROOM_REDIS_VERIFY_PHASE=write ... verify:room-redis
<restart temporary Redis with AOF>
ROOM_REDIS_VERIFY_PHASE=read ... verify:room-redis
  PASS — acknowledged RoomActor checkpoint、ticket replay 跨 restart、new epoch recovery 与 old writer fence

pnpm run ci:verify
  PASS — workspace boundaries、all packages/apps tests/lint/build、root/Web/API/contracts/core 与 production build
```

沙箱内完整 API 首次仅因 `listen EPERM 127.0.0.1` 失败；在授权的本机网络命名空间原样重跑全绿。Redis 只监听
`127.0.0.1:6389`，验证后正常停止；AOF 临时目录经确认后删除。未访问外网、远程服务器或生产资源，未读取 SSH 私钥。

既有 naming audit 保持 report-only；physical D1、preview resources 与 Hosted DR 独立 production/integration gate 保持
原有 `DEFERRED`，没有被本 Goal 提升。

## 6. Independent review 与关闭状态

三路独立审查累计发现并关闭：

- authority state v1 无迁移；增加 exact-CAS + `KEEPTTL` v2 migration 与 legacy fail-closed；
- 已到期 deadline 可被 reconnect/presence 清除；增加 lazy validation，最终前移到每个 queued apply 线性化边界；
- subscriber capacity 失败泄漏、actor fence 不关闭 peers；增加 rollback 与 terminal fan-out；
- gateway closing session 可无限 half-open；增加 bounded grace terminate/dispose；
- 缺少真实 Redis production-like wiring/AOF ticket replay 与 heartbeat authority lifecycle；补齐 verifier/real Node tests；
- 仅用结构字段识别 deadline closer，伪造 capability 可跳过自动 close；改用 core WeakSet brand parser；
- room-idle deadline 缺少独立队列竞态覆盖；补齐 idle reason、持久/actor state 与重复 cleanup。

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
| GMR-05 stopping condition | `PASS` | ticket/membership/reconnect/lifecycle/fault/review 全闭合 |
| Development Gate runtime | `PASS` | 本地显式 flag 可组合 authority；默认关闭，无 HTTP 产品入口 |
| production activation | `DEFERRED` | production/preview 禁止 flag；routing/DNS/LB/Access 未变更 |
| Redis authority schema | `PASS` | v2 + strict v1 lazy exact-CAS migration；当前无 production Room 数据 |
| D1/schema migration | `NOT_APPLICABLE` | 本切片无 D1 migration；GMR-06 才增加 isolated migration code |
| secret/credential | `NOT_APPLICABLE` | 复用既有签名能力且 purpose 隔离；未 provision/read/change secret |
| deploy/cutover/release | `NOT_APPLICABLE` | 未部署、远程写入、push、release 或 tag |
| remaining blocking finding | `NOT_APPLICABLE` | 无 |

回滚使用普通 `git revert`：先回退本日志/状态文档提交，再按 `d99c07e9` → `41150c6f` → `c3a61b0c` →
`b85f8987` 逆序回退。尚无 production Room 数据或 D1 migration，无外部资源、secret 或远程 Redis 需要恢复。

当前剩余工作按 Goal 指南先执行 `GMR-06 D1 directory / discovery`：只实现 derived metadata、bounded/indexed query、
Redis final validation、orphan cleanup/reconciliation 与 isolated D1 migration test，不执行 production migration；`GMR-07`
也已解锁但在本 `/goal` 中排在 GMR-06 之后。
