# Arena Room 运行时可移植与 Hono + Redis 首发决策

状态：`accepted + 部分 superseded`
日期：2026-08-25
决策标识：`ADR-arena-room-portable-runtime-hono-redis-first`
取代：`ADR-arena-room-deployment-realtime-authority`
部分被取代：`ADR-arena-multiplayer-redis-only-room-directory`
基线分支：`refactor/platform-rearchitecture`
基线提交：`73e51e1e18e27eee7d09e36ff0ff8010e56e5d88`

## 1. 决策关系与适用范围

本 ADR 取代 `docs/decisions/2026-08-22_184800_ArenaRoom部署边界与实时权威决策.md` 中“首发必须使用独立 `apps/arena-room` + 一房间一 Durable Object”的部署与运行时决定。

旧 ADR 保留为历史记录；从本文 `accepted` 起，其中以下内容不再具有现行规范效力：

- v1 必须建立独立 `apps/arena-room` Worker；
- v1 必须一房间一 Durable Object；
- v1 必须使用 Durable Object SQLite/Hibernation/alarm；
- `apps/web -> apps/arena-room` 必须使用 Service Binding；
- Hono generation 必须通过跨部署 `GenerationBridge` 发布到 DO；
- D1 room directory 的最终目标必须是 DO；
- DO internal id、DO storage migration 等仅由该实现产生的约束。

旧 ADR 中与具体平台无关的协议、安全和业务语义继续有效，尤其包括：

- Arena 多人仍复用现有 `/arena`，不建立第二套产品；
- Room Shared Config 使用显式安全投影；
- Provider/API credential 与完整 host-local payload 不进入 Room plane；
- Proposal 使用 typed semantic change + typed `expectedBase`；
- online DataCard ref 必须版本化；
- generation start 必须使用稳定 `generationRequestId` 并保持幂等；
- 房主浏览器不得成为 AI stream 的唯一中继；
- membership 与 connection/presence 分离；
- WebSocket 鉴权、Origin、message authorization、大小限制和 backpressure 要求继续有效。

本 ADR 只改变 **Room Authority 的运行时实现和故障恢复承诺**，不降低服务器权威、安全、幂等、排位或数据所有权要求。

> **部分 superseding notice（2026-08-28）**：本文关于 D1 `arena_multiplayer_rooms`、directory orphan
> reconciliation 的决定已被 [Arena 多人 Redis-only Room Directory 决策](./2026-08-28_181500_Arena多人RedisOnly目录决策.md)
> 取代。其余 Hono + Redis 首发、Room authority、generation、security 与恢复边界继续有效。

## 2. 背景

原方案在 Arena 多人 v1 尚未进入重运行时实现前，就冻结了 Durable Object、Hibernation、alarm、独立 sidecar Worker 和跨部署 GenerationBridge。该方案能够获得单房间串行协调、边缘 WebSocket 和空闲休眠等优势，但也提前引入：

- 独立 Cloudflare Worker/DO 部署、配置和协议兼容；
- Hono 与 DO 之间的跨公网/跨运行时发布链；
- DO storage/alarm/Hibernation 专属生命周期；
- `apps/web`、`apps/api`、`apps/arena-room` 三方 version skew；
- 尚未由真实负载证明必要的多运行时复杂度。

与此同时，平台重整已经建立真实 `apps/api` / Hono Node，并计划 Redis 承担限流、租约、presence、Pub/Sub、短期 Stream 等高频或可丢失运行态。Arena 多人房间本身是短生命周期协作会话，其永久业务结果仍由既有 generation persistence、D1、R2 等持久层承担。

因此，本轮优先复用已经存在的 Hono + Redis 执行面，并把 Room 协调语义从 Cloudflare 专属实现中抽离。

## 3. 决定摘要

Arena 多人 v1 采用：

```text
Host / Member existing Arena UI
        │
        │ HTTPS / WSS + short-lived room ticket
        ▼
apps/api / Hono HK
        │
        ├─ in-process RoomActor / RoomAuthority
        │    ├─ serialize room commands
        │    ├─ membership / role / presence
        │    ├─ Shared Config / revision / Proposal
        │    ├─ generation reservation / mirror
        │    └─ reconnect / lifecycle
        │
        ├─ Redis
        │    ├─ versioned room checkpoint + TTL
        │    ├─ presence / transient indexes
        │    ├─ optional fan-out Pub/Sub
        │    └─ optional bounded replay Stream
        │
        ├─ Redis directory record / bounded public index
        │    └─ derived discovery, revalidated against current checkpoint
        ├─ D1
        │    └─ existing durable business facts by domain（不含 v1 Room directory）
        │
        └─ R2 / generation persistence
             └─ final authoritative generation artifacts
```

v1 **不要求**：

- 建立 `apps/arena-room`；
- 使用 Durable Object；
- 为 Room 实现 Cloudflare Hibernation/alarm；
- 为 Hono 内部 generation -> Room 发布建立跨部署 GenerationBridge；
- 实现正在进行房间的跨故障域无缝热迁移。

Durable Object 保留为未来 `RoomRuntime` adapter / Cloudflare DR / scale-out 选项，而不是首发前置条件。

## 4. Room Authority 与平台实现分离

### 4.1 领域概念

`ArenaRoom` 的正确性必须由平台无关的状态机和协议定义，而不是由 Durable Object API、Redis API 或 Hono Context 定义。

共享包应保持类似以下依赖方向：

```text
packages/contracts
packages/multiplayer-core
        ▲
        │ pure state / validation / transition semantics
        │
apps/api Room runtime adapter
        ├─ Hono WebSocket ingress
        └─ Redis room store

future optional adapter
        └─ Cloudflare Durable Object runtime
```

`packages/multiplayer-core` 不得导入具体 Redis client、Hono Context、Cloudflare binding 或 Durable Object class。

### 4.2 首发实现不是永久绑定

Hono + Redis 是 v1 的 **首发 adapter**，不是新的不可替换业务定义。

若未来引入 DO，必须复用同一：

- Room DTO / event envelope；
- Shared Config projection；
- Proposal / precondition；
- revision 与 epoch 语义；
- generation idempotency；
- authorization / security contract；
- snapshot/reconnect contract。

不得为了迁移到 DO 再设计第二套多人协议。

## 5. 数据与权威层级

### 5.1 持久业务权威

以下事实不得只依赖 Hono 内存、Redis 或 VPS 本地磁盘：

- generation 的最终权威记录与最终对象；
- rating / settlement / provenance 中要求长期成立的事实；
- 账号、权限、线上数据卡、审核、审计等现有 D1 业务事实；
- 已由其他领域 ADR 定义为 R2/D1 权威的对象。

Redis 清空或整台 VPS 丢失后，这些事实仍必须保持正确，不能从客户端或 Redis 猜测恢复。

### 5.2 会话权威运行态

活跃房间运行时可以权威协调：

- room lifecycle；
- membership / role；
- Shared Config；
- revision；
- unresolved Proposal；
- generation reservation / mirror；
- reconnect cursor / bounded replay metadata；
- lifecycle deadline。

这些状态允许使用 Hono 内存 + Redis checkpoint，因为其恢复契约是：**状态丢失可以终止或重建会话，但不得改变已经成立的持久业务事实。**

因此“Redis 不作为业务权威数据库”与“Redis 保存 Arena 活跃房间 checkpoint”并不冲突。Redis 是 Room runtime 的可恢复会话存储，不是永久业务事实源。

### 5.3 房主本地数据

房主设备继续保存：

- local working copy；
- 完整 host-local payload；
- UI/local-only state。

房主本地副本可以帮助重建新的 Shared Config，但不得被视为旧服务器权威事实的证明。客户端不能自行证明：

- 旧 membership/role；
- Proposal 已被接受；
- 旧 generation 已成功或已结算；
- 某个 revision 是服务器最终确认版本。

这些事实必须按服务器可验证记录或新的 Room epoch 重新建立。

## 6. 单房间单写者是 v1 的并发基线

### 6.1 初始拓扑

v1 首先保证：

> 任一 `roomId` 在任一时刻只有一个活动 RoomActor 负责改变其会话权威状态。

初始接受的最低复杂度拓扑是 **一个 room-capable Hono 实例**。RoomActor 在单一 Node event loop 中串行处理房间 command，不为尚不存在的多实例竞争提前实现分布式锁。

其他 HTTP/generation 能力未来可以独立扩容，但这不自动授权多个 room-capable 实例同时竞争同一 room。

### 6.2 多实例门禁

在启用多个 room-capable Hono 实例前，必须另行证明以下至少一种方案成立：

- 稳定 room ownership / routing + fencing；
- 能证明 safety/liveness 的 Redis lease/fencing 设计；
- 独立 Room runtime；
- Durable Object 等天然提供单协调原子的运行时。

不得仅以普通 `SETNX`、短 TTL 或“通常会 sticky”作为服务器权威正确性的唯一保证。

当多实例 ownership/lease/fencing 的复杂度接近重新实现 Durable Object 的价值时，应优先重新评估 DO，而不是继续扩张自研分布式协调层。

## 7. Redis 使用模型

### 7.1 Semantic checkpoint

低频、会改变房间语义的 command，例如：

- create / close；
- membership 变更；
- host publish；
- Proposal submit/resolve/withdraw；
- generation reservation / terminal mirror；

应生成版本化 Room checkpoint。

首发基线要求：对会返回“已成功提交”的关键控制变更，在向客户端确认成功前完成相应 Redis checkpoint；避免 Hono 进程立即重启后把已经确认的 revision/Proposal 悄然回滚。

checkpoint 应至少包含：

```text
schemaVersion
roomId
roomEpoch
revision
room metadata / lifecycle
members / roles
shared config
unresolved proposals
current generation reservation/mirror
logical deadlines
updatedAt
```

可采用单个版本化 snapshot key 或具备等价原子性的有限结构。不要把房间状态拆成大量互相无法原子观察的 key 后再假定它们永远一致。

### 7.2 TTL

Room checkpoint 必须有 TTL/过期策略，避免用户直接关页后永久占用 Redis。

TTL 只负责会话垃圾回收，不负责永久业务保留。Redis directory record/index 与 checkpoint 同一原子 lifecycle 维护；
stale candidate 只允许在 current authority 重验后的 exact-CAS/lazy cleanup。

### 7.3 Presence 与 story delta

以下状态允许更弱的持久语义：

- connection presence；
- typing/heartbeat；
- 临时 story delta；
- 可重建在线人数；
- transient fan-out metadata。

它们可以只在内存或 Redis 临时结构中存在，不要求每条写 checkpoint。

### 7.4 Pub/Sub 与 Streams

Redis Pub/Sub 只用于 **在线 fan-out/通知**。不得把 Pub/Sub 当作事件历史或 Room state 的唯一来源；订阅端掉线时消息可能永久丢失。

当且仅当真实需求要求跨实例或重启后的有界 replay 时，再引入 Redis Streams 或等价日志。v1 不为了“也许将来会用”预建无限 event sourcing。

重连正确性基线始终是：

```text
current snapshot + optional bounded replay
```

而不是“所有 Pub/Sub 消息都必须收到”。

### 7.5 Redis 故障

Redis 不可用时：

- 已连接用户可以继续接收不改变权威状态的临时流式事件，前提是内存/backpressure 仍安全；
- 需要确认持久到 session checkpoint 的 authority-changing command 应 fail closed / 返回明确 degraded 错误；
- 不得把“Redis 挂了”自动解释为“以后只写 Hono 内存且仍宣称完全可恢复”；
- 不得把 Redis 故障升级为对持久业务事实的错误写入。

## 8. `roomEpoch` 是运行时重建的 fencing 边界

沿用已有 `roomEpoch`，但明确其语义：

> `roomEpoch` 标识当前 Room Authority incarnation；当旧运行时可能仍有迟到 command/callback，或运行时所有权发生不可证明连续的重建时，必须切换 epoch。

要求：

- Room event/snapshot 携带当前 epoch；
- mutable command 必须在服务端绑定或校验当前 epoch；
- generation callback/publisher 必须不能让旧 epoch 的 attempt 覆盖新 epoch；
- epoch 不匹配时不得尝试“补齐旧消息后继续写”，而是 snapshot/rejoin/recovery；
- `revision` 只在对应 epoch 语境内解释；客户端不得仅凭较大的 revision 压过新 epoch。

Hono 进程重启且 Redis checkpoint 完整时，可以恢复同一 `roomId`，但首发默认生成新 epoch 并发送完整 snapshot，以获得简单明确的 fencing。

Redis/VPS 整体丢失时，不保证保持同一 roomId；允许房主创建 replacement room 并重新邀请成员。若未来需要同 roomId 灾难恢复，必须另行定义 D1 durable registration / ownership 语义，不能靠残留 directory row 自动复活房间。

## 9. Reconnect 与恢复语义

### 9.1 普通断线

socket close 仍不等于 membership leave。普通刷新、切网、浏览器后台等：

- 客户端使用短期 ticket / session 重新鉴权；
- epoch 相同且 bounded replay 可用时可以补 control event；
- replay 不足时直接返回最新 snapshot；
- story delta gap 无法补齐时进入 generation resync；
- generation 完成后从最终权威 generation storage 获取完整结果。

### 9.2 Hono 进程重启，Redis 仍在

允许 warm recovery：

1. 从 Redis checkpoint 重建 RoomActor；
2. 生成新的 `roomEpoch`；
3. presence 从新连接重建；
4. pending Proposal / Shared Config 从 checkpoint 恢复；
5. generation 状态与持久 generation record 对账；
6. 客户端收到完整 snapshot 后继续。

v1 不要求 replay 进程死亡前最后一条临时 story delta。

### 9.3 Hono + Redis / VPS 整体故障

v1 明确 **不承诺活动房间无缝热迁移**。

整机故障可以导致：

- presence 丢失；
- 尚未 checkpoint 的临时状态丢失；
- pending Proposal 需要重提；
- story delta 需要 resync；
- 当前 Room 终止并由房主重建 replacement room。

但不得导致：

- 第二次盲目 AI generation；
- 重复结算/rating；
- 已完成 generation 最终结果消失；
- 客户端自行宣称旧服务器事实成立。

## 10. Generation 与 Room 在同一 Hono 主运行时收口

### 10.1 主路径不再需要跨部署 GenerationBridge

当 authoritative Arena generation 与 Room runtime 都位于 `apps/api` / Hono 时，首发主路径采用进程内/服务内 `RoomGenerationPublisher` 端口：

```text
host generation intent
  -> Room reserve + frozen snapshot
  -> existing authoritative Arena generation service
  -> RoomGenerationPublisher
  -> batched safe delta / terminal projection
  -> RoomActor broadcast
```

`RoomGenerationPublisher` 是逻辑端口，不是公开 HTTP contract。

未来若 generation 与 Room 分拆到不同进程/平台，可以为同一端口提供：

- authenticated internal transport；
- Redis Stream/queue（若语义合适）；
- Durable Object GenerationBridge adapter。

不得因此把 v1 重新绑定到跨公网 bridge。

### 10.2 幂等要求不变

简化部署不降低 generation 正确性：

- `generationRequestId` 在一次 start intent 内稳定；
- reservation 冻结 revision/snapshot digest/participant snapshot/ref versions；
- generation service 也必须以稳定 idempotency key 去重；
- terminal event 必须匹配当前 attempt + room epoch；
- Hono 进程中断后，不得因客户端重连自动再次 POST 一次 AI generation；
- 状态未知时先查询/对账 durable generation record，再决定显示 failed/unknown 或允许显式重试。

房主浏览器仍只发起 intent/必要 generation payload，不承担 AI stream 唯一中继。

## 11. Deadline 与清理

v1 不复制 Durable Object 单 alarm scheduler。

可以使用：

- Redis checkpoint TTL；
- 进程级 min-heap/timer scheduler；
- 请求/重连时 lazy deadline validation；
- 低频 reconciliation。

约束：

- 不为每个 room 建立永久 `setInterval`；
- 不以高频轮询维持房间；
- destructive cleanup 前重新验证 deadline/epoch/state；
- timer 丢失或进程重启不能导致已过期房间永久复活；
- 清理必须幂等。

## 12. Redis-only room directory 是派生索引

本节已由 `ADR-arena-multiplayer-redis-only-room-directory` 细化：v1 public/unlisted discovery 使用 Redis
directory record 与有界 public index；create/recovery/close 与 checkpoint 在同一 Lua/CAS 边界维护，任何成功
list/lookup/join 都重新验证 current open/epoch/host authority。

v1 不发布 `arena_multiplayer_rooms`，也不保留 Redis-to-D1 registration、projection、tombstone 或 reconciler。
如果未来要求跨 Redis runtime 发现或整机故障后保持相同 `roomId`，必须另立 durable registration/ownership ADR，
不能靠历史 D1 row 自动复活房间。

## 13. Cloudflare DR 的范围

现有 Hosted DR 仍用于 Hono HTTP capability 的受控 active-passive 灾备，但 **Arena Room realtime 不因本 ADR 自动进入 DR manifest**。

v1 的明确承诺是：

- Hono/Redis 正常时提供多人 Room realtime；
- Hono 故障时，其他已进入 DR manifest 的 Hosted 能力按各自 ADR 切 Cloudflare；
- 若尚未实现 Cloudflare Room adapter，多人 room capability 可以明确 degraded/unavailable，而不是用不完整语义假装接管；
- 后续可以实现 Cloudflare `RoomRuntime` adapter（Durable Object 是首选候选），用于新房间接管或更高等级恢复；
- 在没有跨故障域状态协议前，Cloudflare adapter 不得与旧 Hono room 对同一 epoch 双写。

因此 Cloudflare 是多人未来可用的灾备运行时，但不是 v1 首发实现的强制依赖。

## 14. 何时重新评估 Durable Object

满足任一条件时，应建立明确的 DO/其他独立 Room runtime 评估，而不是无限扩张 Hono + Redis：

1. 需要多个 room-capable Hono replica，ownership/lease/fencing 已成为显著复杂度；
2. 要求 Hono/VPS 故障时活动房间尽量无感继续；
3. 全球用户 WebSocket RTT/地域成为真实体验瓶颈；
4. active socket、event-loop delay、RSS/heap、egress 或单机连接数出现容量压力；
5. Redis fan-out/replay/ownership 代码开始重复实现 DO 已提供的协调能力；
6. Cloudflare Room DR 的业务价值足以覆盖双 runtime 的测试和运维成本。

若届时选择 DO，推荐仍以“一逻辑房间一 coordination atom”为映射，并复用本 ADR 的 runtime-neutral contract。

## 15. 安全与资源要求继续有效

无论 Hono 还是未来 DO adapter，必须保持：

- 生产 HTTPS/WSS；
- 短期签名 room ticket；
- 浏览器严格 Origin allowlist；
- 非浏览器客户端不以 Origin 为信任根；
- message schema/capability/size/rate validation；
- outbound backlog/backpressure 有界；
- slow consumer 不得拖垮 RoomActor；
- Provider/API credential、项目 auth secret、完整 host-local payload 不进入 Room checkpoint、日志或普通成员响应；
- 对外 `roomId` 使用高熵 opaque identifier；
- 日志只记录必要 metadata，不记录 ticket、secret、完整 Proposal 或正文。

## 16. 可观察性与演进门禁

首发至少观察：

- active rooms / active room sockets；
- room create/join/reconnect/close；
- RoomActor command latency / queue depth；
- snapshot size / checkpoint latency/error；
- Redis latency/error/memory/eviction；
- reconnect snapshot rate / resync rate；
- generation publisher backlog/drop/resync；
- Hono process CPU/RSS/heap/event-loop delay；
- room recovery / replacement-room incidents。

阈值应在真实生产基线后冻结，不在 ADR 中虚构 SLA。

## 17. 影响

### 正面影响

- 多人 v1 复用已经存在的 Hono + Redis 基础设施，显著减少首发部署单元和平台专属代码。
- authoritative generation 与 Room fan-out 同运行时后，移除主路径跨部署 GenerationBridge。
- 保留 typed Proposal、revision、epoch、idempotency 等真正重要的复杂度，删除尚无数据支持的平台复杂度。
- 后续仍可通过统一 RoomRuntime contract 引入 DO，不形成协议死路。
- Redis 清空/整机故障的影响被明确限制为会话恢复，而非永久业务事实损坏。

### 代价

- v1 接受单个 room-capable Hono 实例的容量/可用性边界。
- Hono/VPS 整机故障时，活动房间可能需要重建，不能承诺无缝接管。
- Redis 成为活跃房间 authority-changing command 的运行时依赖。
- 若未来需要多实例 Room runtime，必须新增 ownership/fencing 或迁移到 DO。
- Hono WebSocket 连接会增加 Node event-loop、内存、socket 和 egress 运维责任。

## 18. 不采用的方案

- **继续把 DO 作为 v1 前置条件**：平台能力优秀，但当前没有真实负载证明值得立即承担独立 Worker/DO/bridge/alarm/Hibernation 复杂度。
- **Redis 直接替代所有持久业务数据库**：Redis/VPS 故障会破坏 rating、settlement、generation final 等长期事实，不可接受。
- **从第一天做 Hono 多实例 + Redis distributed lock**：先制造尚未存在的分布式协调问题。
- **Hono 故障后 Cloudflare 对同一 room 无状态热接管**：没有共享 authority/fencing 时会产生 split-brain 或错误恢复。
- **把房主本地副本当服务器事实备份**：客户端不可信，且本地副本不包含完整 membership/Proposal/generation authority。
- **把 Pub/Sub 当 durable event log**：订阅者离线时事件可丢失，不能支持可靠 replay。
- **固定频率轮询替代 WebSocket**：增加服务器/数据库成本并降低实时体验。

## 19. 参考

- Redis Pub/Sub delivery semantics — at-most-once delivery
  https://redis.io/docs/latest/develop/interact/pubsub/
- Redis Streams — append-only log / replay / consumer groups
  https://redis.io/docs/latest/develop/data-types/streams/
- Redis distributed locks — safety/liveness considerations
  https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/
- Cloudflare Durable Objects — coordination atom / game sessions
  https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Cloudflare Durable Objects — WebSockets / Hibernation
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- RFC 6455 — The WebSocket Protocol
  https://www.rfc-editor.org/rfc/rfc6455
- OWASP WebSocket Security Cheat Sheet
  https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- AWS Prescriptive Guidance — ADR process / superseded decisions
  https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html

## 20. 关联文档

- [被取代：Arena Room 部署边界与实时权威决策](./2026-08-22_184800_ArenaRoom部署边界与实时权威决策.md)
- [部分取代本文：Arena 多人 Redis-only Room Directory 决策](./2026-08-28_181500_Arena多人RedisOnly目录决策.md)
- [Arena 多人 Hono + Redis 运行时实施规格修订](../specs/2026-08-25_104400_Arena多人HonoRedis运行时实施规格修订.md)
- [Arena 多人 Hono + Redis 首发实施计划](../plans/2026-08-25_104400_Arena多人HonoRedis首发实施计划.md)
- [Arena 多人协作 v1 规格](../specs/2026-08-21_arena-multiplayer-v1-spec.md)
- [Arena 多人协作 v1 实施计划](../plans/2026-08-21_arena-multiplayer-v1-implementation-plan.md)
- [Hosted 运行时容灾与 Cloudflare 灾备决策](./2026-08-23_104000_Hosted运行时容灾与Cloudflare灾备决策.md)
- [平台重整目标架构](../architecture/2026-08-22_022500_平台重整目标架构.md)
- [平台重整实施规格](../specs/2026-08-22_022600_平台重整实施规格.md)
- [平台重整分阶段实施计划](../plans/2026-08-22_022700_平台重整分阶段实施计划.md)
