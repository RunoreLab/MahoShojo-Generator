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

这意味着 live 排行榜中的 `data_card` 在服务端语义上应当属于“当前可读公开卡”，理论上与 `/api/public-data-cards?id=...` 的公开单卡读取条件是一致的。

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
2. remote 候选必须先通过“完整卡可读校验”，再进入候选池。
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
2. 仅将“成功补齐完整卡”的实体纳入 remote 候选池。
3. 若窗口内无法凑齐目标数量，则进行有限扩窗。
4. 最终仍凑不齐时，整体降级为 `preset-only`。

### 优点

1. 不依赖 `/ranking` 页面访问历史。
2. 远程候选的“完整卡可展示”语义明确。
3. 可以把 Rows Read 预算集中控制在服务端。

### 问题

1. 需要新增批量公开卡读取或内部 helper，避免单卡补查次数过多。

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
2. 必须先通过“完整公开卡可读”校验，验证成功后才能进入 remote 候选池。
3. 校验成功后产出 `sourceType='public-card'` 的标准敌人 snapshot。
4. 校验失败则跳过当前实体，而不是回退为 `season-entity`。

## 3. 批量公开卡读取

为避免一次 challenge 请求触发 18 到 30 次单卡 API 调用，本次推荐新增一个 challenge 侧专用的批量公开卡读取能力。

### 形式

优先级从高到低：

1. **服务端内部 helper**
   - `lib/challenge/server/enemy-candidates` 直接调用仓库层批量读取公开卡
2. **轻量 API**
   - 仅在 challenge 服务端无法直接复用仓库层时，再新增内部 API

本次不推荐继续依赖循环调用 `/api/public-data-cards?id=...`。

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

1. 网络异常
2. 请求超时
3. `5xx`
4. edge 瞬时异常

### 不可重试错误

以下错误不应对同一 ID 做重复重试：

1. `404`
2. `success=false`
3. 公开条件不满足
4. payload 为空
5. payload JSON 解析失败
6. 模板识别失败且无法构造完整敌人 snapshot

### 重试节奏

推荐策略：

1. 首次失败立即判定错误类型。
2. 可重试错误：
   - 第 1 次重试：短延迟
   - 第 2 次重试：更长短延迟
3. 超过 2 次后仍失败，则标记该实体为本轮不可用并跳过。

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
2. 对应完整卡已验证可读。
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

1. 若 remote 验证后达到 `3` 到 `6` 个，则允许按现有 hash 逻辑选取
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

1. challenge 在 remote 候选最终选中敌人时，同时保留该敌人的 `resolvedSourceCard`
2. `resolvedSourceCard` 不写入 `runState` 或 `encounterSnapshot`
3. `resolvedSourceCard` 作为 challenge 当前会话内的瞬时 sidecar 数据存在
4. 节点展示优先消费这份 sidecar 数据
5. 只有在 sidecar 数据不存在时，才回退到当前的 `fetchPublicCardById` 补查逻辑

### 推荐数据流

1. 服务端读取 leaderboard 有限窗口
2. 服务端批量校验完整卡
3. 服务端按 `selectionSeed` 选出最终敌人
4. 服务端返回：
   - `enemySnapshot`
   - `resolvedSourceMode`
   - 可选 `resolvedSourceCard`
5. 客户端在当前 challenge controller 会话内暂存 `resolvedSourceCard`
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
3. 总扫描行数上限 `30`
4. 禁止新增全榜扫描型 challenge 对手接口

## 2. 公开卡读取约束

1. 不允许按每个实体逐个请求单卡接口作为长期主方案
2. 推荐新增定长 `id IN (...)` 批量公开卡读取 helper
3. 单次 challenge 批量读取次数上限 `2`
4. 单次 challenge 批量读取总 ID 数上限 `30`

## 3. SQL 约束

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

## 4. 缓存策略

### 服务端

继续复用现有 leaderboard 与公开卡接口的 edge 短缓存思路，不新增 challenge 侧长生命周期强状态缓存。

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

## 集成测试

需要补充 API 层测试，覆盖：

1. `/api/challenge/enemy-candidates` 在 remote 成功时返回的 `candidates` 只包含 `public-card` / `preset`
2. remote 失败后返回 `resolvedSourceMode='preset-only'`
3. leaderboard 请求失败时不会抛出未处理异常
4. 批量补卡 helper 在公开条件不满足时稳定过滤
5. 若主链路采用“服务端选中并返回已验证完整卡”，则需验证节点展示优先使用 sidecar 卡数据，而不是再次强依赖单卡 fetch

## 性能回归测试

至少要在测试或文档验证中明确以下预算：

1. 单次 remote 候选构建最多读取两次 leaderboard 窗口
2. 单次 remote 候选构建最多两次批量公开卡读取
3. 不引入新的 COUNT 热路径
4. 不引入新的全榜扫描
5. 正常主链路不对“已验证成功的最终对手”再次做重复的远程单卡读取

## 实施建议

## 第一阶段

1. 调整 `resolveArenaEnemyCandidates` / challenge server enemy source 语义
2. remote 路径不再在 `data_card` 补卡失败时产出 `season-entity`
3. 增加固定窗口与最低阈值逻辑
4. 明确 challenge 当前 remote 主链路的“最终选敌”责任边界，避免验证与选取分别散落在不同层

## 第二阶段

1. 新增 challenge 侧批量公开卡读取 helper
2. 从“循环单卡读取”切换到“窗口批量读取”
3. 加入错误分类和有限重试
4. 若采用服务端选中模式，则同时把 `resolvedSourceCard` 作为瞬时 sidecar 数据交给 challenge controller

## 第三阶段

1. 观察 `season-entity` 在 challenge live remote 链路中的实际出现率
2. 若接近零，则进一步把它限制为历史兼容类型

## 验收标准

1. `/challenge` 的 live remote 候选默认几乎总能展示完整角色卡。
2. 正常 remote 返回的候选中，不再常规出现 `season-entity`。
3. challenge 不依赖 `/ranking` 页面本地缓存即可稳定获取远程对手。
4. 当少量远程实体补卡失败时，会优先跳过并继续补位，而不是立即退化为快照卡。
5. 当 remote 候选整体不可用时，系统仍能稳定回退 `preset-only`。
6. 单次 challenge 对手构建不会引入新的全榜扫描、模糊搜索扫表或无上限补卡请求。
7. 与现有排行系统的 Top300 / 有限窗口 / edge cache 性能边界保持一致，不额外制造高 Rows Read 热点。
8. 正常 challenge 节点展示不再依赖“同一张刚验证过的远程对手卡再单独 fetch 一次”作为唯一成功条件。
