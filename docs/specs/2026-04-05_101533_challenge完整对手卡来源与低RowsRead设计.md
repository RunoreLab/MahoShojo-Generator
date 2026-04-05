# /challenge 完整对手卡来源与低 Rows Read 设计

## 背景

当前 `/challenge` 的竞技场对手候选链路已经接入 live 排行榜，但其远程候选的语义仍然是：

1. 先从排行榜拿到实体引用。
2. 再尝试按 `entityId` 补查公开数据卡或预设原卡。
3. 如果补查失败，则把该实体降级为 `season-entity` 快照继续参与候选。

这套设计解决了“挑战流程不能被展示层阻塞”的问题，但也引入了新的体验问题：

1. 远程候选并不保证能展示完整角色卡。
2. 用户偶尔会在 `/challenge` 中看到“挑战快照卡”，而不是完整原卡。
3. `season-entity` 从兜底路径逐渐变成了远程候选的常态化产物。

同时，本项目对排行榜、公开卡读取和 D1 Rows Read 已经有明确的性能边界：

1. `/api/arena/leaderboard` 已经限制为有限窗口读取，并通过 `withEdgeCache` 做短 TTL 缓存。
2. 排行榜 live 数据只包含当前可上榜的公开、已审核、未删除角色卡与预设。
3. `/ranking` 页客户端本地缓存仅保存轻量 rank cache，不保存完整榜单，更不保存完整角色卡 payload。

本次设计目标是在保留“失败时仍可降级”的前提下，把 `/challenge` 的远程对手来源升级为“默认几乎总能拿到完整卡”的模式，同时避免把问题转化为新的高 Rows Read 热点。

## 目标

1. `/challenge` 的 remote 对手候选默认优先保证“可补齐完整原卡”。
2. `season-entity` 不再作为 remote 路径的常态化产物，而退回为历史兼容或极少数异常场景的残留类型。
3. 失败策略采用“最佳努力 + 明确兜底”，即：
   - 优先尽量补齐完整卡；
   - 少量失败允许整体回退到 `preset-only`；
   - 不要求绝对 100%。
4. 不依赖 `/ranking` 页本地缓存或用户是否访问过 `/ranking`。
5. 明确控制 leaderboard 读取窗口、公开卡补查数量和重试次数，避免扫太多行甚至扫全表。
6. 保持 challenge 现有节点结算与展示链路兼容，不要求在本轮重构中同时改动 challenge 存档结构。

## 非目标

1. 本次不把完整敌方原卡写入 `runState`、`encounterSnapshot` 或本地挑战存档。
2. 本次不把 `/ranking` 的本地 rank cache 扩展成完整卡缓存仓库。
3. 本次不新增“历史赛季敌人详情快照持久化”能力。
4. 本次不移除 `preset-only` 兜底模式。
5. 本次不要求彻底删除 `season-entity` 类型定义；只要求其不再作为 live remote 候选的常规输出。

## 现状调研结论

## 1. `/ranking` 本地缓存不是完整候选源

当前 `lib/arena/rank-cache.ts` 持久化到 `localStorage` 的内容只有：

1. `rank`
2. `rating`
3. `games`
4. `tier`
5. `updatedAtMs`
6. `source`

它的职责是“轻量名次/分数缓存”，而不是：

1. 当前完整排行榜快照
2. 当前完整公开卡列表
3. 当前角色卡 payload 缓存

因此“优先从 `/ranking` 本地持久化排行榜数据中直接取完整公开角色卡”在当前代码结构下并不成立。即使用户刚访问过 `/ranking`，challenge 仍然拿不到完整卡 payload。

## 2. `/ranking` 详情本身也依赖当前公开卡读取

排行榜详情弹窗读取数据卡时，仍然是按 `entityId` 调用 `/api/public-data-cards?id=...` 去获取当前公开卡内容，而不是读取本地榜单快照。历史赛季视图中，页面也明确提示：

1. 详情读取的是当前公开卡内容；
2. 可能与历史快照不一致；
3. 可能因下架、转私有或删除而无法加载。

这进一步说明 `/ranking` 页面不是可靠的完整卡来源真相，更不适合作为 challenge 对手来源主链路。

## 3. live 排行榜实体本身具备“当前可读”前提

`/api/arena/leaderboard` 对 `data_card` 的 live 排行榜实体已经有严格筛选：

1. `type='character'`
2. `is_public=1`
3. `review_status='approved'`
4. `deleted_at IS NULL`
5. strict 队列额外要求满足公开时间约束

这意味着 live 排行榜中的 `data_card` 在服务端语义上应当属于“当前可读公开卡”。更准确地说，这是一个单向保证：

1. 若某张卡能进入 strict/live leaderboard，则它应当能被当前公开单卡读取接口读取；
2. 但公开单卡读取接口的条件并不与 strict leaderboard 完全同构，因为 strict leaderboard 还额外受 `public_since` 规则约束。

因此，真正的问题不是“排行榜实体不可靠”，而是 challenge 当前 remote 候选链路对补卡失败过于宽松，导致：

1. 单个实体补卡失败时仍然保留其榜单资格；
2. 最终 remote 候选池里混入了不能展示完整卡的 `season-entity`。

## 4. 现有单卡补查方式存在读放大风险

当前 challenge 若继续沿用“拿到一个排行榜实体就发一次 `/api/public-data-cards?id=...`”的串行单卡补查方式，那么为了把失败率压低到几乎不出现，通常需要：

1. 扩大 leaderboard 读取窗口；
2. 对更多实体做完整卡验证；
3. 对瞬时失败做小次数重试。

如果仍按单卡 API 一张一张查，就很容易把一次 challenge 对手选择放大成：

1. 1 次 leaderboard 查询
2. N 次单卡公开卡查询

当 `N` 接近 18 到 24 时，虽然没有全表扫描，但请求数仍然偏高，不适合作为长期稳定方案。

## 设计原则

1. 来源真相在服务端，不在 `/ranking` 页面本地缓存。
2. remote 候选必须先通过“完整卡可读 + 可渲染校验”，再进入候选池。
3. 错误处理优先“跳过失败实体，继续扫描有限窗口”，而不是对同一坏 ID 机械重试。
4. leaderboard 读取窗口、补卡数量、重试次数都必须有硬上限。
5. 当 remote 候选无法凑齐时，整体回退 `preset-only`，而不是继续输出大量 `season-entity`。
6. 任何优化都不能引入新的全榜扫描、模糊搜索扫表或按 challenge 热路径重复做复杂 JOIN。

## 方案比较

## 方案 A：依赖 `/ranking` 本地缓存作为主来源

### 做法

1. challenge 先读取浏览器中 `/ranking` 的本地持久化排行榜数据。
2. 如果本地没有，再去拉 live 排行榜。

### 优点

1. 用户若刚访问过 `/ranking`，理论上可以少一次网络请求。

### 问题

1. 当前本地缓存不含完整卡 payload。
2. 会把 challenge 稳定性绑定到“用户是否访问过 `/ranking`”这一偶然前置条件。
3. 需要重新设计 `/ranking` 本地缓存的数据结构，复杂度高且边界不自然。

### 结论

不采用。

## 方案 B：challenge 直接走 live 排行榜，并在服务端完成完整卡验证

### 做法

1. challenge 服务端直接读取 live `/api/arena/leaderboard` 对应分段的实体窗口。
2. 仅将“成功补齐完整卡且通过可渲染校验”的实体纳入 remote 候选池。
3. 若窗口内无法凑齐目标数量，则进行有限扩窗。
4. 最终仍凑不齐时，整体降级为 `preset-only`。

### 优点

1. 不依赖 `/ranking` 页面访问历史。
2. 远程候选的“完整卡可展示”语义明确。
3. 可以把 Rows Read 预算集中控制在服务端。

### 问题

1. 需要新增批量公开卡读取或内部 helper，避免单卡补查次数过多。
2. 需要明确“最终选敌”是在客户端还是服务端完成，并据此定义 sidecar 契约。

### 结论

推荐采用。

## 方案 C：单独维护 challenge 可用敌人池缓存

### 做法

1. 预热一批已验证完整可读的公开角色卡。
2. challenge 直接从缓存池中抽取候选。

### 优点

1. 运行期稳定性最高。

### 问题

1. 需要额外缓存失效、预热、更新策略。
2. 对当前问题而言复杂度偏高。

### 结论

暂不采用，保留为后续增强项。

## 推荐方案

本次采用方案 B：`/challenge` 远程候选由 challenge 服务端直接基于 live 排行榜构建，并且只有“已验证可补齐完整卡”的实体才允许进入 remote 候选池。

## 接口契约选择

本次明确采用：

1. challenge 节点主链路改为服务端选敌
2. 复用现有 `/api/challenge/enemy-candidates`，但扩展其契约

### 选择原因

如果继续维持“客户端在拿到 `candidates[]` 后自行选敌”的现状，那么服务端若想把已验证成功的完整卡 sidecar 一并返回，就必须：

1. 为整组候选返回 `resolvedSourceCardByIndex`
2. 传输多张完整卡 payload
3. 再由客户端在本地按 `selectionSeed` 选出其中一张

这会带来两个问题：

1. payload 明显膨胀
2. sidecar 与最终选中敌人的映射关系更复杂

因此更合理的方式是：

1. 客户端继续生成与当前逻辑一致的 `selectionSeed`
2. `/api/challenge/enemy-candidates` 在接收到 `selectionSeed` 时，服务端完成候选验证与最终选敌
3. 服务端直接返回：
   - `enemySnapshot`
   - `resolvedSourceMode`
   - `resolvedSourceCardLite`

### 兼容策略

1. 若未传 `selectionSeed`，接口仍可保留当前“返回 `candidates[]`”的兼容模式，供测试或诊断使用。
2. challenge 真实节点进入主链路统一改为传入 `selectionSeed`，不再由客户端在候选返回后自行选敌。
3. `selectionSeed` 的生成规则保持与当前一致，仍由 `runSeed + nodeId + nodeType` 推导，以保证：
   - 同一已验证候选集合内的稳定选样
   - 与旧逻辑的 seed 口径兼容
   - 与旧逻辑的随机分布口径一致
4. “恢复运行时确定性”不由 `selectionSeed` 单独承诺，具体边界见后文“确定性边界”。

### API 契约

`GET /api/challenge/enemy-candidates`

#### Query Params

1. `worldId`
   - 必填
   - 当前仅允许 `arena`
2. `tier`
   - 必填
   - `common | elite | boss`
3. `sourceMode`
   - 选填
   - `online-first | preset-only`
4. `runSeed`
   - 选填
   - 字符串
5. `limit`
   - 选填
   - 候选目标数量，默认 `6`
6. `selectionSeed`
   - 选填
   - 存在时进入“服务端选敌模式”

#### 200 响应互斥规则

无论哪种成功模式，`200` 响应都必须包含：

1. `success: true`
2. `worldId`
3. `tier`
4. `resolvedSourceMode`

并且必须满足以下互斥约束：

1. **兼容候选模式**
   - 触发条件：未传 `selectionSeed`
   - 必须返回 `candidates`
   - 必须**省略** `enemySnapshot`
   - 必须**省略** `resolvedSourceCardLite`
2. **服务端选敌模式**
   - 触发条件：传入 `selectionSeed`
   - 必须返回 `enemySnapshot`
   - 必须**省略** `candidates`
   - 必须返回 `resolvedSourceCardLite`
   - `resolvedSourceCardLite` 只能是对象或 `null`
3. “正常降级到 `preset-only`”不属于错误响应：
   - 仍然返回 `200`
   - 仍然遵守当前模式的字段互斥规则
   - 仅通过 `resolvedSourceMode='preset-only'` 和 payload 内容体现降级结果

#### Response：兼容候选模式

触发条件：未传 `selectionSeed`

```json
{
  "success": true,
  "worldId": "arena",
  "tier": "elite",
  "resolvedSourceMode": "remote",
  "candidates": [
    {
      "version": 1,
      "sourceType": "public-card",
      "sourceId": "card-1",
      "displayName": "雪绒",
      "strengthTier": "elite",
      "combatProfile": {},
      "tags": ["elite"],
      "promptSummary": "..."
    }
  ]
}
```

约束：

1. 该模式下只返回 `candidates`
2. 不返回 `enemySnapshot`
3. 不返回 `resolvedSourceCardLite`

#### Response：服务端选敌模式

触发条件：传入 `selectionSeed`

```json
{
  "success": true,
  "worldId": "arena",
  "tier": "elite",
  "resolvedSourceMode": "remote",
  "enemySnapshot": {
    "version": 1,
    "sourceType": "public-card",
    "sourceId": "card-1",
    "displayName": "雪绒",
    "strengthTier": "elite",
    "combatProfile": {},
    "tags": ["elite"],
    "promptSummary": "..."
  },
  "resolvedSourceCardLite": {
    "id": "card-1",
    "name": "雪绒",
    "data": "{...}",
    "updatedAt": "2026-04-05T10:00:00.000Z"
  }
}
```

约束：

1. 该模式下只返回 `enemySnapshot`
2. 不返回 `candidates`
3. 该模式下必须返回 `resolvedSourceCardLite`
4. 若最终选中的敌人来源为 `public-card`，则 `resolvedSourceCardLite` 必须为非空对象，且其 `id` 必须等于 `enemySnapshot.sourceId`
5. 若最终来源为 `preset`，则 `resolvedSourceCardLite` 必须为 `null`
6. 若 remote 模式下最终选中的是 `public-card`，但 sidecar 无法构造，则本次 remote 结果应视为无效，继续补位或整体降级，而不是返回 `public-card + null sidecar`
7. 即使 remote 不足阈值而整体降级为 `preset-only`，服务端选敌模式仍返回：
   - `enemySnapshot`
   - `resolvedSourceMode='preset-only'`
   - `resolvedSourceCardLite = null`

#### Response：服务端选敌模式降级示例

```json
{
  "success": true,
  "worldId": "arena",
  "tier": "elite",
  "resolvedSourceMode": "preset-only",
  "enemySnapshot": {
    "version": 1,
    "sourceType": "preset",
    "sourceId": "M01_centaurea.json",
    "displayName": "矢车菊",
    "strengthTier": "elite",
    "combatProfile": {},
    "tags": ["elite"],
    "promptSummary": "..."
  },
  "resolvedSourceCardLite": null
}
```

#### 错误响应

1. `400`
   - 参数非法，如 `worldId` 或 `tier` 不合法
2. `405`
   - Method not allowed
3. `500`
   - 非预期服务端错误

正常降级到 `preset-only` 不视为错误，仍返回 `200`。

错误响应统一为：

```json
{
  "success": false,
  "error": "..."
}
```

### 确定性边界

`selectionSeed` 保证的是：

1. 对同一批已验证候选集合的稳定取样

它**不单独保证**：

1. 跨时间重新请求 live leaderboard 时仍得到完全相同的候选集合

因此本次明确：

1. 真正的恢复确定性来自“服务端选中的 `enemySnapshot` 在进入节点时被写入 `encounterSnapshot` / node record / checkpoint”
2. 一旦该 snapshot 已持久化，后续恢复不再重新依赖 live leaderboard
3. 若请求发生在持久化之前且 live 候选集合已漂移，则允许最终敌人变化
4. challenge controller / node 进入逻辑必须把“请求选敌 -> 写入节点快照”视为一个紧邻操作，不得把重复请求 live 选敌当作恢复确定性的手段
5. 换言之，`selectionSeed` 负责“同一候选集合内稳定选样”，而“跨恢复周期稳定复现”只由已持久化的 `enemySnapshot` 负责

## 远程候选构建流程

### 1. leaderboard 窗口读取

challenge 服务端仍以 live leaderboard 作为 remote 候选起点，但必须遵守固定窗口策略。

#### 输入

1. `worldId=arena`
2. `tier=common|elite|boss`
3. `sourceMode=online-first`
4. `runSeed`
5. `limit`，默认目标候选数仍为 `6`

#### 筛选规则

继续复用当前 live leaderboard 的现有分段过滤：

1. `common`
   - `minGames=5`
   - `minRating=900`
   - `maxRating=1199`
2. `elite`
   - `minGames=5`
   - `minRating=1200`
   - `maxRating=1499`
3. `boss`
   - `minGames=5`
   - `minRating=1500`

#### 读取窗口上限

为控制 Rows Read，leaderboard 读取窗口采用“两段有限扩窗”：

1. 第一窗口：`windowLimit = min(max(limit * 3, 12), 18)`
2. 第二窗口：仅当第一窗口验证后的有效候选仍不足 `limit` 时才触发
   - `windowLimit = min(max(limit * 2, 6), 12)`
   - `offset = firstWindowLimit`
3. 总 leaderboard 扫描上限：
   - `18 + 12 = 30`
   - 不允许继续第三次扩窗

这样可以把单次 challenge 的 live 榜单实体扫描限制在一个稳定、可估算的范围内。

## 2. 候选验证语义

从 live leaderboard 读到的每个实体分两类处理：

### `preset`

1. 直接读取 bundled preset 原卡。
2. 若预设存在，则视为完整卡验证成功。
3. 若预设不存在，则跳过当前实体。

### `data_card`

1. 不能再沿用“单个实体失败就降成 `season-entity`”的逻辑。
2. 必须先通过“完整公开卡可读 + 可渲染”校验，验证成功后才能进入 remote 候选池。
3. 校验成功后产出 `sourceType='public-card'` 的标准敌人 snapshot。
4. 校验失败则跳过当前实体，而不是回退为 `season-entity`。

### 可渲染校验标准

本次明确 remote 入池标准不是“只要能读到 `data_cards.data` 就算成功”，而是：

1. 能读取到公开卡 payload；
2. 能完成当前 challenge 展示层所需的模板识别；
3. 若识别为某个具体模板，则必须满足该模板的最小可渲染字段要求；
4. 若模板不可识别，则只有在允许安全落到可接受的通用模板时，才可视为成功；
5. 否则视为验证失败并跳过。

这样设计的目标是让“remote 候选默认几乎总能展示完整角色卡”这句话有明确的实现标准，而不是停留在“能读到卡但仍可能展示失败”。

### 单一真相函数

服务端与客户端不得各自维护一套不同的“可渲染”标准。本次要求抽出共享纯函数模块，例如 `lib/challenge/source-card-renderability.ts`，并把现有展示层中的模板识别/可渲染判断迁入该模块。建议暴露：

1. `inferChallengeRenderableTemplate(cardPayload)`
2. `isChallengeRenderableSourceCard(cardPayload)`

其判定规则必须与 challenge 展示层保持一致，并由服务端候选入池校验与客户端展示层共同复用。

至少需要覆盖：

1. `magical-girl`
   - 必需字段：
     - `codename`
     - `appearance`
     - `magicConstruct`
     - `wonderlandRule`
     - `blooming`
     - `analysis`
2. `canshou`
   - 以现有展示组件的最小可渲染要求为准
3. `general`
   - 以现有展示组件的最小可渲染要求为准

必须满足：

1. 服务端 remote 入池校验只能调用这组共享函数
2. 客户端 `resolveChallengeEnemyDisplay` 只能调用这组共享函数
3. 不允许继续保留一份 challenge server 专用判断和一份 challenge display 专用判断长期并存

如果未来展示层规则变化，服务端校验规则也必须同步复用同一函数，避免出现“服务端入池成功、客户端仍 fallback”的标准漂移。

## 3. 批量公开卡读取

为避免一次 challenge 请求触发 18 到 30 次单卡 API 调用，本次推荐新增一个 challenge 侧专用的批量公开卡读取能力。

### 形式

优先级从高到低：

1. **服务端内部 helper**
   - `lib/challenge/server/enemy-candidates` 直接调用仓库层批量读取公开卡
2. **轻量 API**
   - 仅在 challenge 服务端无法直接复用仓库层时，再新增内部 API

本次不推荐继续依赖循环调用 `/api/public-data-cards?id=...`。

### 推荐首选路径

本次推荐的首选实现不是“再新增一个可公开访问的批量 API”，而是：

1. challenge 服务端在同一 edge 请求内直接调用仓库层 helper；
2. 对 `data_cards` 进行定长 `id IN (...)` 读取；
3. 不再对每个 `entityId` 单独发一次 `/api/public-data-cards?id=...`。

这样可以：

1. 避免额外 HTTP 往返；
2. 让重试策略只保留在真正需要的网络层；
3. 更清晰地控制 D1 查询次数。

### 查询语义

批量公开卡读取必须是“定长 ID 集合查询”，而不是二次搜索。推荐语义：

1. 输入：`dataCardIds[]`
2. 约束：
   - `id IN (...)`
   - `type='character'`
   - `is_public=1`
   - `review_status='approved'`
   - `deleted_at IS NULL`
3. 输出：
   - `id`
   - `data`
   - `name`
   - `updatedAt`
   - 其他构造 snapshot 所需最小字段

### 读取上限

1. 单次批量读取的 `dataCardIds` 数量不得超过当前 leaderboard 窗口大小。
2. 在推荐窗口策略下，单次 challenge 最多批量读取两次：
   - 第一次最多 18 个 ID
   - 第二次最多 12 个 ID

### 为什么不用模糊列表接口

不采用 `/api/public-data-cards?search=...` 或其他列表型接口做补卡，因为：

1. challenge 已经拿到了精确 `entityId`
2. 模糊搜索会引入无意义的额外过滤与排序
3. 更容易放大 Rows Read

## 4. 错误分类与重试策略

“重试几次”必须做错误分类，不能对所有失败一视同仁。

### 可重试错误

以下错误允许 1 到 2 次短重试：

1. live leaderboard HTTP 请求的网络异常
2. live leaderboard HTTP 请求超时
3. live leaderboard HTTP 请求的 `5xx`
4. 若采用内部批量读取 API，则该内部 API 的网络异常或 `5xx`

### 不可重试错误

以下错误不应对同一 ID 做重复重试：

1. `404`
2. `success=false`
3. 公开条件不满足
4. payload 为空
5. payload JSON 解析失败
6. 模板识别失败且无法构造完整敌人 snapshot
7. 仓库层 `id IN (...)` 查询已经返回“该 ID 不存在于结果集”

### 重试节奏

推荐策略：

1. 首次失败立即判定失败发生层级：
   - leaderboard HTTP
   - 批量公开卡读取
   - 渲染校验
2. 可重试错误仅发生在网络层：
   - 第 1 次重试：短延迟
   - 第 2 次重试：更长短延迟
3. 仓库层 `id IN (...)` 查询不做单 ID 重试：
   - 查询失败则整批失败并进入窗口级降级判断
   - 查询成功但单 ID 缺失则直接判定该实体不可用
4. 超过 2 次后仍失败，则标记该窗口结果不可用并继续下一窗口或降级。

### 设计重点

优先级必须是：

1. 跳过当前失败实体
2. 使用后续 leaderboard 实体补位

而不是：

1. 对同一失败 ID 连续打三到五次请求

## 5. remote 候选池成形规则

### 入池条件

只有满足以下条件的实体才能进入 remote 候选池：

1. 来源实体来自 live leaderboard 有效窗口。
2. 对应完整卡已验证可读且可渲染。
3. 能成功归一化为 challenge 可用敌人 snapshot。

### 去重规则

沿用现有 `sourceType + sourceId` 去重逻辑，但 remote 路径下：

1. `data_card` 只产生 `public-card`
2. `preset` 只产生 `preset`
3. 不再主动产出 `season-entity`

### 档位收敛

沿用现有设计：

1. 候选最终 `strengthTier` 仍以节点目标档位为准
2. 不沿用源卡自身 `powerLevel`

## 6. 最终降级路径

本次仍保留 `preset-only` 作为最终兜底，但语义要调整为：

1. **优先 remote 完整卡**
2. **remote 凑不齐时整体回退 preset-only**
3. **而不是 remote 路径内大量混入 `season-entity`**

### 降级触发条件

满足任一条件即可整体降级：

1. leaderboard 请求失败
2. leaderboard 返回空窗口
3. 经过两段窗口读取与完整卡验证后，remote 候选数仍为 `0`
4. remote 候选数虽然大于 `0`，但低于系统定义的最低可接受阈值

### 最低可接受阈值

推荐：

1. 目标 `limit=6`
2. 最低 remote 有效候选阈值设为 `3`

即：

1. 若 remote 验证后达到 `3` 到 `6` 个，则允许服务端按 `selectionSeed` 完成最终选敌
2. 若少于 `3` 个，则直接整体回退 `preset-only`

这样可以减少 remote 候选池过窄导致的重复感或不稳定性。

## 7. 已验证完整卡的复用策略

仅仅在 remote 候选构建阶段验证“完整卡当前可读”还不够。若 challenge 在进入节点展示时再次把这张卡完全丢弃，并重新依赖一次单卡 fetch，那么仍然可能因为：

1. 瞬时网络异常
2. edge 波动
3. 用户端重试失败

而再次落回展示层 fallback。

因此推荐把“已验证成功的完整卡”尽量复用到节点展示主链路中，而不是让节点展示层再把它当作未知来源重新读取。

### 推荐实现

1. challenge 服务端在 remote 候选最终选中敌人时，同时返回该敌人的 `resolvedSourceCardLite`
2. `resolvedSourceCardLite` 不写入 `runState` 或 `encounterSnapshot`
3. `resolvedSourceCardLite` 作为 challenge 当前会话内的瞬时 sidecar 数据存在
4. 节点展示优先消费这份 sidecar 数据
5. 只有在 sidecar 数据不存在时，才回退到当前的 `fetchPublicCardById` 补查逻辑

### 推荐数据流

1. 服务端读取 leaderboard 有限窗口
2. 服务端批量校验完整卡与可渲染性
3. 服务端按 `selectionSeed` 选出最终敌人
4. 服务端返回：
   - `enemySnapshot`
   - `resolvedSourceMode`
   - 可选 `resolvedSourceCardLite`
5. 客户端在当前 challenge controller 会话内暂存 `resolvedSourceCardLite`
6. `resolveChallengeEnemyDisplay` 先查 controller 内的已验证卡缓存
7. 命中则直接渲染
8. 未命中才走现有单卡补查兼容链路

### 为什么推荐服务端直接返回“已选中的完整卡”

相比“服务端只返回候选快照，客户端再自己二次拉完整卡”，这种做法有三个优势：

1. 避免把同一张已验证成功的卡在短时间内重复读取两次
2. 进一步降低节点展示阶段落回 fallback 的概率
3. 更容易给单次 challenge 敌人解析链路建立明确的读预算

### 与现有存档边界的关系

这份 sidecar 数据：

1. 不进入 `RunStateV1`
2. 不进入 `EncounterSnapshotV1`
3. 不要求在 challenge resume 后长期保留

因此它不会破坏当前“挑战存档只持久化 snapshot，不持久化完整敌方原卡”的边界。

### sidecar 数据契约

`resolvedSourceCardLite` 必须只包含最小必要字段，并且明确是 **challenge API 自己的 camelCase DTO**，而不是把 `/api/public-data-cards?id=...` 的整行 snake_case 记录原样透传。推荐契约：

1. `id`
2. `name`
3. `data`
4. `updatedAt`

字段约束：

1. `id`
   - 字符串
   - 对应 `data_cards.id`
2. `name`
   - 字符串
   - 对应当前公开卡名称
3. `data`
   - 字符串
   - 内容为当前 `data_cards.data` 的原始 JSON 字符串
   - 语义上等价于当前 `/api/public-data-cards?id=...` 返回 `card.data`
   - **不**在 API 层预解析成对象，避免重复序列化/反序列化边界漂移
4. `updatedAt`
   - `string | null`
   - challenge API 边界统一使用 camelCase `updatedAt`
   - 由仓库层或旧接口记录中的 `updated_at` 显式映射而来

示例：

```json
{
  "id": "card-1",
  "name": "雪绒",
  "data": "{\"templateId\":\"magical-girl\",\"codename\":\"雪绒\"}",
  "updatedAt": "2026-04-05T10:00:00.000Z"
}
```

明确不返回：

1. 作者信息
2. 点赞/使用等统计
3. 额外标签聚合信息
4. 与完整卡展示无关的派生元数据

## 对现有类型与展示层的影响

## `EnemySnapshotV1`

类型定义暂不删除 `season-entity`，因为：

1. 现有存档和测试仍已接受该类型
2. 历史兼容成本较低

但 remote live 构建路径的目标变更为：

1. `preset`
2. `public-card`

只有历史兼容或显式本地快照场景才保留 `season-entity`。

## `resolveChallengeEnemyDisplay`

展示层仍保留对 `season-entity` 的兼容读取逻辑，但设计预期变更为：

1. 正常 live remote 候选几乎不会再走到这里
2. challenge 中“回退为挑战快照卡”的出现频率应显著下降

## 数据与性能约束

## 1. leaderboard 读取约束

1. 仅允许读取 live `/api/arena/leaderboard`
2. 单次 challenge 最多两段窗口
3. 总 leaderboard entity 窗口大小上限 `30`
4. 禁止新增全榜扫描型 challenge 对手接口

## 2. 公开卡读取约束

1. 不允许按每个实体逐个请求单卡接口作为长期主方案
2. 推荐新增定长 `id IN (...)` 批量公开卡读取 helper
3. 单次 challenge 批量读取次数上限 `2`
4. 单次 challenge 批量读取总 ID 数上限 `30`

## 3. D1 查询预算与验证方式

本次不再用“验证了 30 张卡”来近似代表总 Rows Read，而改成“challenge 新增链路最多触发的查询类型与次数”。

### challenge 新增链路预算

若采用本设计的推荐实现，则单次 remote 选敌主链路最多新增：

1. leaderboard HTTP 请求最多 `2` 次
   - 每次内部沿用现有 `/api/arena/leaderboard`
   - 其 D1 读路径继续包含现有实现中的：
     - `arena_ratings`
     - `data_cards`
     - `users`
     - `data_card_metrics`
     - `data_card_tags`
     - queen 查询
2. challenge 自身新增的 D1 直连批量公开卡查询最多 `2` 次
   - 每次只触达 `data_cards`
   - 不做 JOIN
   - 不做 COUNT
   - 不做搜索

### 结构性复杂度约束

新的 challenge 敌人解析路径必须满足：

1. leaderboard 查询复杂度最多 `O(W)` 个有限窗口请求，其中 `W <= 2`
2. 完整卡校验查询复杂度最多 `O(1)` 个批量 SQL 请求每窗口一次
3. 禁止退回到 `O(N)` 个逐 ID 单卡 HTTP 查询

### 可验证方式

实施阶段必须通过以下方式验证：

1. 在 challenge 敌人解析链路打印或埋点：
   - `leaderboardWindowRequestCount`
   - `bulkPublicCardQueryCount`
   - `validatedCandidateCount`
   - `selectedFromWindow`
   - `fallbackReason`
2. 在 Cloudflare 指标中对比改造前后的 challenge 选敌请求：
   - 请求量
   - D1 Rows Read
   - 失败率
3. 验收口径：
   - 不出现与表规模线性绑定的全量扫描增长
   - 不出现逐 ID 单卡补查导致的请求数放大
   - 新链路的 D1 读热点应主要集中在现有 leaderboard 查询与最多两次 `data_cards id IN (...)` 查询

## 4. SQL 约束

推荐新增的批量公开卡读取 SQL 必须满足：

1. 仅按精确 `id` 集合读取
2. 必须带公开、审核、删除状态过滤
3. 不做额外 COUNT
4. 不做模糊搜索
5. 不做无关 JOIN

推荐查询形态：

```sql
SELECT id, name, data, updated_at
FROM data_cards
WHERE id IN (...)
  AND type = 'character'
  AND is_public = 1
  AND review_status = 'approved'
  AND deleted_at IS NULL
```

### 不推荐做法

1. challenge 单独新增模糊搜索榜单
2. challenge 侧为补卡再次按筛选条件跑列表查询
3. challenge 侧做全量公开卡扫描或分段遍历

## 5. 缓存策略

### 服务端

本轮明确采用：

1. 继续复用现有 `/api/arena/leaderboard` 的 15s edge cache
2. 不为 `/api/challenge/enemy-candidates` 额外增加 route 级 `withEdgeCache`

原因：

1. challenge 选敌主链路将引入 `selectionSeed` 与 `resolvedSourceCardLite`
2. route 级缓存会导致 key 更细、payload 更大
3. 本轮优先依赖下游 leaderboard 缓存与 challenge 内部有限窗口/批量读取约束控制成本

若后续监控显示 `/api/challenge/enemy-candidates` 成为明显热路径，再单独评估 challenge route 级缓存，但不在本轮设计中强行引入。

### 浏览器端

浏览器端可以保留轻量辅助缓存，但不是本轮主链路。若后续需要优化前端响应速度，推荐缓存：

1. 已验证成功的完整卡 payload
2. `dataCardId -> cardPayload` 的短期本地映射

不推荐继续扩展 rank cache 承担完整卡职责。

## 测试设计

## 单元测试

需要补充或改写 challenge 对手来源相关测试，覆盖：

1. live leaderboard 窗口中的 `data_card` 能成功批量补齐完整卡时，全部产出 `public-card`
2. 单个 `data_card` 补卡失败时会被跳过，而不是产出 `season-entity`
3. 第一窗口不足时会触发第二窗口扩扫
4. 两段窗口后仍不足最低阈值时，整体回退 `preset-only`
5. `preset` 仍可正常入池
6. 可重试错误只重试有限次数
7. 不可重试错误不会对同一 ID 重复请求
8. 完整卡校验必须包含“可渲染”边界，而不是只验证 payload 可读取

## 集成测试

需要补充 API 层测试，覆盖：

1. `/api/challenge/enemy-candidates` 在 `selectionSeed` 模式下返回：
   - `enemySnapshot`
   - `resolvedSourceMode`
   - `resolvedSourceCardLite`
2. `/api/challenge/enemy-candidates` 在兼容候选模式下，remote 成功时返回的 `candidates` 只包含 `public-card` / `preset`
3. remote 失败后返回 `resolvedSourceMode='preset-only'`
4. leaderboard 请求失败时不会抛出未处理异常
5. 批量补卡 helper 在公开条件不满足时稳定过滤
6. 节点展示优先使用 sidecar 卡数据，而不是再次强依赖单卡 fetch

## 性能回归测试

至少要在测试或文档验证中明确以下预算：

1. 单次 remote 选敌最多读取两次 leaderboard 窗口
2. 单次 remote 选敌最多两次批量公开卡读取
3. 不引入新的 COUNT 热路径
4. 不引入新的全榜扫描
5. 正常主链路不对“已验证成功的最终对手”再次做重复的远程单卡读取

## 实施与上线边界

### 本轮必须同版落地的能力

以下能力允许拆成多个 commit 或多个开发步骤，但**不得以“阶段一已上线、阶段二以后再补”** 的形式长期分开发布；对外启用 challenge 新主链路前，以下能力必须同时具备：

1. `/api/challenge/enemy-candidates` 支持 `selectionSeed` 服务端选敌模式
2. remote 路径不再在 `data_card` 补卡失败时产出 `season-entity`
3. leaderboard 两段有限窗口与最低 remote 阈值逻辑生效
4. challenge 侧批量公开卡读取 helper 生效，主链路不再依赖逐 ID `/api/public-data-cards?id=...` 循环补查
5. 完整卡验证已经收紧为“可读 + 可渲染”，并复用单一真相函数
6. `resolvedSourceCardLite` 已接入当前 challenge controller 会话 sidecar
7. leaderboard 第二窗口所需的 `offset` 读取能力已打通

原因：

1. 如果只上线服务端选敌，但仍保留逐 ID 单卡补查作为生产态主链路，则 challenge 热路径仍会存在请求数放大
2. 如果只上线完整卡补查，但不接入 sidecar，则节点展示阶段仍可能把刚验证成功的卡再次拉取失败
3. 如果只上线固定窗口，但没有可渲染校验，则仍会把“能读但不能展示”的卡放进 remote 候选池

因此，允许“开发过程分步完成”，但不接受“产品行为分阶段长期停留在半完成态”。

### 上线后观察项

1. 观察 `season-entity` 在 challenge live remote 链路中的实际出现率
2. 若接近零，则进一步把它限制为历史兼容类型
3. 若 `/api/challenge/enemy-candidates` 热度明显升高，再单独评估 route 级缓存，而不是在本轮预先加入

## 验收标准

1. `/challenge` 的 live remote 候选默认几乎总能展示完整角色卡。
2. 正常 remote 返回的候选中，不再常规出现 `season-entity`。
3. challenge 不依赖 `/ranking` 页面本地缓存即可稳定获取远程对手。
4. 当少量远程实体补卡失败时，会优先跳过并继续补位，而不是立即退化为快照卡。
5. 当 remote 候选整体不可用时，系统仍能稳定回退 `preset-only`。
6. 单次 challenge 对手构建不会引入新的全榜扫描、模糊搜索扫表或无上限补卡请求。
7. 与现有排行系统的 Top300 / 有限窗口 / edge cache 性能边界保持一致，不额外制造高 Rows Read 热点。
8. 正常 challenge 节点展示不再依赖“同一张刚验证过的远程对手卡再单独 fetch 一次”作为唯一成功条件。
