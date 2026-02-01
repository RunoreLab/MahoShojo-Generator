# D1 Rows Read 继续降读排查与方案（2026-02）

更新时间：2026-02-01  
目标：把 Rows Read 从当前约 **2B/日** 继续压到 **25B/月以下**（约 **0.83B/日**）

> 本文基于仓库静态分析（全量检索 `queryFromD1()` 读路径 + SQL 形态判断）。需要你结合 Cloudflare D1 Query Insights / Analytics 验证“Top Queries”是否与本文命中一致。

---

## 0. 背景回顾（与 2026-01 的差异）

`docs/D1_ROWS_READ_AUDIT_2026-01.md` 的头号风险（排位结算中 `ROW_NUMBER() OVER (...)` 全表扫）在当前代码中已不再出现（`lib/database/arena-ratings.ts` 已无窗口函数全表排名逻辑），这很符合“4B/日 → 2B/日”的下降现象。

接下来要继续从 2B/日压到 0.83B/日，需要优先处理 **“每次请求都会把大表整张扫一遍/多遍”** 这类读放大，而不是微调小查询。

---

## 1. 当前仓库内最可疑的高读放大点（按 ROI 排序）

### 1.1 数据卡标签 `data_card_tags` 的“全表聚合再 JOIN”（极高 ROI）

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

### 1.2 公共排名（`publicRank/publicTotal`）的 COUNT 计算（高 ROI，且价值可谈）

命中位置（尚未改动，建议按方案处理）：

- `pages/api/data-card-meta.ts`
  - `publicTotal`：strict/free 各 1 次 `COUNT(*)`（带 `arena_ratings` + `data_cards` JOIN 与复杂 eligibility 条件）
  - `publicRank`：对单卡做 `COUNT(*) as higherCount`（带多重 OR tie-break 条件）
- `pages/api/me/profile-card.ts`
  - `publicTotal`：1 次 `COUNT(*)`
  - `publicRank`：对多张卡重复执行 `higherCount` 计数（最多 7 次）

这类 query 的特点是：

- **很难做到“精确 rank + 低 Rows Read”**：rank 本质是“你前面有多少人”，即使有索引也需要扫描前缀；
- 业务价值可被替代：可以用“约/分位段/只在排行榜页展示精确名次”等方式降级。

> 结论：如果你们确实希望继续显著降读，这是下一块必须动的地方。

---

### 1.3 排行榜（`/api/arena/leaderboard*`）的标签聚合 JOIN（中高 ROI）

命中位置（已修复，见 §2）：

- `pages/api/arena/leaderboard.ts`
- `pages/api/arena/leaderboard/search.ts`

问题点：`LEFT JOIN data_card_tags` + `GROUP BY` + `group_concat(DISTINCT ...)` 会把“本来可能走 `arena_ratings(queue, rating)` 索引的分页查询”，变成更重的聚合查询，并额外读取大量 tag 行。

---

### 1.4 榜单搜索的全量 `ROW_NUMBER()` 排名（中 ROI，但需防滥用）

`pages/api/arena/leaderboard/search.ts` 仍然存在：

- 先构建 base（潜在接近全量）
- 再 `ROW_NUMBER() OVER (...)` 做全量排名
- 最后再按关键词过滤

这类模式即使做了 rate limit，也属于“被爬虫/脚本打到就会很痛”的查询。  
建议：把搜索改成“先找候选实体，再查其 rating/段位”，不要在搜索接口里算全量 rank（见 §3.3）。

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

## 3. 下一步“高性价比继续降读”方案（建议按优先级推进）

### 3.1 第一优先：砍掉/降级 `publicRank/publicTotal` 的精确计算

推荐路径（从激进到保守）：

**方案 A（最推荐，止血型）**  
默认不计算 `publicRank/publicTotal`（返回 `null`），只在：

- 排行榜页面（`/api/arena/leaderboard`）展示“列表名次”
- 或者用户主动点开“显示名次”时，才触发额外接口

优点：对 Rows Read 的下降最直接；缺点：产品上“名次”不再处处可见。

**方案 B（折中）**  
仍提供名次，但做“近似名次”：

- 返回 `rankApprox`（例如：`"约 1.2k 名"` / `"前 5%"`）
- 近似值来自“按 rating 分桶的直方图/分位点缓存”（每 10~60 分钟刷新一次）

这能把每次请求的成本降为 **1~2 个小查询**，避免 per-card `COUNT(*)` 扫描。

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

### 3.3 第三优先：重写排行榜搜索，避免“先全量排名再过滤”

建议 SQL/流程（思路，不是唯一解）：

1) 先在 `data_cards`（`name/description`）和 `users.username` 上做 LIKE 搜索，取少量候选 `dataCardId`（例如 50）
2) 再 JOIN `arena_ratings` 读取这些候选的 rating/games/段位，最后按业务排序输出
3) “rank”字段可以：
   - 不展示（仅展示 rating/tier）
   - 或展示“列表序号”（不是全榜名次）

这样 Rows Read 规模与“候选集大小”相关，而不是与“全榜规模”相关。

---

## 4. 建议的验证方式（你们需要在 Cloudflare 控制台做）

建议对比上线后 24 小时的：

1) Rows Read 总量：是否显著下降；目标是逐步逼近 **0.83B/日**  
2) Top Queries 是否从以下关键字中“消失/显著下降”：
   - `GROUP BY data_card_id` + `group_concat(DISTINCT tag_id)`（全表 tag_map）
   - `COUNT(*) as higherCount`（名次计算）
   - `ROW_NUMBER() OVER`（搜索榜单）
3) 关键页面 P95 延迟：榜单/公共卡列表/个人页是否同步变快（通常会）

---

## 5. 建议的下一步协作方式（落地节奏）

为了快速达标，建议按两阶段推进：

1) **本周内（止血）**：先选定 3.1 的 A/B（产品可接受的降级方案），把 `publicRank/publicTotal` 从热路径移除或改成近似。  
2) **随后（治理）**：统一 stats 缓存出口 + 重写榜单搜索，进一步对抗爬虫/滥用带来的读放大。

