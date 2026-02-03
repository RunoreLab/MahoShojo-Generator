# D1 Rows Read 继续降读排查与方案（2026-02）

更新时间：2026-02-02  
目标：把 Rows Read 从当前约 **2B/日** 继续压到 **25B/月以下**（约 **0.83B/日**）

> 本文基于仓库静态分析（全量检索 `queryFromD1()` 读路径 + SQL 形态判断）。需要你结合 Cloudflare D1 Query Insights / Analytics 验证“Top Queries”是否与本文命中一致。

---

## 0. 背景回顾（与 2026-01 的差异）

`docs/D1_ROWS_READ_AUDIT_2026-01.md` 的头号风险（排位结算中 `ROW_NUMBER() OVER (...)` 全表扫）在当前代码中已不再出现（`lib/database/arena-ratings.ts` 已无窗口函数全表排名逻辑），这很符合“4B/日 → 2B/日”的下降现象。

接下来要继续从 2B/日压到 0.83B/日，需要优先处理 **“每次请求都会把大表整张扫一遍/多遍”** 这类读放大，而不是微调小查询。

### 0.1 线上 Query Insights 的新信号（你贴的截图）

从你贴的两条 Top Queries 来看，Rows Read 没明显下降，原因很可能是：**主读量已从「榜单 rank 全表扫」转移到了「arena_rating_events / data_cards 的扫描」**。

#### A) `arena_rating_events` 最近变动（lastDelta）窗口函数

截图特征 SQL（简化）：

```sql
SELECT queue, delta, applied_at
FROM (
  SELECT ..., ROW_NUMBER() OVER (PARTITION BY queue ORDER BY applied_at DESC, created_at DESC) AS rn
  FROM arena_rating_events
  WHERE status='applied' AND queue IN ('strict','free') AND (...a_entity_id=? OR b_entity_id=?)
)
WHERE rn = 1;
```

截图指标（来自 D1 Query Insights）：

- Rows Read：约 **92.32k / 次**
- 调用次数：约 **12,780**
- 平均耗时：约 **137ms**

这条查询如果缺少“按实体 id 过滤”的索引，非常容易退化为大范围扫描 + 排序；在高频调用下会成为稳定的大读来源。

命中位置（已落地移除，见 §2.3）：`pages/api/data-card-meta.ts`（`lastDelta/lastAppliedAt`）。

#### B) `/api/public-data-cards` 列表扫描（带 OFFSET + ORDER BY）

截图特征 SQL（简化）：

```sql
SELECT dc.*, u.username,
  (SELECT group_concat(DISTINCT tag_id) FROM data_card_tags WHERE data_card_id = dc.id) AS tag_ids
FROM data_cards dc
JOIN users u ON dc.user_id = u.id
WHERE dc.is_public=1 AND dc.review_status='approved' AND dc.deleted_at IS NULL AND dc.type=?
ORDER BY dc.created_at DESC
LIMIT ? OFFSET ?;
```

截图指标（来自 D1 Query Insights）：

- Rows Read：约 **15.84k / 次**
- 调用次数：约 **7,630**
- 平均耗时：约 **228ms**

典型原因是：缺少“匹配过滤 + 排序”的复合索引，或使用 OFFSET 导致读量随翻页线性上升。

命中位置：`lib/database/data-cards.ts#getPublicDataCards()` + `pages/api/public-data-cards.ts`。

### 0.2 进度盘点（对照 2026-01/2026-02 文档）

| 事项 | 状态 | 备注 |
| --- | --- | --- |
| 排位结算 `ROW_NUMBER() OVER` 全表扫 | 已完成（代码） | `lib/database/arena-ratings.ts` 已无窗口函数扫表 |
| 严格排位匹配（高频大读） | 已完成（代码） | `/api/arena/ranked-matchmaking` 已下线（410） |
| 榜单缓存（止血） | 已完成（代码） | `/api/arena/leaderboard` `withEdgeCache` 15s |
| 公共卡列表缓存（止血） | 已完成（代码） | `/api/public-data-cards` `withEdgeCache` 15s |
| `data_card_tags` 全表聚合 JOIN | 已完成（代码） | 改为“按行关联子查询”，避免扫全表 tags |
| lastDelta/lastAppliedAt 扫 `arena_rating_events` | 已完成（代码）/ 需迁移（D1） | 已物化到 `arena_ratings`；未迁移时接口降级为 `null` |
| `data-card-meta` 精确 `publicRank/publicTotal` | 已完成（代码） | 已不再计算（字段保留但固定返回 `null`） |
| `profile-card` 精确 `publicRank/publicTotal` | 未完成 | 仍在个人页热路径执行 COUNT 计算（见 §1.4/§3.1） |
| `strict` 每日计分次数统计索引 | 已加入 schema / 待迁移（D1） | 新增复合索引以避免扫当日事件（见 §1.7/§3.4.3） |
| `generation-ranking` 读事件按 `generation_id` | 已完成（代码） | 已改为按主键 `id IN (...)` 读取（见 §2.5） |
| 榜单搜索 `ROW_NUMBER() OVER` 全量排名 | 已完成（代码） | 当前 `leaderboard/search` 未再出现窗口函数（见 §1.6/§3.3） |

---

## 1. 当前仓库内最可疑的高读放大点（按 ROI 排序）

### 1.1 `arena_rating_events` 最近变动（lastDelta）查询（极高 ROI）

现状：`pages/api/data-card-meta.ts` 曾为展示 `lastDelta/lastAppliedAt`，对 `arena_rating_events` 做窗口函数 `ROW_NUMBER() OVER (PARTITION BY queue ...)`。

即使最终只取 strict/free 各 1 行，一旦缺少合适索引或命中失败，仍可能出现**大范围扫描 + 排序**，从而形成稳定 Rows Read。

推荐修复（更推荐“写入时物化”，而不是给读路径加索引硬顶）：

1) 在 `arena_ratings` 增加两列：`last_delta`、`last_applied_at`
2) 在排位结算写入 `arena_ratings` 时同步更新这两列（每次只更新两行）
3) 读取 `data-card-meta` 时直接从 `arena_ratings` 取值（不再扫 `arena_rating_events`）

这会把 lastDelta 从“读放大”变成“写放大（两行 UPDATE）”，对 Rows Read 的收益非常直接。

已落地实现：见 §2.3（注意需要线上迁移）。

---

### 1.2 公共数据卡列表 `/api/public-data-cards`（高 ROI）

现状：`getPublicDataCards()` 默认用 `ORDER BY created_at DESC LIMIT/OFFSET`，且会关联作者与 tags。

当缺少合适的复合索引时，SQLite/D1 容易退化为：

- 先筛选出大批候选
- 再排序
- 再丢弃 OFFSET 前的行

Rows Read 会随 offset 增长，并在“列表页浏览/无限滚动”场景下快速累积。

推荐修复：

1) 为 `data_cards` 增加“过滤 + 排序”复合索引（见 §2.4 / §3.4）
2) 为 `/api/public-data-cards` 增加 Edge Cache（10s~30s）作为止血（见 §2.4）
3) 中期可考虑把分页改成 cursor/keyset（可选，见 §3.5）

---

### 1.3 数据卡标签 `data_card_tags` 的“全表聚合再 JOIN”（极高 ROI）

在以下函数中，存在模式：

```sql
LEFT JOIN (
  SELECT data_card_id, group_concat(DISTINCT tag_id) AS tag_ids
  FROM data_card_tags
  GROUP BY data_card_id
) tag_map ON tag_map.data_card_id = dc.id
```

该子查询会对 `data_card_tags` 做 **全表扫描 + 全量分组**，哪怕最终只返回 1 张卡或 20 张卡。

命中位置（已修复，见 §2）：

- `lib/database/data-cards.ts`
  - `getUserDataCards()`
  - `getDataCardById()`
  - `getPublicDataCards()`
- `lib/database/favorites.ts`
  - `getUserFavorites()`

**为什么这很可能是 2B/日的主因**：  
`data_card_tags` 是典型“增长型”表（每张卡 0~30 条），只要它达到百万/千万级别，每次全表聚合都会直接吃掉大量 Rows Read。

---

### 1.4 公共排名（`publicRank/publicTotal`）的 COUNT 计算（高 ROI，且价值可谈）

命中位置（部分已改动，仍需继续处理）：

- `pages/api/data-card-meta.ts`
  - ✅ 已不再计算 `publicRank/publicTotal`（字段保留但固定返回 `null`）
- `pages/api/me/profile-card.ts`
  - ❗仍在计算 `publicTotal` 1 次 `COUNT(*)`
  - ❗仍对多张卡重复执行 `publicRank` 的 `higherCount` 计数（最多 7 次）

这类 query 的特点是：

- **很难做到“精确 rank + 低 Rows Read”**：rank 本质是“你前面有多少人”，即使有索引也需要扫描前缀；
- 业务价值可被替代：可以用“约/分位段/只在排行榜页展示精确名次”等方式降级。

> 结论：如果你们确实希望继续显著降读，这是下一块必须动的地方。

---

### 1.5 排行榜（`/api/arena/leaderboard*`）的标签聚合 JOIN（中高 ROI）

命中位置（已修复，见 §2）：

- `pages/api/arena/leaderboard.ts`
- `pages/api/arena/leaderboard/search.ts`

问题点：`LEFT JOIN data_card_tags` + `GROUP BY` + `group_concat(DISTINCT ...)` 会把“本来可能走 `arena_ratings(queue, rating)` 索引的分页查询”，变成更重的聚合查询，并额外读取大量 tag 行。

---

### 1.6 榜单搜索的 LIKE 扫描风险（中 ROI，需要防滥用）

现状：`pages/api/arena/leaderboard/search.ts` 已移除“全量 `ROW_NUMBER() OVER (...)` 排名”逻辑，但仍是 `LOWER(...) LIKE` + 多 OR 条件，并且在 `arena_ratings` + JOIN 上直接过滤。  
这类查询即使做了 rate limit，也属于“被爬虫/脚本打到就会很痛”的类型（LIKE 很难走索引，且 OR 条件会放大扫描）。

已做防护（值得保留）：

- IP 令牌桶限流
- Edge Cache（10s）

进一步建议：如仍出现稳定高 Rows Read，可改为“两段式搜索（先候选 id，再查 rating/段位）”或引入 FTS（见 §3.3）。

---

### 1.7 strict 每日计分次数 COUNT（高 ROI，需补索引）

命中位置：

- `lib/database/arena-ratings.ts#getStrictDailyUsage()`
- `pages/api/arena/strict-preflight.ts`（调用 `getStrictDailyUsage`）

风险：当前实现为 `COUNT(*)` + `queue/status/user_id/created_at>=` 的组合条件；若缺少复合索引，可能退化为扫描“当日 strict 全量事件”再过滤，从而把 daily limit 校验变成稳定的大读来源。

建议：新增复合索引（已写入仓库 schema，线上需迁移；见 §3.4.3）。

---

## 2. 已在代码中落地的“无损降读”改动（本次提交）

> 这些改动不改变 API 字段/返回结构，仅改变 SQL 的实现方式，让 Rows Read 与“返回的卡片数量×该卡 tag 数量”成正比，而不是与全库 tag 量成正比。

### 2.1 数据卡/收藏列表：移除 `data_card_tags` 全表聚合

改动点：

- `lib/database/data-cards.ts`
  - `getUserDataCards()` / `getDataCardById()` / `getPublicDataCards()`
- `lib/database/favorites.ts`
  - `getUserFavorites()`

做法：把全表 `tag_map` 子查询改为“按行关联子查询”：

```sql
(SELECT group_concat(DISTINCT dct.tag_id)
 FROM data_card_tags dct
 WHERE dct.data_card_id = dc.id) AS tag_ids
```

依赖前提：`data_card_tags(data_card_id)` 已有索引（`idx_data_card_tags_data_card_id`），可把读取限制在单卡 tag 行上。

---

### 2.2 Arena Leaderboard：移除 tags JOIN + GROUP BY（只对返回行取 tags）

改动点：

- `pages/api/arena/leaderboard.ts`
- `pages/api/arena/leaderboard/search.ts`

做法：把 `group_concat(DISTINCT dct.tag_id)` 改为 `CASE WHEN ... THEN (SELECT group_concat...) END`，并移除 `GROUP BY`，从而：

- 降低 tags 表读取
- 让 `arena_ratings(queue, rating)` 更容易被优化器利用（尤其是分页/排序场景）

---

### 2.3 Data Card Meta：移除 `arena_rating_events` 的 lastDelta 窗口函数扫描（需要迁移）

改动点：

- `pages/api/data-card-meta.ts`
- `lib/database/arena-ratings.ts`（排位结算写入）
- `lib/database/schema.sql`（新增列）

做法：

1) 在 `arena_ratings` 增加两列：
   - `last_delta INTEGER`
   - `last_applied_at TEXT`
2) 在结算写入 `arena_ratings` 时同步更新这两列（每次只更新两行）
3) `data-card-meta` 读取时直接取 `arena_ratings.last_delta/last_applied_at`，不再扫 `arena_rating_events`

兼容策略：

- 代码对旧 schema 做了回退：若线上尚未加列，接口会降级为 `lastDelta/lastAppliedAt = null`（不再触发大读）。

---

### 2.4 Public Data Cards：增加 Edge Cache（止血型）

改动点：

- `pages/api/public-data-cards.ts`：`withEdgeCache` 15s
- `lib/edge-cache.ts`：补齐内存缓存上限 + 大响应跳过内存缓存（避免 key 高基数导致内存增长）

收益预期：

- 在“多人浏览首页/前几页”场景下，明显降低 `/api/public-data-cards` 的 D1 读次数；
- 与索引配套后，可进一步降低单次查询 Rows Read。

---

### 2.5 Generation Ranking：按主键读取 `arena_rating_events`（无损降读）

改动点：

- `pages/api/arena/generation-ranking.ts`

做法：把读取事件的查询从 `WHERE generation_id = ?` 改为 `WHERE id IN (?, ?)`（`{generationId}:strict/free`），避免 `arena_rating_events` 随表增长导致的“按 generation_id 扫表”。

---

## 3. 下一步“高性价比继续降读”方案（建议按优先级推进）

### 3.1 第一优先：砍掉/降级 `publicRank/publicTotal` 的精确计算

推荐路径（从激进到保守）：

**方案 A（最推荐，止血型）**  
默认不计算 `publicRank/publicTotal`（返回 `null`），只在：

- 排行榜页面（`/api/arena/leaderboard`）展示“列表名次”
- 或者用户主动点开“显示名次”时，才触发额外接口

优点：对 Rows Read 的下降最直接；缺点：产品上“名次”不再处处可见。

**方案 A1（更激进但更“定价可控”）：精确名次仅 Top300（窗口排名）**  
将“名次”从“全量定义”改为“窗口内定义”：

- **仅统计排位分最高的 Top300**（严格/自由各一份；按 canonical 口径：`rating DESC, games DESC, updated_at DESC, entity_type ASC, entity_id ASC`）
- 对于 Top300 之外的实体：**不再显示排名**（`publicRank/publicTotal = null`），仅显示排位分/段位/Δ 等
- 榜单页面/榜单模态框只允许浏览 **Top300**（最多翻到 #300，不支持深分页 offset）

对 D1 Rows Read 的收益点（为什么它可能“极大降读”）：

- 个人页（`/me`）等非榜单页面的“精确名次”目前仍依赖 `COUNT(*) higherCount` / `COUNT(*) total`，属于**按请求扫描**的模式（读量与榜单规模强相关）。
- Top300 窗口排名把“需要全量统计的名次”变成“固定窗口的列表查询”：在索引可用的前提下，查询读量趋近于 **O(300)**，而不是 **O(|eligible|)**。
- 同时还能直接消灭“排行榜深分页（OFFSET）导致 Rows Read 随 offset 线性上升”的问题：offset 的上限被强行钉死在 300。

实现建议（尽量不引入新的 D1 热点）：

1) **服务端不再在热路径计算 `publicRank/publicTotal`**  
   - 直接对齐 `data-card-meta` 的做法：`pages/api/me/profile-card.ts` 移除 `computePublicRank/computePublicTotal`。
   - 若仍希望在个人页展示“我的卡的名次”：改为 **一次性读取 Top300 并做 membership 绑定**（对该请求内的 1~3 张卡填充 rank；其它一律 null）。
2) **排行榜接口“硬限制”Top300 范围**  
   - `pages/api/arena/leaderboard.ts`：当 canonical 排行榜请求（`sort=rating&order=desc&...`）时，强制 `offset + limit <= 300`（超出返回空列表或 400）。
   - 非 canonical（标签/技术值/筛选）视图建议不再宣称“全榜名次”，而是展示“列表序号”（避免误解为精确 rank）。
3) **不做全榜 total**  
   - Top300 方案天然不需要 `total`；若仍要展示“全榜总人数/百分比”，应走单点缓存或快照表（见 3.2/方案 C），不要回到读路径 COUNT。

对“严格排位自选对手”的影响（关键风险点）：

- 当前竞技场的“快速查看排行榜”模态框（`components/arena/components/ArenaRankingModal.tsx`）既用于看榜，也用于“加入参战”挑对手；并提供“仅显示严格可计分对手”的过滤。
- **若榜单只剩 Top300**：对于绝大多数不在 Top300 的玩家而言，Top300 的排位分通常远高于自己，开启“严格可计分对手”后会大量出现 **空列表**；即便强行选择对手，也会频繁触发 `strict-out-of-range`，导致严格计分被跳过。

建议的解决方案（保持 D1 可控 + 不牺牲严格对局可用性）：

1) **把“挑严格对手”从“榜单”里拆出去**（推荐）  
   - 在排行榜模态框增加一个 Tab：`严格可计分对手（附近分段）`，该列表**不显示名次**，只展示分数/段位/局数/胜率，并提供“加入参战”。
   - 新增轻量接口：`/api/arena/opponents?queue=strict&pivotEntityType=...&pivotEntityId=...`  
     - 服务端先读 pivot 的 `rating/games`（可复用现有 `/api/arena/entity-rating` 逻辑）
     - 用 `rating BETWEEN [pivot-maxDiff, pivot+maxDiff]` 取候选（`LIMIT 30~60`），按“更接近 pivot”排序或随机打散
     - 该接口不返回 rank，因此不违反“精确名次仅 Top300”的约束
2) **UI 上做显式提示与降级**  
   - 在 Top300 榜单视图里提示：“本榜单仅展示 Top300 名次；如要找严格可计分对手，请切换到『附近分段』。”
   - 当用户勾选“仅显示严格可计分对手”且结果为空时，不再提示“翻页试试”，而是引导切换到“附近分段/搜索”。

可观测性（上线后怎么验证它是否真的在降读）：

- Cloudflare Query Insights 的 Top Queries 里：`COUNT(*) as higherCount` / `COUNT(*) as total` 应明显下降或消失。
- 若仍高：说明 D1 Rows Read 的主要来源已转移到其它查询（常见是公共列表分页 / tag 关联 / 搜索 LIKE）。

**方案 B（折中）**  
仍提供名次，但做“近似名次”：

- 返回 `rankApprox`（例如：`"约 1.2k 名"` / `"前 5%"`）
- 近似值来自“按 rating 分桶的直方图/分位点缓存”（每 10~60 分钟刷新一次）

这能把每次请求的成本降为 **1~2 个小查询**，避免 per-card `COUNT(*)` 扫描。

**方案 B2（折中 + 更偏客户端）：localStorage 估算名次（你提的方案）**  
核心点先说清楚：**localStorage 本身不会降低 Rows Read**，真正的降读来自“把精确 `publicRank/publicTotal` 从热路径移除”。localStorage 的价值是：在你砍掉精确排名查询后，仍然能在多数页面给用户一个“可用的名次参考”，维持体验。

可行性结论：**可行，但需要调整“估算口径/精度预期”**。

- 如果仅把“用户最近看过的排行榜条目/对战涉及的角色”存本地：你只能对“本地已缓存覆盖到的那段排名”给出较靠谱的名次；对未覆盖区域很难推算，**无法稳定做到**“约 1234 名（个位数精度）”。
- 若希望“任何角色都能给出一个看起来像名次的数字”，需要额外引入一个“小体积的 rank 模型”，例如：按分数（+场次）做分位点/直方图的 **rankHint**（可强缓存、低频刷新），客户端用它把 `rating/games` 映射为 `rankApprox`。这个模型可以：
  - 由 `/ranking` 或 `/api/arena/leaderboard` 响应顺带下发（并写入 localStorage）；
  - 或者由一个专门的 `/api/arena/leaderboard-stats` 下发（`withEdgeCache` 60s~300s），把 D1 读集中到“低频、可控”的单点。

推荐的实现方式（兼顾降读与体验）：

1) **只保留“Top300 精确名次”**：排行榜页（`/ranking`，含竞技场内“快速查看排行榜”）与个人页（`/me`，仅命中 Top300 时显示）。  
2) 其它位置（竞技场页面、数据卡详情模态框、列表卡片等）不再请求/计算 `publicRank/publicTotal`，改为：
   - 优先展示 `约 N 名`（来自本地缓存估算），并提供 tooltip：“基于本地缓存估算，仅供参考；以排行榜/个人页为准”；
   - 本地缓存缺失时降级为不展示名次（只展示分数/段位/Δ）。
3) **本地缓存更新时机**（避免额外请求）：
   - 用户访问排行榜/搜索榜时：把当页返回的条目与（可选）rankHint 写入 localStorage；
   - 用户完成一局排位：把本局双方最新 `rating/games/tier` 写入 localStorage（不用额外查）。
4) **显示精度建议**：即使最终 UI 文案使用 `约 1234 名`，也建议内部按“数据新鲜度”做动态取整（例如：缓存 > 6 小时则四舍五入到十位/百位），避免“伪精确”。

进一步的 UI 折中（更推荐）：**优先显示比例式估算（`约前 12%`）而不是名次数字**。  
理由：在“仅依赖本地缓存”的前提下，名次数字很容易显得“伪精确”；比例展示更符合“估算”的直觉，也更容易解释误差来源。

仅用本地缓存计算比例的可行口径（不新增任何线上查询）：

- 当实体在本地缓存里有明确 `rank`（例如曾在排行榜页被加载过）：记录该次浏览时的 `maxRankSeen`（用户滚动到的最深名次），并计算：
  - `topPercentBound = rank / maxRankSeen`
  - UI 展示为：`至少前 12%` / `≤ 前 12%`（这是一个保守上界；真实全局百分比通常更好）
- 当实体只有 `rating/games` 但没有 `rank`：不展示比例（或展示 `暂无估算`），避免用不可靠启发式硬算。

如果后续允许引入一个“低频、强缓存”的总人数/分位点数据（例如 `/api/arena/leaderboard-stats`），则可以把 `topPercentBound` 升级为更接近全局的 `rank / total` 或 `percentileHint(rating,games)`，但这属于增强项，不是本地估算的必要条件。

收益预期（对 Rows Read）：  
目前 `pages/api/data-card-meta.ts` 已不再做 `higherCount/publicTotal` 的 COUNT 统计；剩余主要在 `pages/api/me/profile-card.ts`。只要把个人页的精确名次计算从热路径移除（或改成近似），通常会出现明显下降；localStorage 方案能让“砍查询”更容易被用户接受。

风险与注意事项：

- localStorage 是**每设备/每浏览器**的：换设备、无痕、清缓存都会让估算排名不可用或更不准（需 UI 降级策略）。
- 本地数据可被篡改：只能用于展示，**不能**用于匹配/计分/风控等任何业务逻辑。
- 估算口径需要写入百科条目（见 `public/encyclopedia/ranking.md`），否则容易引发“为什么两个地方排名不一致”的反馈。

**方案 C（最保守，但成本高）**  
引入后台/定时任务，把可上榜实体的 `rank`/`total` 预计算到新表（物化视图思路），API 只读预计算结果。

---

### 3.2 第二优先：统一“可上榜总人数/女王”等统计的缓存出口

目前 `publicTotal`、女王计算等口径散落在多个 API 内部实现。建议：

- 新增一个只读接口 `/api/arena/leaderboard-stats?queue=strict|free`
  - 返回：`eligibleTotal`、`queenEntity`（可选）、更新时间
  - `withEdgeCache` 强缓存（例如 60s~300s）
- 其它接口改为复用这个缓存结果

收益：减少重复统计 query；同时让 Query Insights 更可观测（只剩一个“stats”来源）。

---

### 3.3 第三优先：继续加固排行榜搜索（避免 LIKE 扫描放大）

现状：榜单搜索已不再使用 `ROW_NUMBER() OVER` 做全量排名，但仍可能因为 `LIKE + OR` 在大表上扫描而被滥用。下面是进一步的降读/防滥用思路。

建议 SQL/流程（思路，不是唯一解）：

1) 先在 `data_cards`（`name/description`）和 `users.username` 上做 LIKE 搜索，取少量候选 `dataCardId`（例如 50）
2) 再 JOIN `arena_ratings` 读取这些候选的 rating/games/段位，最后按业务排序输出
3) “rank”字段可以：
   - 不展示（仅展示 rating/tier）
   - 或展示“列表序号”（不是全榜名次）

这样 Rows Read 规模与“候选集大小”相关，而不是与“全榜规模”相关。

### 3.4 线上迁移清单（建议优先执行）

> 注意：`lib/database/schema.sql` 只是“目标结构”。线上 D1 需要实际执行 `ALTER TABLE/CREATE INDEX`。

#### 3.4.1 `arena_ratings` 增列（用于 lastDelta 物化）

```sql
ALTER TABLE arena_ratings ADD COLUMN last_delta INTEGER;
ALTER TABLE arena_ratings ADD COLUMN last_applied_at TEXT;
```

可选：如果希望马上让存量数据也有 lastDelta，可以做一次性 backfill（可能较重，建议离峰执行，且先在测试库验证）。

#### 3.4.2 `data_cards` 增加公共列表复合索引（对应截图查询）

```sql
CREATE INDEX IF NOT EXISTS idx_data_cards_public_approved_type_created_at
  ON data_cards(type, is_public, review_status, deleted_at, created_at DESC);
```

验证建议：

- 在 D1 控制台对截图 SQL 执行 `EXPLAIN QUERY PLAN`，确认走到该索引；
- 对比迁移前后 Query Insights：同样参数下 Rows Read 是否显著下降。

#### 3.4.3 `arena_rating_events` 增加 strict 每日计分复合索引（对应 strict-preflight / 结算路径）

```sql
CREATE INDEX IF NOT EXISTS idx_arena_rating_events_user_queue_status_created_at
  ON arena_rating_events(user_id, queue, status, created_at);
```

对应查询：`lib/database/arena-ratings.ts#getStrictDailyUsage()`。

### 3.5 可选：public-data-cards 改为 cursor/keyset 分页（中期优化）

当你们的列表页存在大量 `offset` 翻页/无限滚动时，复合索引仍可能无法避免“offset 越大读越多”的线性放大。

可选改造方向：

- 用 `created_at + id` 做游标：`WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`
- 前端从 `offset` 改为 `cursor`，并保留兼容期（例如同时支持两种入参）

收益：把 Rows Read 从“随 offset 增长”变成“近似随 limit 固定”。

---

## 4. 建议的验证方式（你们需要在 Cloudflare 控制台做）

建议对比上线后 24 小时的：

1) Rows Read 总量：是否显著下降；目标是逐步逼近 **0.83B/日**  
2) Top Queries 是否从以下关键字中“消失/显著下降”：
  - `GROUP BY data_card_id` + `group_concat(DISTINCT tag_id)`（全表 tag_map）
  - `COUNT(*) as higherCount`（名次计算）
  - `COUNT(*) as count FROM arena_rating_events`（strict 每日计分次数统计）
  - `FROM data_cards` + `ORDER BY dc.created_at DESC LIMIT ? OFFSET ?`（公共列表）
3) 关键页面 P95 延迟：榜单/公共卡列表/个人页是否同步变快（通常会）

---

## 5. 建议的下一步协作方式（落地节奏）

为了快速达标，建议按两阶段推进：

1) **本周内（止血）**：先选定 3.1 的 A/B（产品可接受的降级方案），把 `publicRank/publicTotal` 从热路径移除或改成近似。  
2) **随后（治理）**：统一 stats 缓存出口 + 重写榜单搜索，进一步对抗爬虫/滥用带来的读放大。
