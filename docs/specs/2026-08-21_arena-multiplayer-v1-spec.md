# 竞技场多人协作模式 v1 规格

## 1. 文档信息

- 状态：`accepted` / v1 设计基线
- 编写时间：2026-08-21
- 最近修订：2026-08-28（同步 Hono + Redis 与 Redis-only directory superseding 修订）
- 适用项目：MahoShojo Generator
- 目标功能：竞技场多人观看、配置同步与提案协作
- 目标平台：Hono / Node + Redis Room runtime + existing D1/R2 generation durable facts
- 核心原则：产品/UI 继续复用现有竞技场；客户端不可信、服务器权威；不复制既有战报生成核心语义
- 当前部署 ADR：`docs/decisions/2026-08-25_104400_ArenaRoom运行时可移植与HonoRedis首发决策.md`

> 实现优先级：本文的业务/wire/安全语义继续有效；DO/Hibernation 专属运行时表述由
> `SPEC-arena-multiplayer-hono-redis-runtime-amendment-v1` 覆盖，D1 Room directory 表述由
> `SPEC-arena-multiplayer-redis-only-directory-amendment-v1` 覆盖。账户、generation durable facts 等既有 D1 用途不受影响。

## 2. 背景与目标

当前竞技场已具备较成熟的单人配置与战报生成流程，包括角色、情景、素材、全局/角色引导、历战与当前状态、流式战报、云端数据卡等能力。多人模式的目标不是建立一套独立竞技场，而是在现有竞技场上叠加轻量的实时协作层：

1. 多名已注册用户进入同一竞技场房间。
2. 房主维护唯一权威生成配置。
3. 普通成员可同步权威配置，在本地竞技场 UI 中修改后，将差异作为提案提交给房主。
4. 房主逐项接受或拒绝提案，接受项才进入权威配置。
5. 房主发起一次既有竞技场生成，房间成员共同观看同一份战报及角色更新结果。
6. 控制 Cloudflare Workers CPU、D1 rows read/write 与实时消息数量，避免轮询和高频持久化。
7. 不引入聊天、CRDT、多人同时编辑同一字段等非必要复杂度。

## 3. 非目标

v1 明确不做：

- 匿名多人模式。
- 聊天系统。
- 多人实时共同编辑同一输入框。
- CRDT / Yjs 等协同编辑机制。
- 普通成员上传、粘贴或提交本地 JSON 内容。
- 普通成员通过房间临时共享自己的私有线上卡。
- 房主本地卡完整内容向普通成员同步。
- 为房间单独建立持久化角色成长数据库。
- 将提案历史永久保存为用户内容。
- 为每个观众重复生成、重复保存同一份战报。

## 4. 核心产品模型

### 4.1 单一权威配置

房间在任意时刻只有一份：

`ArenaRoomSharedConfig`

它表示“当前房间中公开给成员、并可作为下一次生成共同输入的配置投影”。

房主拥有最终修改和发布权；普通成员不能直接改权威配置，只能提交 Proposal。

### 4.2 普通成员工作副本

普通成员同步当前房间配置后：

`Room Shared Config -> Local Working Copy`

随后仍使用现有 Arena UI 自由编辑自己的工作副本。编辑行为完全发生在客户端，不产生 Cloudflare 请求。

提交提案时：

`diff(baseline, workingCopy) -> Proposal`

默认只勾选相对于 baseline 新发生的修改，用户可在发送前预览和取消部分修改。

### 4.3 房主工作副本

房主继续直接使用现有 Arena UI。

房主的本地编辑不逐键同步。只有以下动作才更新房间权威配置：

- 显式“更新房间配置”；
- 接受 Proposal；
- 开始生成前自动发布尚未发布的房主配置。

这样避免每次输入、切换、拖动都产生实时写入。

## 5. 内容来源与共享边界

### 5.1 房主本地内容

只有房主可以：

- 上传本地角色 JSON；
- 粘贴本地角色内容；
- 导入本地情景或其他本地竞技场内容。

房主本地内容遵循：

> 本地数据以房主浏览器为权威，完整 payload 不进入 Room Shared Config，不同步给其他成员。

房间只可暴露最小 stub，例如：

```ts
type HostLocalCombatantStub = {
  key: string;              // room-local opaque id
  displayName: string;
  type: 'magical-girl' | 'canshou' | 'general-character';
  source: 'host-local';
  characterGuidance?: string;
};
```

普通成员可针对 stub 修改角色引导等无需完整角色内容即可表达的字段，但不能读取完整本地卡。

### 5.2 线上库内容

普通成员只能提案：

- 公共线上库内容；
- 或其他房主本身具有读取权限的线上内容。

v1 不建立“通过房间临时授权房主读取成员私有线上卡”的权限模型。

线上对象 Proposal 应保存稳定、版本化引用，而非复制完整 JSON：

```ts
type DataCardRef = {
  id: string;
  kind: 'character' | 'scenario' | 'material';
  versionToken: string;
};
```

`versionToken` 是服务器可验证的不透明版本标识，可由 canonical `updatedAt`、revision、content digest 或未来版本系统生成；网络发布后的 ref 不得使用可选版本。

接受 Proposal、房主 publish 和 generation reservation 前必须重新验证：

- 引用仍可读取且类型有效；
- `versionToken` 仍匹配；
- 权限未变化。

版本已变化时返回显式 stale/reference-changed；不得静默解析到最新版并保持 room revision 不变。

### 5.3 稳定对象键

多人层不得只依赖 filename 或数组下标定位对象。

推荐：

- 线上数据卡：`data-card:<id>`
- 预设：`preset:<stable-name-or-id>`
- 房主本地：`host-local:<opaque-id>`

## 6. ArenaRoomSharedConfig

多人层不得序列化或同步完整 `useBattleStore`。

现有 Arena store 同时包含生成输入、UI 偏好、运行状态、战报结果以及 `userProviderConfig` 等敏感/本地字段，因此必须采用显式白名单投影。

建议共享：

- battleMode
- combatant refs / host-local stubs
- team assignment 与队伍名称
- characterGuidance
- scenario ref / host-local scenario stub
- auxiliary scenario refs
- material refs
- global userGuidance
- selected questionnaires/lore references（若可安全引用）
- storyLength / customStoryLength
- selectedLanguage
- 与生成语义有关的 arena history/current state/narrative history 读写选项
- adjudication 配置中适合共享且不泄漏本地完整数据的部分

不得共享：

- API Key
- Provider credential
- 私有 endpoint credential
- `userProviderConfig` 中的秘密字段
- streamingMarkdown
- newsReport
- updatedCombatants
- generationId
- loading/error 状态
- UI 折叠状态
- 战报卡宽度
- 本地文件完整 JSON
- 浏览器本地偏好

所有字段必须通过显式 schema（建议 Zod）定义，禁止使用“排除几个敏感字段”的黑名单方式。

## 7. Revision 与并发模型

### 7.1 Config Revision

每次权威共享配置发生语义变化：

`revision += 1`

普通成员同步时记录：

```ts
baselineRevision
baselineConfig
workingConfig
```

Proposal 必须携带：

```ts
baseRevision
```

但 `baseRevision` 只用于定位/诊断，不能单独重建 BASE。每个 typed change 还必须携带与其 target 对应的 typed `expectedBase` / precondition，使服务端无需保存无限 revision 历史即可验证 Proposal 创建时的语义值。

### 7.2 三方冲突判断

房主审阅旧 Proposal 时，以：

- BASE：change 自带的 typed `expectedBase`；
- CURRENT：当前房间权威配置中同一 semantic target 的规范化值；
- PROPOSED：提案目标值；

进行轻量三方比较。

若 CURRENT 在同一语义字段上已偏离 BASE，则标记冲突，由房主决定是否接受。冲突 UI 可以展示 human-readable baseline，但服务端正确性不能依赖客户端冲突判断。

接受所选 changes 时，必须在单房间原子状态转换中完成：

1. schema/capability/precondition；
2. dependsOn / atomic group；
3. apply selected changes；
4. Proposal 状态；
5. `revision++`。

不使用 CRDT，也不为了 stale conflict 保存无限完整 revision history。

## 8. Proposal 模型

### 8.1 Typed semantic changes

Proposal 不采用通用 JSON Patch 作为核心业务契约。

推荐定义语义化变更，例如：

```ts
type ArenaProposalChange =
  | { type: 'addCombatant'; ref: DataCardRef }
  | { type: 'removeCombatant'; combatantKey: string }
  | { type: 'setCharacterGuidance'; combatantKey: string; value: string }
  | { type: 'assignTeam'; combatantKey: string; teamKey: string | null }
  | { type: 'setBattleMode'; value: BattleMode }
  | { type: 'setScenario'; ref: DataCardRef | null }
  | { type: 'addAuxScenario'; ref: DataCardRef }
  | { type: 'removeAuxScenario'; key: string }
  | { type: 'addMaterial'; ref: DataCardRef }
  | { type: 'removeMaterial'; key: string }
  | { type: 'setUserGuidance'; value: string }
  | { type: 'setStoryLength'; value: StoryLengthOption; custom?: string }
  | { type: 'setHistorySettings'; value: SharedHistorySettings };
```

最终集合以当前实际 Arena 可编辑字段为准。

### 8.2 部分接受

房主可逐项勾选：

- 接受所选；
- 拒绝剩余；
- 全部拒绝。

### 8.3 依赖与原子组

需要支持：

- `dependsOn`
- `atomicGroupId`

例如新增角色 B 与设置 B 的角色引导存在依赖；切换 scenario mode 与设置主情景可能需要原子接受。

### 8.4 Proposal 生命周期

建议：

`draft(local) -> submitted -> partially_accepted | accepted | rejected | withdrawn | stale`

仅 `submitted` 及房主需要查看的必要状态进入房间临时存储。

## 9. 房间角色与权限

v1 只定义：

- `host`
- `member`

暂不需要独立 spectator/contributor 角色，因为所有加入房间的普通用户都可以观看并提交 Proposal；是否提交完全由用户决定。

权限：

### host

- 发布权威配置
- 接受/拒绝 Proposal
- 开始/停止生成
- 移除成员
- 关闭房间

### member

- 同步权威配置
- 编辑本地工作副本
- 提交/撤回自己的 Proposal
- 查看自己及房主允许展示的 Proposal 状态
- 查看战报与角色更新结果
- 退出房间

## 10. 房间生命周期

### 10.1 注册要求

多人模式仅已注册用户可创建、搜索、加入和参与。

### 10.2 显式退出

普通成员显式退出：

- 删除/失效该成员的活动 membership；
- 不关闭仍有房主的房间。

最后一名成员显式退出且房间已无人：

- 在 checkpoint terminal commit 的同一 Redis 原子边界删除 directory record/index；
- 清理 Durable Object storage；
- 房间销毁。

### 10.3 房主显式退出

由于房主掌握：

- 本地内容完整 payload；
- AI provider / API credential；
- 权威配置批准权；
- 实际生成执行能力；

v1 规定：

> 房主显式退出 = 立即关闭房间。

关闭流程应广播 `room.closing`，使客户端退出后再做幂等清理。

### 10.4 网络断线不等于退出

WebSocket 断线可能来自：

- 页面刷新；
- 网络切换；
- 手机后台；
- 浏览器崩溃。

因此 `socket close` 只能更新 presence，不得直接删除 membership 或销毁房间。

### 10.5 Idle TTL

为避免用户直接关闭页面产生死数据，房间必须有兜底 TTL。

建议初始默认值做成常量而非硬编码产品契约：

- `HOST_OFFLINE_GRACE_MS`: 30–60 分钟范围内选定默认值；
- `ROOM_IDLE_TTL_MS`: 6–24 小时范围内选定默认值。

满足“房主长期离线”或“房间长期无成员连接且无有意义活动”时，由 Durable Object alarm 触发幂等销毁。

每个 DO 同时只有一个物理 alarm。`hostOfflineDeadline`、`roomIdleDeadline` 及未来 recovery deadline 必须保存在 durable state，由统一 scheduler 始终 `setAlarm(min(active deadlines))`。`alarm()` 重新读取状态、处理所有到期项、再次验证 destructive 条件并重新安排下一个 deadline；不得由 constructor 无条件覆盖已有 alarm。

### 10.6 Membership 与 Connection

membership 以用户为单位，presence 以连接为单位：

```text
member(userId)
  -> connectionId A
  -> connectionId B
```

- 多标签页/多设备不能重复计算成员；
- socket close 只改变 connection presence；
- 普通成员“退出房间”是显式 user-level command；
- 房主“显式退出/关闭房间”是 room-level close command；
- 页面 unload / 单连接关闭不得隐式触发 leave/close；
- kick 失效 user-level membership 并关闭该用户现有连接；旧 ticket 重连时仍需由 DO membership 拒绝。

## 11. 生成模型

### 11.1 只生成一次，浏览器不做中继

多人模式不得为每个观看者调用 AI。

推荐：

```text
Host Arena UI
  -> start-generation intent
  -> room reservation / frozen snapshot
  -> existing Arena generation service
  -> one authoritative generation
  -> existing generation persistence / R2
  -> authenticated GenerationBridge
  -> ArenaRoom broadcast
  -> all host/member viewers render same safe projection
```

房主浏览器可以发起 generation request，但不得成为 `AI stream -> browser -> room` 的唯一中继。generation service 接受多人任务后，AI 执行与 room publisher 不依赖房主 Arena WebSocket；刷新/切网/关闭一个标签页不得自动制造第二次 generation。

### 11.2 生成快照与幂等

开始生成时必须冻结不可变快照：

```ts
type ArenaMultiplayerGenerationSnapshot = {
  roomId: string;
  generationRequestId: string;
  configRevision: number;
  snapshotDigest: string;
  collaborativeInfluence: boolean;
  participantUserIds: number[];
  // online refs 均带 versionToken
  // 其余为既有 generation 输入快照/引用
};
```

`generationRequestId` 在一次用户开始意图内稳定。Room 至少维护：

```text
idle
  -> starting(requestId, revision, snapshotDigest)
  -> running(generationId)
  -> completed | failed | cancelled
```

浏览器重试、API 重试和 bridge 重试使用同一 idempotency key，不得产生第二次权威 generation。旧 attempt 的 completed/failed 不得覆盖当前 attempt。

生成中后续 Proposal 或房主修改只影响下一次生成。

`collaborativeInfluence=true` 只在至少一个非房主 Proposal 的 accepted change **确实进入本次 frozen snapshot** 时设置；历史上接受过但本次已被房主覆盖/移除的 change 不得误标。

### 11.3 房主本地 payload 与 Generation Plane

Room Shared Config 只提供 stub。

实际生成前由房主客户端将：

- frozen Shared Config / refs；
- generation 所需的房主本地完整卡；
- 既有 Hosted generation 若支持时所需的 provider/config credential；

组合成既有 Arena generation payload，并**直接发送给 generation service**。

边界：

- 完整 host-local payload、Provider/API credential 不进入 Room Worker/DO/D1/snapshot/member response；
- generation service 只按既有 generation 安全契约接收、脱敏和处理；
- Room 只接收结果的安全投影与 generation metadata；
- 多人服务不得持久化 API Key。

## 12. 战报与角色更新

### 12.1 沿用现有非持久语义

现有竞技场中：

- `updatedCombatants`
- `arena_history`
- `current_state`

均先作为竞技场页面内结果展示。
用户只有显式“保存到云端/替换已有/另存”等操作才进入云端数据卡持久层。

多人模式完全继承该语义，不创建自动写回数据卡机制。

### 12.2 房间展示

生成完成后，成员可查看：

- 战报；
- 判定结果；
- 更新后的角色历战；
- 当前状态；
- 适合共享的生成 metadata。

不得将房主本地角色完整 JSON 因结果广播而泄漏给成员；结果 DTO 需要单独做共享投影。

### 12.3 个人页战报

可选增强：

新增 `generation <-> participant` 关系，而不是复制战报。

只有生成开始时冻结的 participant snapshot 获得该 generation 的长期个人页关联。

后加入成员即使能临时查看房间最新战报，也不自动获得历史 generation 归属。

## 13. 排位语义

多人房间本身不自动污染 strict ranking。

- 仅观看、无第三方 Proposal 被接受：
  `collaborativeInfluence = false`
- 至少一项非房主 Proposal 的 accepted change 实际进入本次 frozen generation snapshot：
  `collaborativeInfluence = true`

建议：

> `collaborativeInfluence = true` 时禁止 strict ranked；是否允许 free ranking 由现有规则决定。

生成记录仅需长期保存轻量 provenance，例如：

```json
{
  "multiplayer": {
    "enabled": true,
    "participantCount": 3,
    "collaborativeInfluence": true,
    "acceptedProposalCount": 2
  }
}
```

不长期保存完整 Proposal 历史。

## 14. 实时架构

### 14.1 推荐：一房间一 Durable Object

以 `roomId` 作为协调原子：

`ArenaRoom Durable Object = one logical room`

职责：

- WebSocket membership / presence
- Room Shared Config
- revision
- Proposal
- host actions
- generation status mirror
- reconnect snapshot
- cleanup alarm

不使用全局单一 Durable Object。

### 14.2 Hibernation WebSocket

采用 Durable Objects Hibernation WebSocket API。

要求：

- 使用 `ctx.acceptWebSocket()` 风格的 hibernation API；
- 不使用会阻止 hibernation 的长期 `setInterval` / `setTimeout`；
- connection metadata 使用 WebSocket attachment；
- 高频 story delta 批量发送；
- 不实现应用层高频 ping/pong 唤醒 DO。

### 14.3 Sidecar Worker

独立 Worker 是 v1 已接受部署边界：

```text
existing Arena UI
  -> apps/web
  -> Service Binding / typed RPC
  -> apps/arena-room
       -> ArenaRoom DO

apps/api / Hono generation
  -> generation-scoped authenticated GenerationBridge
  -> apps/arena-room
       -> target ArenaRoom DO
```

理由：

- 不把 DO class 生命周期与 OpenNext 生成 worker 强耦合；
- room worker 可使用更现代 compatibility date；
- 可设置更紧 CPU / rate limit；
- 将实时协调与高 CPU AI generation 隔离；
- Hono 不是 Worker，不能把 Service Binding 当作其调用机制；
- 后续可复用于 PVP 的 transport/lifecycle 基础设施，但不复用 Arena 业务语义。

GenerationBridge 要求：

- 绑定 room + generation attempt + expiry；
- batch 带单调 `batchSeq` 并可幂等去重；
- 不按 token publish；
- bridge credential 不进入普通客户端；
- 首选 generation-scoped authenticated WebSocket publisher；若压测证明 batched HTTPS 更优，可替换 transport 但不能改变契约。

## 15. WebSocket 协议

所有消息使用版本化 envelope。控制事件与 story stream 使用不同 cursor，避免为了流式正文高频持久化全局 seq：

```ts
type RoomEventEnvelope<T> = {
  v: 1; // protocol version
  type: string;
  roomId: string;
  roomEpoch: string;
  ts: string;
  controlSeq?: number;
  generationId?: string;
  chunkSeq?: number;
  payload: T;
};
```

规则：

- `roomEpoch + controlSeq` 只用于 durable control state / bounded replay；
- `story.delta` 使用 `generationId + chunkSeq`；
- control seq 与对应 durable state write 一起提交；
- Hibernation 后不得从 0 重新开始一个无法区分的新 seq。

核心事件：

- `room.snapshot`
- `room.member.joined`
- `room.member.left`
- `room.host.offline`
- `room.host.online`
- `room.config.updated`
- `proposal.submitted`
- `proposal.updated`
- `proposal.resolved`
- `generation.started`
- `story.delta`
- `generation.completed`
- `generation.failed`
- `room.closing`

### 15.1 Reconnect

客户端记录最近 durable control cursor；生成中另记录当前 `generationId/chunkSeq`。

重连后：

- `roomEpoch` 相同且 DO 仍有足够 control event window：可 replay；
- epoch 不同或 replay window 不足：发送 `snapshot_required` / 直接返回最新 `room.snapshot`；
- story delta window 不足：进入 `generation.resync`，不为此逐 chunk 持久化；
- generation 完成后从 authoritative generation record / R2 获取完整最终结果。

Hibernation 会重建 DO instance，因此 constructor 必须从 durable state / WebSocket attachments 恢复必要信息。不要为完整实时历史建立无限事件日志。

## 16. 降耗与限流

### 16.1 不轮询

WebSocket 健康时：

- 不轮询房间状态；
- 不轮询在线人数；
- 不轮询 Proposal；
- 不轮询战报进度。

REST GET 仅用于初次加载、恢复或显式刷新。

### 16.2 本地编辑不联网

以下操作不应触发服务器请求：

- 输入角色引导；
- 输入全局引导；
- 选择/删除角色；
- 调整故事长度；
- 切换模式；
- 编辑 Proposal 复选框。

### 16.3 服务器限流

需要服务器端限制：

- create room
- search/list room
- join
- proposal submit/withdraw
- host proposal resolve
- host publish
- generation start
- kick/close

客户端 cooldown 仅为 UX，不能作为安全边界。

### 16.4 消息批量

AI 流式输出转发给房间时：

- 不按 token 调用 DO；
- 在主 Worker 侧或 room adapter 侧按约 50–100ms / 合理字节阈值批量；
- 单次广播一个 `story.delta` frame。

### 16.5 不做高频持久化

不持久化：

- typing；
- cursor/scroll；
- heartbeat；
- 每秒在线人数；
- 每条 token/chunk；
- 临时 UI 状态。

## 17. Redis-only Room directory 原则

Redis Room checkpoint 是活动 Room 的唯一 session authority。Room directory 使用同 Redis 故障域内的
TTL-bound record 与有界 public sorted-set index，只提供 discovery 候选。

因此：

- public listing 查询有硬 limit/cursor，返回前重验 current checkpoint open/deadline/epoch/host；
- join/ticket/membership 必须最终由 server authority + Redis checkpoint 验证；
- absent/expired/terminal/malformed checkpoint 不得被 stale directory member 复活；
- create/recovery/close 所需 directory mutation 与 checkpoint 在同一 Lua/CAS 边界内完成；
- lazy cleanup 使用 exact raw/CAS，不得误删并发 replacement；
- presence、heartbeat、story chunk 不写 directory；
- Arena v1 不发布 `arena_multiplayer_rooms` 或任何 D1 Room directory migration。

个人页若启用多人战报：

```sql
battle_report_generation_participants (
  generation_id,
  user_id,
  room_id,
  role,
  created_at
)
```

应有：

- `(user_id, created_at)` 索引；
- `(generation_id, user_id)` 唯一约束。

## 18. Durable Object 存储与清理

Room local persistence 只保存跨 hibernation 必须恢复的状态：

- room metadata / terminal state
- member identities/roles（presence 以 WebSocket connection/attachment 恢复）
- shared config
- current revision
- unresolved Proposal + typed precondition
- `roomEpoch` / durable control cursor
- generation request idempotency / current attempt / mirror state
- host-offline / room-idle 等逻辑 deadlines

销毁必须使用完整清理流程：

1. 将 durable room state 标记为 closing/terminal，阻止新的 join/publish；
2. 广播 `room.closing`；
3. 在 terminal checkpoint commit 的同一 Redis 原子边界删除 directory record/index；
4. `ctx.storage.deleteAll()` 彻底清空 room storage。

对于 compatibility date >= 2026-02-24 的 SQLite-backed Durable Object，`deleteAll()` 同时删除 active alarm。

销毁后的“缺少 room metadata”必须解释为 **room 不存在**。join/reconnect 路径不得在发现空 storage 时自动初始化房间；只有经过授权的 create-room 流程才能创建新房间，因此 stale Redis directory member 不能把已销毁 room 复活。

销毁流程必须幂等；directory cleanup 不得绕过 checkpoint exact authority fence。

## 19. 房间发现

v1 可支持：

- public：可搜索；
- unlisted：凭 room id / invite link 加入。

密码房间可复用现有 PVP 的思路，但不是多人竞技场 v1 的阻断项；若实现会显著增加首期范围，可延后。

搜索页/Modal 不显示高频精确在线人数；可使用粗粒度或实时连接后再显示。

## 20. 安全要求

- 仅注册用户。
- 生产连接使用 HTTPS/WSS；WebSocket upgrade 前完成身份验证。
- 浏览器 handshake 严格验证显式 `Origin` allowlist；不使用 wildcard/substring 匹配。
- Desktop/Mobile 等非浏览器客户端不能把 `Origin` 当信任根，统一依赖短期签名 room ticket、membership 与 message-level authorization。
- room ticket 应短期有效、绑定 `roomId/userId/capability-or-role-hint/exp/protocolVersion/jti-or-equivalent`。
- ticket 中的 role hint 不能覆盖 DO 当前 membership；kick 后旧 ticket 重连仍必须失败。
- 对外 `roomId` 为服务端生成的高熵 opaque id；不直接暴露 DO internal id。
- 不在每条 WS message 上查询 D1 验证用户；权限由 DO room state 校验。
- 在创建/解析 DO id 前尽可能完成鉴权和 room id 基本验证，避免对象 spray。
- 所有 WebSocket message / Proposal 需要服务端 schema validation、capability check、message byte limit 和 rate limit。
- Guidance 长度、Proposal change 数、Proposal 总字节数必须有限制。
- slow consumer / outbound backlog 必须有界；可丢弃可恢复的临时 story delta，不得无限缓存。
- participant guidance 按不可信用户内容处理，不得提升为 system authority。
- 本地 host-only 内容不得出现在 Room 日志、room snapshot 或普通成员响应中。
- API credential 不得进入 DO/D1/R2/Room 日志；GenerationBridge credential 不得进入普通客户端。

## 21. UI/UX

现有 `/arena` 页面保持单一路由。

建议新增：

### 21.1 多人入口 / 状态条

未加入：

`[多人模式]`

已加入：

`房间 ABCD | 房主 Alice | N 人 | [同步配置] [提案] [成员] [退出]`

房主：

`我的房间 ABCD | N 人 | [更新房间配置] [待处理提案] [房间管理]`

### 21.2 提交 Proposal Modal

显示：

- baseline revision
- 自动检测的修改项
- 原值 -> 新值
- 默认勾选新修改项
- 依赖项
- 冲突/不可提交原因
- 最终提交项计数

### 21.3 房主 Proposal Review Modal

支持：

- 按 Proposal / 用户查看
- 逐项勾选
- 冲突提示
- 依赖/原子组联动
- 接受所选 / 拒绝

### 21.4 Config stale 提示

收到 `room.config.updated` 时：

- 不自动覆盖有本地修改的 working copy；
- 显示“房间配置已更新至 rN”；
- 用户可选择重新同步；
- 提交旧 baseline Proposal 时仍允许服务端做冲突判断。

## 22. 初始保护性上限

多人 v1 不应继承无限制角色数量。

建议做成配置常量并通过实际使用调整：

- room members：建议 8 或较小值起步；
- combatants：建议 10 起步；
- pending proposals / member：建议 5–10；
- proposal changes：建议 20–50；
- proposal payload：严格字节上限；
- WebSocket 普通 control message：必须有字节上限（可从 64 KiB 级保护值开始，再按实测调低/拆包）；
- story publisher batch：独立字节/频率上限；
- per-user/per-connection message rate 与 outbound backlog：必须有界；
- guidance：沿用现有角色引导 100 字语义或统一重新冻结；
- room title / metadata：严格长度上限。

不要把上限分散硬编码到 UI 与 API，应共享 schema/constant；安全上限由服务端强制，客户端只做 UX 预检。

## 23. 关键不变量

1. 只有房主能改变 Room Shared Config。
2. 普通成员只能通过 Proposal 影响共享配置。
3. 普通成员不能上传或提交本地 payload。
4. 完整 host-local payload 不进入 Room plane；权威生成确有需要时只直送 generation service。
5. API Key/credential 永不进入共享配置/Room storage/Room broadcast。
6. 一次 generation intent 只有一个稳定 `generationRequestId`，权威 AI 只执行一次。
7. 生成快照创建后不可被后续 Proposal 修改。
8. browser/socket disconnect 不等于 membership leave，也不是 AI stream 中继失败条件。
9. host explicit leave/close 关闭房间；单连接关闭不得模拟该命令。
10. 房间销毁清理临时 Proposal/revision/runtime storage。
11. 战报与角色更新沿用现有竞技场非持久语义，final result 以既有 generation storage 为权威。
12. Redis directory 不承担 presence 或高频 story state，且不是单房间 lifecycle 真相源。
13. WebSocket 健康时不得退化为固定频率轮询。
14. accepted third-party change 只有实际进入 frozen snapshot 时才影响 `collaborativeInfluence`/provenance。
15. stale Proposal 正确性不依赖保存无限历史，change 自带 typed BASE precondition。
16. online DataCard ref 在 Room 中版本化，不静默漂移。
17. Hibernation reconnect 不依赖纯内存全局 seq。
18. 多个逻辑 deadline 共享一个物理 DO alarm scheduler。
19. `apps/web`、`apps/arena-room`、`apps/api` 的独立部署必须遵循版本化 wire contract。

## 24. 测试与验收

### 数据边界

- Room DTO 不包含 provider credential。
- host-local full payload 无法从 member snapshot 获取。
- member 无法通过 Proposal 注入本地 JSON。
- 私有线上卡无权限时提案失败。

### Proposal

- 自动 diff 只勾选真正修改项。
- 部分接受正确。
- dependsOn / atomicGroup 正确。
- change 缺少/伪造 expectedBase 时失败。
- stale baseline 能用 typed precondition 检测同字段冲突。
- 无冲突旧 Proposal 可安全接受。
- online ref versionToken 变化时显式 stale/reference-changed。

### Lifecycle

- refresh / socket reconnect 不删除房间。
- 同一 user 多标签页只算一个 membership，多 connection presence 可恢复。
- member leave 正确。
- host explicit leave/close 关闭房间；单 tab/socket close 不关闭。
- kick 后旧 ticket 重连失败。
- last member 清理 room。
- 一个 alarm scheduler 可同时正确处理 host-offline 与 room-idle deadline。
- alarm retry / cleanup 可重复执行。
- stale Redis directory member 不会复活 absent/closed checkpoint。

### Generation

- 所有成员只对应一个 generationId。
- 同一 generationRequestId 多次提交仍只有一次 AI。
- generation snapshot 不受生成中的 config change 影响。
- host refresh / room socket reconnect 不成为生成中继故障。
- GenerationBridge 重复 batch 可去重，旧 attempt terminal event 不覆盖当前 attempt。
- host-local payload 不进入 Room/broadcast。
- story delta gap 可降级 resync，final report 仍可从权威存储恢复。
- 战报与更新角色结果可由成员查看。

### Cost

- idle room 无固定轮询。
- idle WebSocket 可 hibernate。
- story delta 不按 token 调用 DO。
- presence 不写 directory。
- Proposal 不产生逐键写入。
- room directory 查询使用索引。
- 删除房间后 DO storage 为空。

## 25. 参考设计原则

本设计遵循以下原则：

> Redis checkpoint 管活动 Room session authority；Redis directory 只管 discovery 候选；WebSocket 管实时事件；D1/R2/既有 generation 存储管持久业务事实；AI 永远只生成一次；普通成员永远只订阅同一结果。

外部设计依据：

- Cloudflare Durable Objects Rules：按 chat room / game session 这类 coordination atom 建一房间一对象。
  https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Cloudflare Hibernation WebSocket：idle 时允许对象休眠；hibernation 后内存会重建，应通过 storage/attachment 恢复。
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare WebSocket batching：高频逻辑消息应按时间/数量/字节批量，减少 runtime context switch。
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Service Bindings：Worker-to-Worker 优先 RPC，独立部署时遵循被调用方先兼容扩展、调用方再切换。
  https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- Cloudflare Durable Object Alarms：每个 DO 同时一个 alarm，多个逻辑事件应由 durable scheduler 管理；执行为 at-least-once。
  https://developers.cloudflare.com/durable-objects/api/alarms/
- Cloudflare SQLite-backed DO storage：`deleteAll()` 原子清空 SQLite-backed storage；compatibility date >= 2026-02-24 时同时删除 alarm。
  https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare gradual deployments：独立 Worker 会产生 version skew，wire contract 必须考虑 old/new peer。
  https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/
- RFC 6455：浏览器 Origin 模型、非浏览器 Origin 不可作为信任根、WebSocket close semantics。
  https://www.rfc-editor.org/rfc/rfc6455
- OWASP WebSocket Security：Origin allowlist、message authorization、size/rate limits、replay 与 backpressure。
  https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- Cloudflare D1：按 rows read/write 计量，索引可减少扫描行数，应避免高频轮询与大范围扫描。

## 26. 后续可选演进

仅在 v1 有真实需求后评估：

- 房主转移；
- spectator/member 更细角色；
- 房间密码；
- 私有线上卡临时共享；
- 投票；
- reaction；
- 聊天；
- 大房间分片；
- PVP 复用同一实时 Room 基础设施；
- PartyServer/PartySocket 作为实现辅助；
- 极大规模 pub/sub。

以上均不得成为 v1 上线阻断项。
