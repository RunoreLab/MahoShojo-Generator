# D1 Rows Read 超额排查（2026-01）

更新时间：2026-01-29  
范围：本仓库（Next.js + Cloudflare Edge Runtime + Cloudflare D1）中所有 `queryFromD1()` 读路径 + 结合你提供的 D1 Query Insights 截图进行定位。

> 结论先行：**最可能导致 2026 年 1 月 Rows Read 爆炸的根因**不一定是截图里那条聚合统计 SQL，而是 **`arena_ratings` 的“排名计算”在每次排位结算时做了全表窗口函数扫描**（`ROW_NUMBER() OVER (...)` + `COUNT(*) OVER()`），且在一次结算里会执行多次；当 1 月上线排位/榜单后，生成战报频率越高，Rows Read 以“对局次数 × 排位实体总量 × 扫描次数”线性增长，非常容易月度超额。

---

## 1. 你提供的现象与直接风险

截图中高 Rows Read 的可疑 SQL（你补充的那条）特点：

- 单次查询包含大量子查询 `SELECT COUNT(*) ...`，会对同一张表做**重复扫描**（尤其是 `arena_rating_events`）。
- 使用 `DATE(created_at) = DATE('now', 'localtime')` 这种形式会让 SQLite **难以利用 `created_at` 索引**（对列做函数包裹通常会阻断索引范围扫描），容易退化成全表扫。
- 两段 `arena_ratings ar JOIN data_cards dc ...` 的 `COUNT(*)` 需要同时读 `arena_ratings` 与 `data_cards`，若缺少合适的组合索引，会进一步放大读取。

即便该查询本身在截图中 `Count = 10`，**它的“每次执行 Rows Read 极高”依然说明：同类统计查询/窗口函数/全表扫在系统里确实存在**，应优先消除这类模式。

补充：我在仓库内全文搜索（含 `pages/`、`lib/`、`scripts/`）**未找到**你贴的 SQL 原文/别名（如 `arenaRatingsStrictTotal`），因此它可能来自：

- 你/同事在 D1 控制台手工执行的查询；
- 某个未入库的运维/监控脚本；
- 或历史版本代码（但当前分支已改写/拆分）。

不过：它所表达的“统计口径”在代码里存在等价实现（见下文）。

---

## 2. 仓库内 D1 Read 路径盘点（按模块）

我以 `queryFromD1(` 为入口对调用点做了枚举，主要分布在：

- Arena / 排位：`lib/database/arena-ratings.ts`、`lib/arena/tier.ts`、`pages/api/arena/*`
- 数据卡：`lib/database/data-cards.ts`、`pages/api/public-data-cards.ts`、`pages/api/data-card-meta.ts`、`pages/api/data-card-meta-batch.ts`
- 用户/资料卡：`lib/database/users.ts`、`pages/api/me/profile-card.ts`
- 其他：徽章/标签/PVP/战报等（通常带 `LIMIT` 或主键查询，读放大相对可控）
- 维护脚本：`scripts/backfill-data-card-tech-index.ts`、`scripts/season-soft-reset.ts` 等（可能在 1 月被运行过，会产生阶段性大读）

其中 **高风险读放大点**集中在 “Arena 排位 + 榜单相关查询”。

---

## 3. 头号嫌疑：排位结算期间的全表窗口函数扫描

### 3.1 触发路径

排位结算在多处生成 API 中调用：

- `pages/api/arena/generate.ts`：`settleArenaRatingsForGeneration(recordId)`
- `pages/api/arena/generate-stream.ts`：`settleArenaRatingsForGeneration(generationId)`
- `pages/api/generate-battle-story.ts`：`settleArenaRatingsForGeneration(recordId)`
- `pages/api/arena/generation-ranking.ts`：自愈时也会触发（次要）

核心实现位于：

- `lib/database/arena-ratings.ts`：`settleArenaRatingsForGeneration()`

该“写入 ranks（before/after/total）”的逻辑在 `git blame` 中显示为 **2026-01-05 引入（commit `9d56a26`，提交信息：`feat: 战报严格排位信息展示`）**，与“2026 年 1 月 Rows Read 突然抬升”的时间窗口高度吻合。

### 3.2 关键高读查询

`lib/database/arena-ratings.ts` 内部为了写入“名次变化/总人数”等信息，调用了：

- `getArenaRanksForEntities(queue, [a, b])`

该函数使用窗口函数对整张 `arena_ratings` 做排序并为**每一行**计算 `ROW_NUMBER()` + `COUNT(*) OVER()`：

```sql
WITH ordered AS (
  SELECT
    entity_type,
    entity_id,
    ROW_NUMBER() OVER (ORDER BY rating DESC, games DESC, updated_at DESC, entity_type ASC, entity_id ASC) AS rank,
    COUNT(*) OVER () AS total
  FROM arena_ratings
  WHERE queue = ?
)
SELECT entity_type, entity_id, rank, total
FROM ordered
WHERE (entity_type = ? AND entity_id = ?)
   OR (entity_type = ? AND entity_id = ?)
```

**即使最终只取 2 个实体的 rank，窗口函数仍需要扫描并排序 queue 下所有行**（Rows Read ≈ `arena_ratings` 该 queue 的行数）。

更关键的是：`settleArenaRatingsForGeneration()` 对每个可结算队列（`strict`/`free`）可能会调用该函数：

- 结算前：一次（before）
- 结算后：一次（after）
- 某些重试/幂等分支：额外一次（after）

因此单次对局在最坏情况下会产生：

- `free` 2~3 次全表扫 + `strict` 2~3 次全表扫
- Rows Read 近似：`(2~6) × |arena_ratings(queue)|` / 场

当 1 月上线排位并有真实用户对局后，Rows Read 会被这个逻辑快速拉爆。

### 3.3 为什么 1 月会突然超额

从 `git log --since=2026-01-01` 观察，Arena 排位/榜单功能在 2026-01-02 ~ 2026-01-06 集中落地（包含“排行榜搜索”“女王段位”“严格排位计分实时指示器”等）。这类功能上线后：

- 对局触发排位结算（写入 + 读 ranks）
- 榜单页面/战报页面也会触发额外读（女王/榜单/排行）

导致 Rows Read 从“少量主键查询”为主，转变为“高频全表扫”为主。

### 3.4 与 1 月变更的对应关系（便于回溯）

（以下为与 Rows Read 直接相关的“行为变化”，不是功能价值判断）

- 2026-01-03：引入 Arena 排位表与结算（`arena_ratings`/`arena_rating_events`），读写开始进入热路径。
- 2026-01-04：引入“女王”段位查询（CTE eligible + TOP1），多处 API 会重复调用，若不缓存会变成稳定读放大源。
- 2026-01-05：引入“排行榜搜索”（CTE + `ROW_NUMBER()`），在被高频调用时会全量扫描榜单基表。
- 2026-01-05：引入“战报严格排位信息展示”（commit `9d56a26`），在 `settleArenaRatingsForGeneration()` 内写 ranks，触发“每场对局多次全表 rank 扫描”，这是最容易直接打爆 Rows Read 的点。
- 2026-01-06：严格排位匹配/榜单过滤逻辑增强，可能增加 `data_cards`/`arena_ratings` 的扫描复杂度（但一般不如 ranks 扫描致命）。

---

## 4. 次级嫌疑：榜单/段位相关的反复统计与扫描

### 4.1 女王段位查询（会扫 eligible）

`lib/arena/tier.ts` 的 `queryArenaPublicQueenEntity()` 使用 CTE 构建 eligible 集合，并在其上统计 + 取 TOP1。

此查询在多个 API 中被调用（例如 `pages/api/arena/leaderboard.ts`、`pages/api/arena/preset-meta.ts`、`pages/api/data-card-meta.ts`、`pages/api/me/profile-card.ts`），若不做缓存，会把“扫表”成本分摊到大量请求上。

### 4.2 榜单接口（JOIN + GROUP BY + group_concat）

`pages/api/arena/leaderboard.ts` 及 `pages/api/arena/leaderboard/search.ts` 会对 `arena_ratings` 与 `data_cards/users/data_card_metrics/data_card_tags` 做多表 JOIN，并 `GROUP BY` 聚合标签：

- 普通榜单：可控（`LIMIT/OFFSET`）
- 搜索榜单：使用 CTE + `ROW_NUMBER() OVER (...)`，会先构建 base 并对其做全量排名，**在被滥用/爬虫抓取时读放大显著**

### 4.3 单卡 Meta/用户资料卡中的 COUNT 口径

- `pages/api/data-card-meta.ts`：对角色卡会计算 `strict/free` 两个 `publicTotal`（`COUNT(*)` + JOIN/过滤条件）
- `pages/api/me/profile-card.ts`：会计算 `publicTotal` + `publicRank`（`COUNT(*)` + 复杂 OR 条件）

这些查询属于“统计类”，非常适合做 **缓存** 或 **预计算**。

---

## 5. 你贴的统计查询：等价改写建议（降低 Rows Read）

### 5.1 合并多次 COUNT 扫描（arena_rating_events）

原查询对 `arena_rating_events` 做了多次 `COUNT(*)` 子查询，并对 `created_at` 施加 `DATE()` 函数。

建议改写思路：

1) **把“今天”换成范围**（在应用层计算 `dayStartIso/dayEndIso`，用 `created_at >= ? AND created_at < ?`），避免 `DATE(created_at)`；  
2) 用一次扫描完成多个计数：`SUM(CASE WHEN ... THEN 1 ELSE 0 END)`；  
3) 若需要按 queue 区分，可加 `WHERE queue IN (...)` 并用 `GROUP BY queue`。

示例（单次扫描 + 范围）：

```sql
SELECT
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingTotal,
  SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS todayTotal,
  SUM(CASE WHEN created_at >= ? AND created_at < ? AND status = 'applied' THEN 1 ELSE 0 END) AS appliedTodayTotal,
  SUM(CASE WHEN created_at >= ? AND created_at < ? AND status = 'skipped' THEN 1 ELSE 0 END) AS skippedTodayTotal,
  SUM(CASE WHEN created_at >= ? AND created_at < ? AND status = 'failed' THEN 1 ELSE 0 END) AS failedTodayTotal
FROM arena_rating_events;
```

> 进一步优化：如果“今日统计”是高频展示项，建议做 **按日汇总表**（见 6.2）。

### 5.2 leaderboardEligible 统计

你贴的两段 join count 本质上是“可上榜 data_card 实体数”。在代码中已有多个地方实现类似口径（女王/公共总人数/资料卡 rank）。

建议统一出口：

- 新增一个 `GET /api/arena/leaderboard-stats`（或仅内部使用函数），一次查询把 strict/free + 可上榜数量 + 今日事件统计取齐；
- **强制缓存**（见 6.1），避免每个页面/组件分散重复查。

---

## 6. 应对方案（按优先级）

### 6.1 立刻止血（当天可做）

1) **停掉排位结算过程中的全表 rank 扫描**
   - 方案 A（推荐，最低风险/最高收益）：`settleArenaRatingsForGeneration()` 不再写 ranks（before/after/total），仅写 Elo delta；rank 信息改为“展示端按需计算 + 缓存”。
     - 优点：直接移除“对局触发的全表扫”，Rows Read 断崖式下降
     - 缺点：战报里“名次变化”需要展示端额外查询（但可以做强缓存/按需）
   - 方案 B（折中，保留 ranks 但不全表扫）：把 rank 计算改为“仅针对 2 个实体的 `higherCount + 1` 计数法”，并配合索引优化。
     - 优点：保留原功能（before/after rank），读量通常小于窗口函数全表扫
     - 缺点：仍然是每场对局额外读；在大盘高对局量时仍可能吃掉配额；实现复杂度更高（需要处理 tie-break）
   - 方案 C（工程化最佳，但成本高）：引入 `arena_rank_snapshots` 之类的快照表，由定时任务/后台批处理周期性刷新（例如每 1~5 分钟），结算流程只写分数不算 rank。
     - 优点：把“rank 计算”彻底从热路径移出；可控、可观测
     - 缺点：需要额外表设计与刷新机制

2) **对公共 GET 榜单/统计接口加缓存**
   - Cloudflare 环境可用 `caches.default` / Cache API（或依赖 CDN Cache-Control）
   - TTL 建议：`10s~60s`（足够降低 Rows Read，同时保证榜单“看起来实时”）
   - 优先缓存：`/api/arena/leaderboard`、`/api/arena/leaderboard/search`（并加 rate limit）、女王/公共总数统计出口

3) **前端避免 N+1：优先使用批量接口**
   - 列表页/多卡展示尽量改用 `pages/api/data-card-meta-batch.ts`，避免对每张卡单独 hit `data-card-meta`。

### 6.2 中期优化（1~3 天）

1) **为 arena_rating_events 增加更贴合查询的索引**
   - 常见读：`status='pending'`、`created_at` 范围、`queue+status+created_at`
   - 可考虑新增：
     - `(status, created_at)`
     - `(queue, status, created_at)`

2) **建立按日汇总表，替代“今日 COUNT 扫表”**
   - 新表：`arena_rating_event_daily_stats(date, queue, applied, skipped, failed, pending, total, updated_at)`
   - 写入时（事件状态变更）做 `UPSERT` 增量更新；或定时任务每 5 分钟聚合刷新

3) **对 leaderboardEligible / publicTotal 统一缓存/预计算**
   - 将多个 API 内分散的 `COUNT(*)` 合并为一个缓存结果，避免重复读

### 6.3 长期治理（1~2 周）

1) **为 D1 查询加“可识别的 name 标记”**
   - 例如在 SQL 前加注释 `-- name: arena_ranks_for_entities`，便于在 Query Insights 中快速定位来源

2) **对高成本接口做防滥用**
   - 榜单搜索增加最小间隔、IP 限流、必要时要求登录

3) **把统计类数据迁出 D1 热路径**
   - 例如写入 Analytics Engine / KV / R2 + 离线聚合，再由 API 读取轻量结果

---

## 7. 建议的验证步骤（确保修复有效）

1) 在 D1 Query Insights 里按关键字过滤并对比修复前后：
   - `ROW_NUMBER() OVER`、`COUNT(*) OVER`、`FROM arena_ratings WHERE queue`
2) 观察以下指标在 24h 内的变化：
   - Rows Read 总量
   - Top queries 的 Rows Read 占比是否明显下降
   - P95 Latency 是否同步改善（通常会）
3) 对关键查询执行 `EXPLAIN QUERY PLAN`（在 D1 控制台或本地 sqlite 同 schema）确认索引命中情况。

---

## 8. 我建议的下一步（需要你确认范围）

如果你希望我直接在代码里“止血”，我建议优先落地：

- 移除/异步化 `settleArenaRatingsForGeneration()` 内的 ranks 扫表（最高收益）
- 为 `/api/arena/leaderboard` 增加短 TTL 缓存（次高收益，风险可控）

我也可以先做一个最小 PR：只加统计/缓存与查询标记（`-- name:`），不改业务行为，用于你们观察 Query Insights 变化。

---

## 9. 玩法级方案评估：移除排位匹配、手选对手、区间计分（针对 Rows Read 的“硬降载”）

> 背景：本次审计已定位并处理过“热路径全表扫”的最大雷区（结算 ranks 的窗口函数全表扫描、榜单接口缓存与搜索限流等）。如果 **Rows Read 仍然超额**，下一波最可能的稳定大读来源就是 **严格排位匹配接口**（`POST /api/arena/ranked-matchmaking`）里为“找对手”做的多次候选查询。
>
> 该接口当前实现会在一次请求中执行多次类似查询（按 `STRICT_MATCHMAKING_BANDS` × 候选池 played/rated/public × allowRepeat 两轮），且 SQL 使用 `ABS(...)`/`COALESCE(...)` 参与 `WHERE/ORDER BY`，对 SQLite/D1 来说非常容易退化为 **“扫描大量公开角色卡 + 排序后取 LIMIT”** 的模式；这类查询一旦跟随“每局一次匹配”高频触发，就会变成稳定的 Rows Read 消耗点。

下面按你提出的 3 条措施逐条讨论“对 Rows Read 的优化效果”与“是否值得做”。

### 9.1 措施 1：彻底移除排位匹配相关代码，改为用户自行选择排位赛对手

**对 Rows Read 的效果（强）**

- 这是一个**直接砍掉高频/高成本查询**的方案：把“服务端搜索候选对手”的多次扫描/排序，替换为“用户从现成列表挑选 1 个对手”。
- 从数据库视角，复杂度从近似 `O(公开候选总量 × 查询次数)` 下降为 `O(1)`（校验对手可用性 + 读取 2 个实体分数/或仅签发票据）。
- 结合现有 **榜单接口短 TTL 缓存**，用户选择对手所依赖的榜单/筛选请求，可更多落在缓存命中而不是 D1 读。

**工程/体验成本（中-高）**

- UI 需要提供“选对手”的入口：最自然的是复用现有的排行榜模态框/参战者列表作为对手选择器。
- 严格排位仍然应保留“服务端签发并验证票据”（`RankedMatchTicket`）这一道闸：避免纯前端拼装对局导致严格排位 eligibility 失控。

**主要风险（可控，但必须正视）**

- 最大风险不是技术，而是**刷分/互刷**：允许手选后，玩家可以刻意挑“容易赢的对手”，导致严格排位失真。
- 该风险可以由 9.3 的“区间计分 + UI 筛选 + 后端强校验”显著缓解；否则“手选但仍严格计分”在竞技意义上基本不可接受。

**结论**

- 如果目标是“**严格限制 D1 Rows Read，宁可牺牲部分玩法机制**”，此措施非常值得做，且收益通常大于做一堆 SQL 小修小补（因为它直接把高频大读从架构上移走）。
- 若团队仍希望保留“随机匹配”的竞技氛围，则应优先考虑“保留匹配但重写 SQL 走索引/改为离线候选池”的技术路线，而不是完全移除。

---

### 9.2 措施 2：定段期间，允许任意选择对手并计算严格排位分

**对 Rows Read 的效果（弱 / 不确定）**

- 该措施本身是“资格/规则”变更，对单局结算的 D1 读写量影响很小（结算已是主键读写为主）。
- 真正影响 Rows Read 的可能是**行为侧的二阶效应**：如果“任意选择 + 可计分”显著提高对局频率，那么总 Rows Read 可能反而上升（哪怕单局更省）。

**竞技与刷分风险（偏高）**

- 定段期（`games < ARENA_PLACEMENT_GAMES`）本来 K 因子更高、波动更大；若允许随意挑对手计分，容易出现“挑战高分低风险、赌一次爆分”的玩法。
- 还存在“故意停留在定段期”的动机：如果规则让定段期更容易刷分，玩家可能通过换卡/重置等方式长期利用。

**如果一定要做的建议约束（不改数据库结构也能做）**

- 将“定段期可计分”改为“**定段期可手选，但仍需满足更宽松的区间**”（例如 ±900 或按段位差一档），避免完全无门槛。
- 或：定段期计分照常，但**不进入榜单/不影响段位展示**（仅内部累计到定段完成后再公开），减少被当成“刷榜工具”的激励。

**结论**

- 单纯从 Rows Read 角度：这条不是关键杠杆；它更多是玩法设计决策。
- 除非你们明确需要“新手更快获得有效对局”的体验，否则不建议单独上线“定段期任意对手也严格计分”，至少需要配套约束。

---

### 9.3 措施 3：定段后，仅限与排名/段位分在一定范围内的对手对战才计算严格排位分；榜单模态框支持筛选；不满足则在严格排位指示中告知

**对 Rows Read 的效果（中）**

- 这条措施的核心价值是：**让“手选对手”不会迫使服务端做“匹配扫描”**。
- 实现得当时，筛选逻辑主要发生在客户端（基于榜单列表已有的 `rating/games/tier` 字段），并且榜单接口已有缓存 → 读成本可控。
- 对结算来说，“是否计 strict”只需要比较双方当前 rating/tier（结算时本来就会读到 `arena_ratings` 的两行），不会引入额外的大读。

**关键建议：不要用“rank 差”做强约束**

- “rank 差”天然需要全局排序或快照，历史上就是 Rows Read 的高风险来源（窗口函数/全表排序）。
- 更推荐用**rating 差（Elo 差）+ tier 差**表达“可计分范围”，既好解释，又不引入额外全表计算。

**推荐的区间口径（示例，可调参）**

- 以 **Elo rating 差**为主：例如定段后严格计分要求 `abs(playerRating - opponentRating) <= 900`（可按段位分层收紧：白牌±900、字牌±700、花牌±500、权杖±350）。
- 或用 **tier 差**做粗门槛：例如只允许同 tier 或相邻 tier（无牌/白牌/字牌/花牌/权杖/女王），再叠加 rating 差上限。

**前端/交互（建议）**

- 在排行榜模态框新增开关：「仅显示严格排位可计分对手」。
- 若当前已选参战者不可参与 strict（例如未登录/设置不满足/无票据/对手不在范围），在现有的严格排位指示器里直接给出“不可计分原因”（已经有 reasons 机制，新增 reason 即可）。

**结论**

- 这条措施本身对 Rows Read 的“直接下降”有限，但它是**允许你们把严格排位从“服务端匹配搜索”迁移到“客户端筛选 + 后端校验”**的关键配套。
- 如果你们决定执行 9.1（移除匹配），强烈建议把 9.3 作为“必须一起做”的护栏；否则 strict 排位会很快被刷穿。

---

## 10. 总结：从“省 Rows Read”视角的推荐组合

如果你们当前的目标非常明确：**D1 Rows Read 必须压到可控范围（硬指标优先）**，我建议的优先级是：

1) **执行措施 1（移除排位匹配大扫描）+ 执行措施 3（区间计分护栏）**：这是最能把高频大读从架构上移走的组合。
2) 措施 2（定段期任意对手也计分）：除非有明确的增长/新手体验诉求，否则先不要做；或者做“更宽区间”而不是“完全无门槛”。

验证方式建议仍然回到 D1 Query Insights：重点看 `ranked-matchmaking` 相关查询（特征通常包含 `ABS(`、`FROM data_cards`、`JOIN arena_ratings`）在改造前后的 Rows Read 占比变化。
