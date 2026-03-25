# Strict 赛季最高/最低分设计稿

日期：2026-03-24  
状态：已完成首轮设计，待人工评审  
范围：当前赛季、仅 `strict`、公开展示

---

## 1. 背景

当前项目的排位对象是“角色卡的公共强度/稳定性指标”，而不是用户账号段位。  
这带来一个体验问题：

- 用户会把“自己亲手打上去的分”理解为个人成就；
- 但 live strict rating 会继续被后续公开挑战改变；
- 于是出现“我辛苦打上去，过段时间又被别人打下来了”的挫败感。

本次设计不改变 live 排位逻辑，也不引入掉段保护。  
目标是新增一层“本赛季已经达到过/跌到过哪里”的公开信息，保留成就感，同时不污染当前榜单。

---

## 2. 本次已确认口径

来自本轮讨论，以下口径已固定：

1. 第一版 **只做 `strict`**，不做 `free`
2. 信息为 **公开信息**
3. 记录内容是：
   - 本赛季 strict **最高分**
   - 本赛季 strict **最低分**
4. “最低分”按 **本赛季真实出现过的最低 strict rating** 记录，不做“至少不低于赛季起始分”的保护性修饰
5. `seasonPeakRating / seasonLowRating` 对应的基础段位仍可由 `rating + games` 按当前规则换算
6. 额外记录 `seasonPeakTier`，含义是：**本赛季达到过的最高 strict 显示段位**，允许取值到 `女王`

---

## 3. 关键约束

### 3.1 段位并不只由分数决定

当前段位函数 [`lib/arena/tier.ts`](../../../lib/arena/tier.ts) 中：

- `games < 5` 时，无论 rating 多高，都还是 `无牌`
- 否则才按 `800 / 1000 / 1200 / 1500` 分段映射

因此如果只记录“赛季最高分 / 最低分”，则**无法可靠推导当时对应段位**。  
为了保证展示口径准确，本次设计必须同时记录：

- 极值发生时的 `games`

### 3.2 “女王”不能由最高分直接倒推

当前 `女王` 不是纯分数段位，而是“当前 public strict 榜首资格”衍生结果。  
这意味着：

- `seasonPeakRating + seasonPeakGames` 可以稳定推导出基础段位：`无牌 / 白牌 / 字牌 / 花牌 / 权杖`
- 但**不能可靠倒推出“本赛季是否曾达到女王”**

因此本次设计规定：

- `赛季最高分/最低分` 继续记录真实数值
- `赛季最高分/最低分` 的基础段位仍可由 `rating + games` 推导
- 另单独存 `seasonPeakTier`，用于表达“本赛季曾达到过的最高 strict 显示段位”，允许为 `女王`
- **不新增 `seasonLowTier`**，避免赛季初 `games < 5` 导致大多数卡都落成 `无牌`，信息量过低

当前 live rating 的当前段位仍可继续按现有逻辑使用 `applyQueenTier(...)`

---

## 4. 方案选择

本次对三个数据落点做了比较：

### 方案 A：直接扩 `arena_ratings`（推荐）

优点：

- 最符合当前仓库架构
- 当前赛季 live 数据本来就集中在 `arena_ratings`
- 结算热路径只需顺手更新同一行
- `data-card-meta` / `me/profile-card` 读取链路改动最小
- `season-soft-reset` 与 `resetStrictArenaRatingForDataCard(...)` 都能顺手重置

缺点：

- 只适合“当前赛季极值”，不直接承载跨赛季历史明细

### 方案 B：新建 `arena_rating_season_stats`

优点：

- 更正统，后续扩展多赛季明细更舒服

缺点：

- 第一版明显过重
- 需要更多写路径与读路径协调
- 不符合当前“D1 仅存当前赛季 live 状态”的现有惯例

### 方案 C：读 `arena_rating_events` 现算

优点：

- 不改主表

缺点：

- 读量更高
- 赛季边界更难收束
- 当前详情页/个人页会变重

### 结论

第一版采用 **方案 A：直接扩 `arena_ratings`**

---

## 5. 数据模型设计

### 5.1 数据库字段

在 `arena_ratings` 中新增以下列：

- `season_peak_rating INTEGER`
- `season_peak_games INTEGER`
- `season_peak_at TEXT`
- `season_peak_tier TEXT`
- `season_low_rating INTEGER`
- `season_low_games INTEGER`
- `season_low_at TEXT`

命名原因：

- 数据库层保持 `snake_case`
- 业务/API 层映射为 `camelCase`
- 与现有 `last_delta / last_applied_at` 风格一致

### 5.2 Drizzle Schema

同步扩展：

- [`lib/db/schema/business.ts`](../../../lib/db/schema/business.ts)
- [`lib/database/schema.sql`](../../../lib/database/schema.sql)

### 5.3 类型映射

扩展现有 `DataCardArenaRatingRow` 与相关 DTO：

- 仓储层：新增 season peak/low 字段
- API 层：对外返回可直接渲染的结构

推荐的 API 结构：

```ts
type ApiRatingSeasonExtreme = {
  rating: number;
  games: number;
  occurredAt: string;
  tier: string; // 基础段位；若为 seasonPeak，仅表示“最高分对应的基础段位”
};

type ApiRating = {
  queue: 'strict' | 'free';
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
  lastDelta: number | null;
  lastAppliedAt: string | null;
  publicRank: number | null;
  publicTotal: number | null;
  seasonPeak: ApiRatingSeasonExtreme | null;
  seasonPeakTier: string | null; // 本赛季达到过的最高 strict 显示段位，可为“女王”
  seasonLow: ApiRatingSeasonExtreme | null;
};
```

说明：

- 虽然第一版只做 strict，但继续把字段挂在 `ApiRating` 上最顺
- `free` 先统一返回 `null`
- 这样后续若要扩 `free`，不需要再次改 DTO 形状

---

## 6. 结算与重置逻辑

### 6.1 排位结算时如何更新

落点：

- [`lib/database/arena-ratings.ts`](../../../lib/database/arena-ratings.ts)
- [`lib/db/repositories/arena-ratings-write.ts`](../../../lib/db/repositories/arena-ratings-write.ts)

规则：

1. 仅当 `queue='strict'` 且事件状态最终为 `applied` 时更新 season extrema
2. 使用 **结算后的 `afterRating / afterGames`** 参与比较
3. 若 `seasonPeakRating IS NULL`：
   - 初始化 peak 为当前结算后值
4. 若 `afterRating > seasonPeakRating`：
   - 更新 peak 的 `rating / games / at`
5. 若 `afterRating == seasonPeakRating`：
   - **不覆盖**
   - 保留首次达到该 peak 的时间
6. `seasonPeakTier` 记录“本赛季达到过的最高 strict 显示段位”：
   - 先根据 `afterRating / afterGames` 计算基础段位
   - 若该实体在本次结算后成为当前 public strict `女王`，则本次显示段位记为 `女王`
   - 按顺序 `无牌 < 白牌 < 字牌 < 花牌 < 权杖 < 女王` 比较
   - 若本次显示段位高于已存 `seasonPeakTier`，则更新
7. low 同理：
   - `seasonLowRating IS NULL` 时初始化
   - `afterRating < seasonLowRating` 时更新
   - 相等时不覆盖

推荐伪代码：

```text
if queue == 'strict' and status == 'applied':
  if seasonPeakRating is null or afterRating > seasonPeakRating:
    seasonPeakRating = afterRating
    seasonPeakGames = afterGames
    seasonPeakAt = appliedAt

  currentDisplayTier = currentBaseTier
  if currentEntityIsStrictQueen:
    currentDisplayTier = '女王'

  if seasonPeakTier is null or currentDisplayTier outranks seasonPeakTier:
    seasonPeakTier = currentDisplayTier

  if seasonLowRating is null or afterRating < seasonLowRating:
    seasonLowRating = afterRating
    seasonLowGames = afterGames
    seasonLowAt = appliedAt
```

### 6.2 严格排位分被重置时如何处理

当前存在 [`resetStrictArenaRatingForDataCard(...)`](../../../lib/db/repositories/arena-ratings-write.ts)：

- 角色卡 JSON 正式变更后，strict rating 会被重置

为了保持语义一致，本次设计要求：

- 在 strict rating 被重置时，**同时重置 season peak/low**
- 同时把 `seasonPeakTier` 重置为 reset 后的当前显示段位（按当前规则通常为 `无牌`）
- 重置值设为：
  - `seasonPeakRating = initialRating`
  - `seasonPeakGames = 0`
  - `seasonPeakAt = nowIso`
  - `seasonPeakTier = '无牌'`
  - `seasonLowRating = initialRating`
  - `seasonLowGames = 0`
  - `seasonLowAt = nowIso`

原因：

- 角色卡内容已发生实际变化，旧版本赛季成绩不应继续挂到新版本 strict 身上

### 6.3 赛季 soft reset 时如何处理

落点：

- [`lib/db/repositories/season-soft-reset.ts`](../../../lib/db/repositories/season-soft-reset.ts)
- Runbook：[`docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md`](../../../docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md)

本次设计要求：

- 执行 soft reset 时，除了现有 `rating / games / wins / losses / draws` 回收/清空外，
- 还要把 season extrema **同步重置为 reset 后的新当前值**

即：

- `season_peak_* = reset 后 rating / 0 / now`
- `season_peak_tier = '无牌'`
- `season_low_* = reset 后 rating / 0 / now`

理由：

- 新赛季从 soft reset 结果开始计；
- reset 后的 strict rating 是本赛季真实存在过的初始状态；
- 这与“最低分记录真实出现过的数值”口径一致

---

## 7. 存量数据迁移与回填

### 7.1 无法精确回放历史极值

当前线上已有 `arena_ratings` 行，但过去并未记录本赛季 high/low。  
因此上线后无法准确补出“本赛季截至今天之前的真实 peak/low”。

### 7.2 第一版回填策略

推荐迁移策略：

- 对现存 `queue='strict'` 行：
  - `season_peak_rating = rating`
  - `season_peak_games = games`
  - `season_peak_at = updated_at`
  - `season_peak_tier = 按当前 rating + games 推导出的基础段位`
  - `season_low_rating = rating`
  - `season_low_games = games`
  - `season_low_at = updated_at`

这是一个**保守快照初始化**，含义是：

- “从本次上线/迁移时刻开始，系统可继续可信追踪后续极值”
- 但“本赛季上线前是否曾更高/更低”，本期无法精确回溯

建议在实现说明中明确记录这个限制，避免后续误以为已完成精确历史回填。

---

## 8. API 设计

### 8.1 `/api/data-card-meta`

文件：

- [`pages/api/data-card-meta.ts`](../../../pages/api/data-card-meta.ts)

扩展：

- 在 `ratings.strict` 中返回 `seasonPeak` / `seasonLow`
- `ratings.free` 先返回 `null`

用途：

- 角色卡详情页
- 排行榜实体详情弹窗
- 竞技场参战者拉取详情时的公共信息扩展（若后续需要）

### 8.2 `/api/me/profile-card`

文件：

- [`pages/api/me/profile-card.ts`](../../../pages/api/me/profile-card.ts)

扩展：

- `topRatedCharacter.ratings.strict` 增加 `seasonPeak` / `seasonLow` / `seasonPeakTier`
- `topCards.characters[*].ratings.strict` 第一版 **可不扩**

原因：

- 个人页最核心的是“我的最高排位角色”
- 先把新增信息聚焦在这个入口，避免资料卡导出区域过满

---

## 9. UI 落点

### 9.1 角色卡详情页：必须展示

文件：

- [`components/DataCardDetailsModal.tsx`](../../../components/DataCardDetailsModal.tsx)

原因：

- 当前这里已经展示技术值、标签、strict/free 当前 rating
- 赛季高/低是对当前 rating 的补充，语义最自然

推荐展示方式：

```text
严格 1260（花牌，Δ+18）
赛季最高 1332（花牌）
赛季最高段位 女王
赛季最低 987（白牌）
```

细节建议：

- 放在 strict 这一组信息的次级行，不要和 free 混在同一句长文本里
- `occurredAt` 可作为 `title` 或较弱样式展示，不强占主视觉

### 9.2 排行榜列表：第一版不展示

文件：

- [`components/ranking/RankingPage.tsx`](../../../components/ranking/RankingPage.tsx)

原因：

- 列表本身已经很密
- 当前榜单的主语义是“当前分”，不是“赛季履历”
- 把赛季 peak/low 塞进列表会稀释排序意义，并明显增加噪音

### 9.3 排行榜详情弹窗：自动获得，无需单独加入口

文件：

- [`components/ranking/LeaderboardEntityDetailsModal.tsx`](../../../components/ranking/LeaderboardEntityDetailsModal.tsx)

原因：

- 该弹窗内部实际复用角色卡详情模态
- 只要 `data-card-meta` 与 `DataCardDetailsModal` 扩了，排行榜详情自然就有

### 9.4 个人页：展示在“最高排位角色”上

文件：

- [`components/me/ProfileCard.tsx`](../../../components/me/ProfileCard.tsx)

建议：

- 第一版只在 `topRatedCharacter` 区域展示赛季 high/low
- 不强行给所有 `topCards.characters` 小卡都加

推荐文案：

```text
当前 strict：1260（花牌）
赛季最高：1332（花牌）
赛季最高段位：女王
赛季最低：987（白牌）
```

理由：

- 个人页是“成就感”最强入口
- 但导出卡信息密度有限，必须聚焦最重要的角色

---

## 10. 非目标

本次不做：

1. `free` 的赛季 high/low
2. 最近排位记录/防守记录
3. 排行榜行级展示赛季 high/low
4. `seasonLowTier`
5. 新建独立赛季统计表

---

## 11. 测试建议

### 11.1 单元测试

建议补到：

- [`tests/arena-ratings.test.ts`](../../../tests/arena-ratings.test.ts)
- [`tests/arena-tier.test.ts`](../../../tests/arena-tier.test.ts)

覆盖：

1. strict applied 时首次初始化 peak/low
2. strict 胜利抬高 peak
3. strict 失败刷新 low
4. strict 达到更高显示段位时刷新 `seasonPeakTier`
5. strict 成为 `女王` 时刷新 `seasonPeakTier='女王'`
6. free applied 不影响 strict season extrema
7. equal peak/equal low 不覆盖时间
8. `computeArenaBaseTier(seasonPeakRating, seasonPeakGames)` 的换算符合预期

### 11.2 API 测试

建议补到：

- `data-card-meta` 相关测试
- `me/profile-card` 相关测试

覆盖：

1. strict 返回 `seasonPeak/seasonLow`
2. free 返回 `null`
3. 未参与 strict 时 season extrema 也应有合理值（迁移后/重置后）

### 11.3 赛季 reset / strict reset 测试

覆盖：

1. `resetStrictArenaRatingForDataCard(...)` 会同步重置 extrema
2. season soft reset 会同步刷新 extrema

---

## 12. 推荐实施顺序

1. 扩 `arena_ratings` schema 与 Drizzle schema
2. 写迁移 / 回填脚本
3. 扩 strict 结算写路径
4. 扩 strict reset 与 season soft reset
5. 扩 `data-card-meta`
6. 扩 `me/profile-card`
7. 更新 `DataCardDetailsModal`
8. 更新 `ProfileCard`
9. 补测试

---

## 13. 最终结论

第一版“赛季最高/最低 strict 分”应当：

- **数据上落在 `arena_ratings`**
- **逻辑上只跟 `strict` 绑定**
- **展示上优先进入角色卡详情页与个人页**
- **排行榜列表不展示，但排行榜详情弹窗自动可见**

并且必须记住两个实现细节：

1. **要同时记录 `games`，否则段位换算不准**
2. **`seasonPeakTier` 单独承载“本赛季达到过的最高 strict 显示段位”，可记录 `女王`**
