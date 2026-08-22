# 竞技场多人协作模式 v1 规格

## 1. 文档信息

- 状态：Draft / 设计基线
- 编写时间：2026-08-21
- 适用项目：MahoShojo Generator
- 目标功能：竞技场多人观看、配置同步与提案协作
- 目标平台：Cloudflare Workers + Durable Objects + D1 + R2
- 核心原则：尽量复用现有竞技场页面、组件、生成链路与非持久角色更新语义

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

线上对象 Proposal 应保存稳定引用，而非复制完整 JSON：

```ts
type DataCardRef = {
  id: string;
  updatedAt?: string;
  kind: 'character' | 'scenario' | 'material';
};
```

接受和生成前服务端/房主端应重新验证引用仍可读取且类型有效。

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

### 7.2 三方冲突判断

房主审阅旧 Proposal 时，以：

- BASE：提案创建时的 baseline；
- CURRENT：当前房间权威配置；
- PROPOSED：提案目标值；

进行轻量三方比较。

若 CURRENT 在同一语义字段上已偏离 BASE，则标记冲突，由房主决定是否接受。

不使用 CRDT。

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

- 删除 D1 directory entry；
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

## 11. 生成模型

### 11.1 只生成一次

多人模式不得为每个观看者调用 AI。

推荐：

```text
Host Arena UI
  -> existing arena generate/generate-stream
  -> one generation
  -> existing generation persistence / R2
  -> room broadcast
  -> all members render same result
```

### 11.2 生成快照

开始生成时必须冻结不可变快照：

```ts
type ArenaMultiplayerGenerationSnapshot = {
  roomId: string;
  configRevision: number;
  collaborativeInfluence: boolean;
  participantUserIds: number[];
  // 其余为既有 generation 输入快照/引用
};
```

生成中后续 Proposal 或房主修改只影响下一次生成。

### 11.3 房主本地 payload

Room Shared Config 只提供 stub。

实际生成前由房主浏览器将：

- Shared Config；
- 房主本地完整卡；
- 房主 provider/config credential；

组合成既有 Arena generation payload。

多人服务不得持久化 API Key。

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
- 至少一项非房主 Proposal 被接受并进入生成：
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

推荐独立 Worker：

```text
mahoshojo-next
  Next/Auth/Arena Generation/D1/R2/AI
        |
        | Service Binding / internal RPC
        v
mahoshojo-room
  WebSocket gateway
  ArenaRoom Durable Object
```

理由：

- 不把 DO class 生命周期与 OpenNext 生成 worker 强耦合；
- room worker 可使用更现代 compatibility date；
- 可设置更紧 CPU / rate limit；
- 将实时协调与高 CPU AI generation 隔离；
- 后续可复用于 PVP 实时传输改造。

## 15. WebSocket 协议

所有消息使用版本化 envelope：

```ts
type RoomEventEnvelope<T> = {
  v: 1;
  type: string;
  roomId: string;
  seq: number;
  ts: string;
  payload: T;
};
```

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

客户端记录最后 `seq`。

重连后：

- 若 DO 仍有足够事件窗口，可 replay；
- 否则发送 `snapshot_required` / 直接返回最新 `room.snapshot`。

不要为完整实时历史建立无限事件日志。

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

## 17. D1 使用原则

D1 仅保存低频、跨对象查询所需事实。

建议最小 directory：

```sql
arena_multiplayer_rooms (
  id,
  host_user_id,
  title,
  visibility,
  status,
  created_at,
  last_activity_at
)
```

索引应服务实际查询路径，例如：

- `status, last_activity_at`
- `host_user_id, status`

不要通过 D1 持久化 presence。

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

- room metadata
- member identities/roles（非实时在线标志）
- shared config
- current revision
- unresolved Proposal
- 必要的 generation mirror state
- cleanup alarm timestamp

销毁必须使用完整清理流程。

对于 compatibility date >= 2026-02-24 的 SQLite-backed Durable Object：

`ctx.storage.deleteAll()`

用于彻底清空 storage；销毁流程必须幂等。

## 19. 房间发现

v1 可支持：

- public：可搜索；
- unlisted：凭 room id / invite link 加入。

密码房间可复用现有 PVP 的思路，但不是多人竞技场 v1 的阻断项；若实现会显著增加首期范围，可延后。

搜索页/Modal 不显示高频精确在线人数；可使用粗粒度或实时连接后再显示。

## 20. 安全要求

- 仅注册用户。
- WebSocket upgrade 前完成身份验证。
- 验证 `Origin`。
- room ticket 应短期有效、绑定 `roomId/userId/role/exp`。
- 不在每条 WS message 上查询 D1 验证用户。
- 在创建/解析 DO id 前尽可能完成鉴权和 room id 基本验证，避免对象 spray。
- 所有 Proposal 需要服务端 schema validation。
- Guidance 长度、Proposal change 数、Proposal 总字节数必须有限制。
- participant guidance 按不可信用户内容处理，不得提升为 system authority。
- 本地 host-only 内容不得出现在日志、room snapshot 或普通成员响应中。
- API credential 不得进入 DO/D1/R2/日志。

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
- guidance：沿用现有角色引导 100 字语义或统一重新冻结；
- room title / metadata：严格长度上限。

不要把上限分散硬编码到 UI 与 API，应共享 schema/constant。

## 23. 关键不变量

1. 只有房主能改变 Room Shared Config。
2. 普通成员只能通过 Proposal 影响共享配置。
3. 普通成员不能上传或提交本地 payload。
4. 房主本地 payload 不离开房主生成链路。
5. API Key/credential 永不进入共享配置。
6. 一次房间生成只调用一次 AI。
7. 生成快照创建后不可被后续 Proposal 修改。
8. socket disconnect 不等于 membership leave。
9. host explicit leave 关闭房间。
10. 房间销毁清理临时 Proposal/revision/runtime storage。
11. 战报与角色更新沿用现有竞技场非持久语义。
12. D1 不承担实时 presence 或高频 room state。
13. WebSocket 健康时不得退化为固定频率轮询。
14. accepted third-party Proposal 必须在 generation provenance 中可识别。

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
- stale baseline 能检测同字段冲突。
- 无冲突旧 Proposal 可安全接受。

### Lifecycle

- refresh / socket reconnect 不删除房间。
- member leave 正确。
- host leave 关闭房间。
- last member 清理 room。
- alarm 可回收 abandoned room。
- cleanup 可重复执行。

### Generation

- 所有成员只对应一个 generationId。
- 成员不会触发重复 AI 生成。
- generation snapshot 不受生成中的 config change 影响。
- host-local payload 不广播。
- 战报与更新角色结果可由成员查看。

### Cost

- idle room 无固定轮询。
- idle WebSocket 可 hibernate。
- story delta 不按 token 调用 DO。
- presence 不写 D1。
- Proposal 不产生逐键写入。
- room directory 查询使用索引。
- 删除房间后 DO storage 为空。

## 25. 参考设计原则

本设计遵循以下原则：

> D1 管跨房间长期事实；Durable Object 管单房间协调事实；WebSocket 管实时事件；R2/既有 generation 存储管最终战报；AI 永远只生成一次；普通成员永远只订阅同一结果。

外部设计依据：

- Cloudflare Durable Objects：以 chat room / game session 作为 coordination atom。
- Cloudflare Durable Objects Hibernation WebSocket：空闲时允许对象休眠，避免保持连接导致持续 duration。
- Cloudflare WebSocket best practices：高频消息应批量发送，减少 context switch。
- Cloudflare Durable Object Storage：需要彻底销毁时使用 `deleteAll()`。
- Cloudflare Durable Object Alarms：用于 room-local TTL 清理。
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
