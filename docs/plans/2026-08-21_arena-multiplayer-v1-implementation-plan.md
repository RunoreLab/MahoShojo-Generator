# 竞技场多人协作模式 v1 实施计划

## 1. 目标

在不复制竞技场页面、不改变既有战报生成核心语义的前提下，为 `/arena` 增加注册用户多人房间、配置同步、Proposal、共享战报与低成本实时传输。

本计划优先降低架构风险和 Cloudflare 资源消耗；任何阶段均不得通过固定频率轮询替代尚未实现的实时能力。

关联规格：

- `docs/specs/2026-08-21_arena-multiplayer-v1-spec.md`

## 2. 总体策略

采用分阶段交付：

1. Phase A：共享配置契约与纯客户端 diff
2. Phase B：Room sidecar Worker + Durable Object
3. Phase C：房间创建/加入/状态条
4. Phase D：Proposal
5. Phase E：战报单次生成与房间广播
6. Phase F：个人页多人战报关联（可选）
7. Phase G：资源审计、限流、TTL 与 PVP 复用评估

每阶段要求：

- 原子提交；
- 单元/集成测试；
- 不提前实现后续复杂功能；
- 保持现有单人竞技场完全可用。

## 3. Phase A：共享配置契约

### 3.1 新增 domain types/schema

建议新增：

- `lib/arena-multiplayer/types.ts`
- `lib/arena-multiplayer/schema.ts`
- `lib/arena-multiplayer/shared-config.ts`
- `lib/arena-multiplayer/proposal.ts`

实现：

- `ArenaRoomSharedConfig`
- `HostLocalCombatantStub`
- versioned `DataCardRef(versionToken)`
- `ArenaProposal`
- `ArenaProposalChange`
- typed `expectedBase` / precondition
- `RoomRevision`
- room protocol version / cursor types
- proposal dependency / atomic group

### 3.2 Shared Config Projection

新增：

- `buildArenaRoomSharedConfig(battleState)`
- `applyArenaRoomSharedConfig(sharedConfig)`

要求：

- 白名单；
- 无 `userProviderConfig`；
- 无 API credential；
- 无战报/运行态；
- host-local 只产出 stub。

### 3.3 本地 diff

实现：

- `diffArenaSharedConfig(base, working)`
- `validateProposalChanges()`
- `detectProposalConflicts(base, current, changes)`

先完全在浏览器/单元测试运行，不接后端。

### 3.4 测试

至少覆盖：

- 角色新增/移除
- Guidance 变化
- 模式/情景变化
- material
- team
- 无修改
- host-local stub
- 敏感字段不可进入 DTO
- dependsOn/atomic group
- stale revision conflict based on typed expectedBase
- online ref versionToken drift
- old/new protocol fixture

## 4. Phase B：Room Worker / Durable Object 基础

### 4.1 独立 Worker

独立 Room Worker 已由 ADR 冻结；Monorepo 迁移前可用：

- `workers/arena-room/`

或仓库现有等价目录；迁移后目标为：

- `apps/arena-room/`

这不新增第二套 Arena 页面。

职责：

- WebSocket upgrade
- short-lived room ticket verification
- ArenaRoom Durable Object
- room-local SQLite storage
- unified alarm scheduler
- broadcast / reconnect
- GenerationBridge ingress

调用路径：

- Cloudflare Worker caller -> Service Binding / typed RPC；
- `apps/api` / Hono -> generation-scoped authenticated GenerationBridge；
- Hono 不使用 Service Binding 假设。

### 4.2 Durable Object 数据

最小表/持久状态：

- room / terminal state / roomEpoch / control seq
- user-level members
- shared_config / revision
- proposals + typed precondition
- generation idempotency/current attempt
- logical deadlines

不要建立：

- chat_messages
- presence_history
- story_chunks
- heartbeat_log

### 4.3 Hibernation

必须使用 Hibernation WebSocket API。

禁止：

- per-room `setInterval`
- 应用层高频 ping
- 标准 WebSocket API 导致对象一直驻留
- 每 token 一个事件

### 4.4 cleanup

实现统一：

`destroyRoom(reason)`

顺序：

1. durable state -> closing/terminal，禁止新 join/publish；
2. 广播 closing；
3. best-effort 幂等删除 D1 directory；
4. `storage.deleteAll()`；
5. D1 删除失败交给低频 reconciliation。

要求：

- 幂等；
- 空 DO storage 在 join/reconnect 上解释为 not-found，不能自动创建 room；
- 只有显式 create-room 流程能初始化新 room；
- 日志只记录 room hash / reason / metrics。

### 4.5 Alarm

实现逻辑 deadline：

- host-offline grace
- abandoned room idle TTL

每个 DO 只有一个物理 alarm：

1. deadlines 持久化；
2. `setAlarm(min(active deadlines))`；
3. handler 再读当前状态；
4. 处理所有 due 条件；
5. destructive cleanup 再验证；
6. 重新安排下一 deadline。

覆盖 alarm retry / duplicate delivery，避免旧 alarm 错删活跃房间。

## 5. Phase C：Arena 页面房间 UI

### 5.1 页面集成

只修改现有 Arena Page，不新增独立 multiplayer arena route。

建议新增组件：

- `ArenaMultiplayerStatusBar`
- `ArenaRoomBrowserModal`
- `ArenaRoomMembersModal`
- `ArenaRoomSettingsModal`

### 5.2 房间操作

支持：

- create
- find/list public rooms
- join by room id/invite
- leave
- host close
- member list

### 5.3 Auth

多人入口对未登录用户：

- 显示登录要求；
- 不发 room API 请求。

### 5.4 WebSocket reconnect

实现：

- reconnect backoff
- `roomEpoch + controlSeq`
- generation `chunkSeq`
- snapshot / generation resync recovery
- multi-tab connection presence
- host offline indicator

不实现 polling fallback loop。

## 6. Phase D：Proposal

### 6.1 普通成员流程

1. sync room config
2. 在现有 Arena UI 修改 working copy
3. 打开 Proposal Preview
4. 自动显示 diff
5. 默认勾选新修改项
6. 用户取消不希望提交的项
7. submit

### 6.2 内容限制

普通成员：

- 不可使用本地上传/粘贴作为 Proposal 来源；
- 新增卡只能选择允许引用的在线 Data Card；
- host-local stub 只允许 Guidance 等明确白名单字段；
- Proposal bytes/change count/guidance length 有硬限制。

UI 应在多人 member 模式中禁用或明确隐藏“本地导入用于 Proposal”的路径，但不要破坏用户退出房间后的单人功能。

### 6.3 房主 Review

新增：

- Proposal inbox
- per-change review
- conflict presentation
- accept selected
- reject
- dependency/atomic group enforcement

接受后，在单房间原子状态转换中：

- server/DO validate schema/capability
- validate typed expectedBase / versionToken
- enforce dependency/atomic group
- apply selected semantic changes
- update proposal state
- revision++
- broadcast `room.config.updated`

### 6.4 stale

收到 room revision 更新时：

- 不覆盖 member 有修改的 working copy；
- 标记 stale；
- 允许重新同步；
- 仍可提交并由服务端判断冲突。

## 7. Phase E：Generation Bridge

### 7.1 Host-only generation

只有 host 能发起多人房间 generation。

开始前：

1. 检查 host 仍是有效 membership；
2. 发布未同步 host working config；
3. 生成稳定 `generationRequestId`；
4. DO 原子 reserve generation，freeze room revision / shared config / ref versions；
5. 创建 participant snapshot / snapshot digest；
6. 仅根据实际进入 snapshot 的 accepted third-party changes 设置 `collaborativeInfluence`；
7. 调用现有 Arena generation，并把同一 `generationRequestId` 作为 idempotency key。

### 7.2 不改 AI 核心为 N 份，也不让浏览器做中继

现有生成链路仍是唯一 AI 调用。

Host browser：

- 只发起 generation intent / 所需 generation payload；
- 不承担 `AI stream -> room` 唯一转发责任。

Generation service -> Room 新增版本化 GenerationBridge：

- generation started
- batched story delta
- generation metadata
- completed/failed/cancelled
- attempt / batchSeq / idempotency

Hono 场景首选 generation-scoped authenticated WebSocket publisher；若 PoC 后选择 batched HTTPS，仍复用同一 bridge contract。

### 7.3 流批处理与恢复

将 AI stream delta 累积后批量发给 room worker。

初始目标：

- 50–100ms 或达到字节阈值发送；
- 单 batch 有 bytes/rate 上限；
- `generationId + chunkSeq` 单调；
- 重复 batch 幂等丢弃；
- 不把“每 token 一个 DO call”作为实现；
- 不逐 chunk 持久化正文；
- reconnect gap 无法恢复时允许 `generation.resync`；
- completed 后从 authoritative generation storage / R2 恢复完整 report。

### 7.4 member view

普通成员 BattleResult 进入 remote-generation view：

- 不触发 AI 请求；
- 不写房主本地 Arena store 的敏感部分；
- 显示同一 report；
- 显示安全投影后的 updated combatants；
- 不能执行 host-only redo/apply actions。

需要仔细审查现有 `BattleResult` 上：

- redo updates
- manual meta apply
- SaveToCloudButton
- illustration generation

哪些按钮在 member remote view 应隐藏或重新定义权限，避免成员意外触发额外 AI/写操作。

## 8. Phase F：个人页多人战报（可选）

若启用：

新增关联表：

`battle_report_generation_participants`

generation 完成后一次 batch insert participant snapshot。

个人页：

- owner generations
- participant generations

正文仍指向同一 generation/R2 输出。

避免：

- 为每个 participant 复制 generation row；
- 复制 R2 report；
- 重跑生成。

## 9. Phase G：资源与安全 hardening

### 9.1 Rate limits

建议至少：

- create room / user
- join / user + IP
- room search / user + IP
- proposal submit / user + room
- proposal resolve / host + room
- publish / host + room
- generation start / host

### 9.2 Client cooldown

仅用于 UX。

禁止把客户端倒计时当作服务器安全保证。

### 9.3 D1

对 room directory：

- 查询只读必要列；
- public listing 有 limit/cursor；
- 索引命中；
- 不做 `COUNT(*)` 全表实时在线统计；
- 可短期 edge cache 房间列表。

### 9.4 DO / Protocol

记录：

- room creation count
- active room count（统计层，不每次 presence 写 D1）
- messages in/out / rejected oversized/rate-limited
- proposal count / stale conflict count
- cleanup reason / alarm retry
- generation fanout / bridge retry / duplicate batch count
- reconnect / snapshot fallback / resync count
- protocol version / incompatible peer count

不记录用户正文、ticket、API Key、完整本地卡。

同时测试：

- old/new peer version skew；
- target Worker 先部署、caller 后切换的 expand/contract；
- slow consumer/backpressure；
- D1 orphan directory reconciliation；
- browser Origin deny 与 native ticket path。

### 9.5 成本验收

上线前压测场景：

1. 1 host + 1 member idle 30 min
2. 1 host + 8 members idle
3. 8 members 同时 submit proposal
4. 10k–50k 字流式战报
5. host refresh/reconnect
6. member refresh/reconnect
7. host close
8. abandoned room alarm cleanup
9. host refresh / socket disconnect during generation
10. duplicate generation start / bridge batch retry
11. multi-tab same-user join/leave
12. old/new protocol version skew
13. oversized/flood/slow-consumer
14. orphan D1 room directory row

检查：

- Worker requests
- CPU ms
- DO requests/duration
- DO storage
- D1 rows read/write
- R2 ops

## 10. 推荐首期默认值

以下均应集中为常量，可根据使用数据调整：

```text
MAX_ROOM_MEMBERS = 8
MAX_MULTIPLAYER_COMBATANTS = 10
MAX_PENDING_PROPOSALS_PER_MEMBER = 8
MAX_PROPOSAL_CHANGES = 32
HOST_OFFLINE_GRACE = 45 min
ROOM_IDLE_TTL = 12 h
```

Proposal payload/guidance 字节和字符限制应结合现有 schema 再冻结具体值。

## 11. 暂缓事项

以下不应进入首期实现：

- chat
- reactions
- voting
- host transfer
- private card temporary share
- local payload from members
- CRDT
- PartySub
- large-room sharding
- participant-generated AI summaries
- AI automatic proposal merge

## 12. 预期提交拆分

建议：

1. `docs: freeze arena multiplayer v1 design`
2. `feat(arena): add multiplayer shared-config contracts`
3. `feat(room): add arena room durable object`
4. `feat(arena): add room status and membership ui`
5. `feat(arena): add proposal workflow`
6. `feat(arena): broadcast host generation to room`
7. `feat(profile): show multiplayer generation participation`
8. `perf(room): harden limits cleanup and observability`

每个提交单独通过现有 verify/test/typecheck/lint。

## 13. Done 定义

v1 完成时应满足：

- 单人竞技场行为无回归。
- 已注册用户可在现有 Arena 页面创建/加入房间。
- member 可同步 host shared config。
- member 本地修改不产生网络请求。
- member 只能提案线上引用与允许字段。
- host 可部分接受 Proposal。
- stale Proposal 通过 typed expectedBase 有冲突保护，不依赖无限 revision history。
- online ref 具备 versionToken，引用漂移显式失败。
- host-local full payload 不进入 Room/broadcast。
- API credential 不进入 room。
- generationRequestId 重试不产生重复 AI。
- host 一次生成所有成员看到同一战报。
- 房主浏览器不是流式中继；host refresh 不破坏已接受 generation。
- GenerationBridge 有鉴权、batch sequence 与幂等。
- 成员不触发额外 AI 调用。
- same user 多标签页只有一个 membership。
- socket disconnect 不销毁房间。
- host explicit leave/close 销毁房间。
- abandoned room 会被单 alarm scheduler + TTL 清理。
- 无固定频率 room polling。
- idle WebSocket 能 hibernate，wake 后 cursor/snapshot 可恢复。
- D1 不存 presence / story chunk，且只作为 derived directory。
- old/new protocol version 有兼容夹具和 rollout 顺序。
- oversized/flood/slow-consumer 有服务器保护。
- room cleanup 后 DO storage 被完全清理。
