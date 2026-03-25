# Strict 赛季最高/最低分与赛季最高段位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为公开角色卡的 strict 排位新增“本赛季最高分 / 最低分 / 赛季最高显示段位”记录，并在角色卡详情页与个人页资料卡中展示。

**Architecture:** 直接扩展 `arena_ratings` 当前赛季 live 行，记录 strict 队列的 `seasonPeak / seasonLow / seasonPeakTier`。strict 结算在写入新 rating 后同步维护极值与赛季最高显示段位；strict reset 与 season soft reset 负责把这些字段重置到新赛季起点；读取链路继续复用 `data-card-meta` 与 `me/profile-card`，排行榜列表不加字段。

**Tech Stack:** Next.js Pages Router、Cloudflare Edge Runtime、Drizzle ORM、Cloudflare D1、TypeScript strict、Bun test、React Query

---

## 文件结构与职责

**段位与领域辅助**

- Modify: `lib/arena/tier.ts`
  - 新增 strict 显示段位比较辅助，统一 `无牌 < 白牌 < 字牌 < 花牌 < 权杖 < 女王` 顺序
- Modify: `lib/database/arena-ratings.ts`
  - 新增 strict 初始 season 状态 helper 与 extrema 纯计算 helper，便于单测与写路径复用

**数据与 schema**

- Modify: `lib/db/schema/business.ts`
  - 为 `arenaRatings` 增加 strict 赛季极值与 `seasonPeakTier`
- Modify: `lib/database/schema.sql`
  - 同步 SQLite DDL
- Create: `drizzle/0005_strict_season_extrema.sql`
  - 为线上 D1 加列并回填 strict 存量数据
- Modify: `lib/db/repositories/data-card-meta.ts`
  - 读取 `season_peak_* / season_low_* / season_peak_tier`
  - 为 queen 查询补 bypass cache 能力，供写路径复用
- Modify: `lib/db/repositories/arena-ratings-write.ts`
  - strict 结算、strict reset 同步维护 season extrema 与 `seasonPeakTier`
- Modify: `lib/db/repositories/season-soft-reset.ts`
  - season soft reset 时同步重置 season extrema 与 `seasonPeakTier`

**API**

- Modify: `pages/api/data-card-meta.ts`
  - 返回 `ratings.strict.seasonPeak / seasonLow / seasonPeakTier`
- Modify: `pages/api/me/profile-card.ts`
  - 返回 `topRatedCharacter.ratings.strict.seasonPeak / seasonLow / seasonPeakTier`

**展示层**

- Modify: `components/DataCardDetailsModal.tsx`
  - strict 排位区域展示赛季最高分、最低分、赛季最高段位
- Modify: `components/me/ProfileCard.tsx`
  - 在最高排位角色区域展示赛季最高分、最低分、赛季最高段位

**测试**

- Modify: `tests/arena-ratings.test.ts`
  - 覆盖 season extrema 与 `seasonPeakTier` 的纯规则
- Modify: `tests/season-reset.test.ts`
  - 覆盖 season soft reset 对 extrema / `seasonPeakTier` 的处理
- Create: `tests/data-card-meta-season-extrema.test.ts`
  - 覆盖 `data-card-meta` 的 row -> DTO 映射
- Modify: `tests/data-card-details-modal.test.ts`
  - 覆盖详情页 season extrema / `seasonPeakTier` 文案
- Create: `tests/profile-card-season-extrema.test.tsx`
  - 覆盖个人资料卡展示

**文档**

- Modify: `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md`
  - 补充 season soft reset 会同时刷新 season extrema 与 `seasonPeakTier`

---

### Task 1: 扩展 strict season extrema 数据模型与读取映射

**Files:**
- Modify: `lib/db/schema/business.ts`
- Modify: `lib/database/schema.sql`
- Create: `drizzle/0005_strict_season_extrema.sql`
- Modify: `lib/db/repositories/data-card-meta.ts`
- Modify: `lib/db/repositories/arena-ratings-write.ts`
- Test: `tests/data-card-meta-season-extrema.test.ts`

- [ ] **Step 1: 写 schema 合同的失败测试**

创建 `tests/data-card-meta-season-extrema.test.ts`，至少覆盖：

```ts
import { describe, expect, test } from 'bun:test';
import { arenaRatings } from '@/lib/db/schema/business';

describe('data-card-meta season extrema mapping', () => {
  test('arenaRatings schema exposes strict season extrema columns', () => {
    expect(arenaRatings.seasonPeakRating.name).toBe('season_peak_rating');
    expect(arenaRatings.seasonPeakGames.name).toBe('season_peak_games');
    expect(arenaRatings.seasonPeakAt.name).toBe('season_peak_at');
    expect(arenaRatings.seasonPeakTier.name).toBe('season_peak_tier');
    expect(arenaRatings.seasonLowRating.name).toBe('season_low_rating');
    expect(arenaRatings.seasonLowGames.name).toBe('season_low_games');
    expect(arenaRatings.seasonLowAt.name).toBe('season_low_at');
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/data-card-meta-season-extrema.test.ts`  
Expected: FAIL，原因是 schema 尚未暴露这些列，或测试文件尚不存在

- [ ] **Step 3: 为 `arena_ratings` 增加 season extrema 字段**

在 `lib/db/schema/business.ts` 的 `arenaRatings` 表定义中新增：

```ts
seasonPeakRating: integer('season_peak_rating'),
seasonPeakGames: integer('season_peak_games'),
seasonPeakAt: text('season_peak_at'),
seasonPeakTier: text('season_peak_tier'),
seasonLowRating: integer('season_low_rating'),
seasonLowGames: integer('season_low_games'),
seasonLowAt: text('season_low_at'),
```

在 `lib/database/schema.sql` 的 `CREATE TABLE IF NOT EXISTS arena_ratings` 中同步新增：

```sql
  season_peak_rating INTEGER,
  season_peak_games INTEGER,
  season_peak_at TEXT,
  season_peak_tier TEXT,
  season_low_rating INTEGER,
  season_low_games INTEGER,
  season_low_at TEXT,
```

- [ ] **Step 4: 编写 migration 与 backfill**

创建 `drizzle/0005_strict_season_extrema.sql`：

```sql
ALTER TABLE arena_ratings ADD COLUMN season_peak_rating INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_peak_games INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_peak_at TEXT;
ALTER TABLE arena_ratings ADD COLUMN season_peak_tier TEXT;
ALTER TABLE arena_ratings ADD COLUMN season_low_rating INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_low_games INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_low_at TEXT;

UPDATE arena_ratings
SET
  season_peak_rating = rating,
  season_peak_games = games,
  season_peak_at = updated_at,
  season_peak_tier = CASE
    WHEN games < 5 OR rating < 800 THEN '无牌'
    WHEN rating < 1000 THEN '白牌'
    WHEN rating < 1200 THEN '字牌'
    WHEN rating < 1500 THEN '花牌'
    ELSE '权杖'
  END,
  season_low_rating = rating,
  season_low_games = games,
  season_low_at = updated_at
WHERE queue = 'strict'
  AND season_peak_rating IS NULL
  AND season_low_rating IS NULL;
```

要求：

- 回填只针对现存 `strict` 行
- `free` 行全部维持 `NULL`
- `season_peak_tier` 仅按当前 `rating + games` 回填基础段位，不尝试回放历史 `女王`
- `WHERE ... IS NULL` 保证重复执行时不覆盖后续真实数据

- [ ] **Step 5: 扩展仓储读取结构**

在 `lib/db/repositories/data-card-meta.ts` 中：

- 给 `DataCardArenaRatingRow` 增加：

```ts
seasonPeakRating: number | null;
seasonPeakGames: number | null;
seasonPeakAt: string | null;
seasonPeakTier: string | null;
seasonLowRating: number | null;
seasonLowGames: number | null;
seasonLowAt: string | null;
```

- 在 `getArenaRatingsByDataCardId(...)` 与 `getStrictArenaRatingsByDataCardIds(...)` 的 `select(...)` 中补齐这些字段
- 只读取，不在这里做 tier 推导

- [ ] **Step 6: 补新建 strict rating 行的初始化**

在 `lib/db/repositories/arena-ratings-write.ts` 的 `ensureArenaRatingsExist(...)` 中：

- 新插入 strict 行时，同时写入：

```ts
seasonPeakRating: initialRating,
seasonPeakGames: 0,
seasonPeakAt: nowIso,
seasonPeakTier: '无牌',
seasonLowRating: initialRating,
seasonLowGames: 0,
seasonLowAt: nowIso,
```

- 新插入 free 行时，这些字段保持 `NULL`

- [ ] **Step 7: 运行测试确认通过**

Run: `bun test tests/data-card-meta-season-extrema.test.ts`  
Expected: PASS

- [ ] **Step 8: 预演 migration 命令**

Run:

```bash
node scripts/d1-migrate-safe.mjs --database DB --remote --env production --env-file .env
```

Expected:

- 新 migration `0005_strict_season_extrema.sql` 被识别
- 线上/目标 D1 将新增 7 列
- 现存 strict 行会被初始化为 `rating/games/updated_at/baseTier`

若当前环境没有可用 D1 凭据，则在最终说明里明确“migration 命令未在本地实际执行”。

- [ ] **Step 9: 提交**

```bash
git add lib/db/schema/business.ts lib/database/schema.sql drizzle/0005_strict_season_extrema.sql lib/db/repositories/data-card-meta.ts lib/db/repositories/arena-ratings-write.ts tests/data-card-meta-season-extrema.test.ts
git commit -m "feat: add strict season extrema schema" -m "补充 strict 赛季最高/最低分与赛季最高段位字段、D1 migration、strict 初始值和基础仓储读取。"
```

---

### Task 2: 在 strict 结算与 strict reset 中维护 season extrema 和 `seasonPeakTier`

**Files:**
- Modify: `lib/arena/tier.ts`
- Modify: `lib/database/arena-ratings.ts`
- Modify: `lib/db/repositories/data-card-meta.ts`
- Modify: `lib/db/repositories/arena-ratings-write.ts`
- Test: `tests/arena-ratings.test.ts`

- [ ] **Step 1: 写纯规则失败测试**

在 `tests/arena-ratings.test.ts` 新增至少四个测试：

```ts
test('arena tier rank: 女王 高于 权杖', () => {
  expect(compareArenaTier('女王', '权杖')).toBeGreaterThan(0);
});

test('computeStrictSeasonExtremaAfterApplied: 更高 afterRating 刷新 peak，不改 low', () => {
  expect(
    computeStrictSeasonExtremaAfterApplied({
      current: {
        seasonPeakRating: 1200,
        seasonPeakGames: 10,
        seasonPeakAt: '2026-03-01T00:00:00.000Z',
        seasonLowRating: 900,
        seasonLowGames: 5,
        seasonLowAt: '2026-03-02T00:00:00.000Z',
      },
      afterRating: 1260,
      afterGames: 11,
      appliedAtIso: '2026-03-03T00:00:00.000Z',
    })
  ).toMatchObject({
    seasonPeakRating: 1260,
    seasonPeakGames: 11,
    seasonLowRating: 900,
  });
});

test('computeStrictSeasonExtremaAfterApplied: 更低 afterRating 刷新 low，不改 peak', () => {
  expect(
    computeStrictSeasonExtremaAfterApplied({
      current: {
        seasonPeakRating: 1200,
        seasonPeakGames: 10,
        seasonPeakAt: '2026-03-01T00:00:00.000Z',
        seasonLowRating: 950,
        seasonLowGames: 8,
        seasonLowAt: '2026-03-02T00:00:00.000Z',
      },
      afterRating: 910,
      afterGames: 12,
      appliedAtIso: '2026-03-04T00:00:00.000Z',
    })
  ).toMatchObject({
    seasonPeakRating: 1200,
    seasonLowRating: 910,
    seasonLowGames: 12,
  });
});

test('pickHigherArenaTier: 当前显示段位高于既有值时刷新 seasonPeakTier', () => {
  expect(pickHigherArenaTier('花牌', '权杖')).toBe('权杖');
});

test('pickHigherArenaTier: 成为女王时可刷新为 女王，即使最高分未更新', () => {
  expect(pickHigherArenaTier('权杖', '女王')).toBe('女王');
});

test('buildInitialStrictSeasonState: 新 strict 行与 strict reset 都应初始化为起始分和无牌', () => {
  expect(buildInitialStrictSeasonState(1000, '2026-03-06T00:00:00.000Z')).toEqual({
    seasonPeakRating: 1000,
    seasonPeakGames: 0,
    seasonPeakAt: '2026-03-06T00:00:00.000Z',
    seasonPeakTier: '无牌',
    seasonLowRating: 1000,
    seasonLowGames: 0,
    seasonLowAt: '2026-03-06T00:00:00.000Z',
  });
});
```

要求：

- 不要保留占位断言
- 测试必须直接约束“`seasonPeakTier` 独立于 `seasonPeakRating` 更新”的语义

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/arena-ratings.test.ts`  
Expected: FAIL，缺少 tier compare / season extrema helper

- [ ] **Step 3: 补段位比较辅助**

在 `lib/arena/tier.ts` 中新增最小能力：

```ts
const ARENA_TIER_ORDER = ['无牌', '白牌', '字牌', '花牌', '权杖', '女王'] as const;

export function getArenaTierRank(tier: ArenaTier | null | undefined): number { ... }
export function compareArenaTier(a: ArenaTier | null | undefined, b: ArenaTier | null | undefined): number { ... }
export function pickHigherArenaTier(current: ArenaTier | null | undefined, next: ArenaTier | null | undefined): ArenaTier | null { ... }
```

要求：

- `女王` 仅用于显示层级比较，不改变原有 `computeArenaBaseTier / applyQueenTier` 语义
- `null/undefined` 视为“未记录”，低于任何合法段位

- [ ] **Step 4: 在领域层补 strict season extrema 纯计算 helper**

在 `lib/database/arena-ratings.ts` 新增：

```ts
export function buildInitialStrictSeasonState(initialRating: number, nowIso: string): {
  seasonPeakRating: number;
  seasonPeakGames: number;
  seasonPeakAt: string;
  seasonPeakTier: ArenaTier;
  seasonLowRating: number;
  seasonLowGames: number;
  seasonLowAt: string;
} { ... }

export function computeStrictSeasonExtremaAfterApplied(input: {
  current: {
    seasonPeakRating: number | null;
    seasonPeakGames: number | null;
    seasonPeakAt: string | null;
    seasonLowRating: number | null;
    seasonLowGames: number | null;
    seasonLowAt: string | null;
  };
  afterRating: number;
  afterGames: number;
  appliedAtIso: string;
}): {
  seasonPeakRating: number;
  seasonPeakGames: number;
  seasonPeakAt: string;
  seasonLowRating: number;
  seasonLowGames: number;
  seasonLowAt: string;
};
```

要求：

- `buildInitialStrictSeasonState(...)` 供 `ensureArenaRatingsExist(...)` 与 `resetStrictArenaRatingForDataCard(...)` 复用
- 纯函数里只做比较与取值，不访问数据库
- 相等时保留首次达到 extrema 的时间

- [ ] **Step 5: 为 queen 查询补 bypass cache 能力**

在 `lib/db/repositories/data-card-meta.ts` 的 `queryArenaPublicQueenEntityByQueue(...)` 增加可选参数：

```ts
{ bypassCache?: boolean }
```

要求：

- 默认仍走缓存，保持现有读 API 行为
- `bypassCache: true` 时必须重新查询，并把新值写回缓存
- 这是 write path 的强制要求，否则新晋 `女王` 可能因 30 秒缓存而漏记 `seasonPeakTier='女王'`

- [ ] **Step 6: 在 strict applied 写路径中维护 extrema**

在 `lib/db/repositories/arena-ratings-write.ts` 的 `applyArenaRatingsUpdateIfBothMatch(...)` 中：

1. 先把 `readCurrentRows()` 扩展为同时读取 `seasonPeak* / seasonLow* / seasonPeakTier`
2. 在 compare-and-swap 条件确认通过后，为 A/B 两个实体分别调用 `computeStrictSeasonExtremaAfterApplied(...)`
3. 用 helper 产出的 peak/low 结果组装更新 payload，再与 `rating / games / W-L-D / lastDelta / lastAppliedAt` 一起写回

规则：

- 仅 `queue='strict'` 时更新
- `free` 队列保持这些字段原样不动
- `afterRating > seasonPeakRating` 才刷新 peak；相等不覆盖时间
- `afterRating < seasonLowRating` 才刷新 low；相等不覆盖时间
- `ensureArenaRatingsExist(...)` 对 strict 新行使用 `buildInitialStrictSeasonState(...)`，防止 season 字段长期为 `NULL`

- [ ] **Step 7: 在 strict applied 后刷新 `seasonPeakTier`**

在上一步 rating/extrema 更新成功后，执行 strict 专用的第二阶段逻辑：

1. 对 A/B 两个实体分别根据 `afterRating / afterGames` 计算基础段位
2. 通过 `queryArenaPublicQueenEntityByQueue(db, 'strict', { bypassCache: true })` 重新读取当前 queen
3. 若某实体正是 queen 且基础段位为 `权杖`，本次显示段位记为 `女王`
4. 用 `pickHigherArenaTier(existingSeasonPeakTier, currentDisplayTier)` 决定目标值
5. 第二阶段写回必须是 monotonic update：

```sql
season_peak_tier = CASE
  WHEN <db当前season_peak_tier的rank> >= <currentDisplayTier的rank> THEN season_peak_tier
  ELSE <currentDisplayTier>
END
```

6. 第二阶段 `WHERE` 里必须锚定“当前 rating/games 仍等于本次 after 值”，避免把更晚一场结算的结果回退掉

要求：

- 允许 `seasonPeakTier` 在 `seasonPeakRating` 没变化时单独提升到 `女王`
- 只处理本次被更新的两行，不做全表扫描
- 不得依赖缓存中的旧 queen 结果
- 要求“只升不降”，即便并发请求交错也不能把更高 tier 覆盖回去
- 若无法在现有 D1 约束下完全消除“短暂成为女王后又被更晚请求抢先改写”的极端窗口，要把这条限制写进实现注释与 runbook

- [ ] **Step 8: 在 strict reset 中同步重置 extrema 与 `seasonPeakTier`**

在 `resetStrictArenaRatingForDataCard(...)` 中，改为直接复用：

```ts
{
  rating: initialRating,
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  lastDelta: null,
  lastAppliedAt: null,
  seasonPeakRating: initialRating,
  seasonPeakGames: 0,
  seasonPeakAt: nowIso,
  seasonPeakTier: '无牌',
  seasonLowRating: initialRating,
  seasonLowGames: 0,
  seasonLowAt: nowIso,
  updatedAt: nowIso,
}
```

说明：

- 这里应改成 `...buildInitialStrictSeasonState(initialRating, nowIso)`
- 不需要额外 queen 查询

- [ ] **Step 9: 运行测试确认通过**

Run: `bun test tests/arena-ratings.test.ts`  
Expected: PASS

- [ ] **Step 10: 提交**

```bash
git add lib/arena/tier.ts lib/database/arena-ratings.ts lib/db/repositories/data-card-meta.ts lib/db/repositories/arena-ratings-write.ts tests/arena-ratings.test.ts
git commit -m "feat: track strict season peak tier on rating updates" -m "为 strict 结算与重置链路补充赛季极值和赛季最高显示段位维护。"
```

---

### Task 3: 在 season soft reset 中同步刷新 season extrema 与 `seasonPeakTier`

**Files:**
- Modify: `lib/db/repositories/season-soft-reset.ts`
- Modify: `scripts/season-soft-reset.ts`
- Modify: `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md`
- Test: `tests/season-reset.test.ts`
- Test: `tests/season-reset-auto.test.ts`

- [ ] **Step 1: 写 season soft reset 的失败测试**

在 `tests/season-reset.test.ts` / `tests/season-reset-auto.test.ts` 中新增两类断言：

```ts
expect(result.startRating).toBe(1100);
expect(result.extrema.peak.rating).toBe(1100);
expect(result.extrema.peak.games).toBe(0);
expect(result.extrema.peak.tier).toBe('无牌');
expect(result.extrema.low.rating).toBe(1100);
expect(result.extrema.low.games).toBe(0);

expect(buildSeasonSoftResetUpdateSql({ queue: 'free', ... }).sql).not.toContain('season_peak_rating');
expect(buildSeasonSoftResetUpdateSql({ queue: 'strict', ... }).sql).toContain('season_peak_rating');
```

要求：

- 提取最小纯 helper `buildSeasonSoftResetUpdateSql(...)`，用于测试 strict/free 分支 SQL 生成
- 至少覆盖 `--queue all` 场景下 strict 会重置 season 字段、free 不会写入 season 字段

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/season-reset.test.ts tests/season-reset-auto.test.ts`  
Expected: FAIL，仅新增的 extrema / `seasonPeakTier` 相关断言失败

- [ ] **Step 3: 修改 soft reset UPDATE 语句**

在 `lib/db/repositories/season-soft-reset.ts` 中先提取：

```ts
function buildSeasonSoftResetUpdateSql(input: ...): { sql: string; params: unknown[] } { ... }
```

然后把 `executeSeasonSoftResetQueueUpdate(...)` 改成：

- `input.queue === 'strict'` 时，SQL 中包含：

```sql
season_peak_rating = <reset 后 rating>,
season_peak_games = 0,
season_peak_at = <nowIso>,
season_peak_tier = '无牌',
season_low_rating = <reset 后 rating>,
season_low_games = 0,
season_low_at = <nowIso>
```

- `input.queue === 'free'` 时，不写这些列，保持 `NULL`/原值

要求：

- 与当前 `rating / games / W-L-D` 同一次更新完成
- 不新增额外表扫描
- `includeLegacyColumns` 两个分支都要一致补齐
- 不允许因为 `--queue all` 而把 free 行也写出 season 字段

- [ ] **Step 4: 更新脚本输出与 runbook**

在 `scripts/season-soft-reset.ts` 的日志中补一句：

```text
[season-soft-reset] strict season extrema 与赛季最高段位已同步重置为新赛季起始值
```

在 `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md` 中补充：

- soft reset 会同时重置 `seasonPeak / seasonLow / seasonPeakTier`
- `seasonPeakTier` reset 后固定为 `无牌`
- `free` 队列第一版仍不写 season extrema 字段

- [ ] **Step 5: 运行测试确认通过**

Run: `bun test tests/season-reset.test.ts tests/season-reset-auto.test.ts`  
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lib/db/repositories/season-soft-reset.ts scripts/season-soft-reset.ts docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md tests/season-reset.test.ts tests/season-reset-auto.test.ts
git commit -m "feat: reset strict season extrema during season soft reset" -m "让新赛季 soft reset 同步刷新 strict 赛季极值与赛季最高显示段位。"
```

---

### Task 4: 扩展 `data-card-meta` 并在角色卡详情页展示

**Files:**
- Modify: `pages/api/data-card-meta.ts`
- Modify: `components/DataCardDetailsModal.tsx`
- Modify: `tests/data-card-details-modal.test.ts`
- Modify: `tests/data-card-meta-season-extrema.test.ts`

- [ ] **Step 1: 为 API DTO 写失败测试**

在 `tests/data-card-meta-season-extrema.test.ts` 中，针对新提取的 API seam 写测试。推荐提取：

```ts
export function buildApiRatingFromRow(...)
```

然后增加断言：

```ts
expect(buildApiRatingFromRow(strictRow, ...)).toMatchObject({
  rating: 1310,
  seasonPeak: {
    rating: 1310,
    games: 14,
    occurredAt: '2026-03-25T00:00:00.000Z',
    tier: '花牌',
  },
  seasonPeakTier: '女王',
  seasonLow: {
    rating: 980,
    games: 6,
    occurredAt: '2026-03-24T00:00:00.000Z',
    tier: '白牌',
  },
});

expect(buildApiRatingFromRow(freeRow, ...)).toMatchObject({
  seasonPeak: null,
  seasonPeakTier: null,
  seasonLow: null,
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/data-card-meta-season-extrema.test.ts`  
Expected: FAIL，`seasonPeak / seasonPeakTier / seasonLow` 尚未返回

- [ ] **Step 3: 扩展 `/api/data-card-meta`**

在 `pages/api/data-card-meta.ts` 中：

- 新增：

```ts
export function buildApiRatingFromRow(...)

type ApiRatingSeasonExtreme = {
  rating: number;
  games: number;
  occurredAt: string;
  tier: string;
};
```

- 给 `ApiRating` 增加：

```ts
seasonPeak: ApiRatingSeasonExtreme | null;
seasonPeakTier: string | null;
seasonLow: ApiRatingSeasonExtreme | null;
```

- 对 strict：
  - 当 `seasonPeakRating / seasonPeakGames / seasonPeakAt` 完整存在时，调用 `computeArenaBaseTier(...)` 组装 `seasonPeak`
  - `seasonPeakTier` 直接透传已落库值
  - `seasonLow` 同理
- 对 free：
  - 三个字段统一返回 `null`

- [ ] **Step 4: 为详情页提取可测试的展示 seam**

在 `components/DataCardDetailsModal.tsx` 中，提取一个可独立渲染的 presentational 子组件或具名导出函数，例如：

```tsx
export function StrictSeasonExtremaBlock({ strict }: { strict: ApiRating }) { ... }
```

然后在该块内渲染三行弱信息：

```tsx
<span>赛季最高 {peak.rating}（<TierBadge tier={peak.tier} ... />）</span>
<span>赛季最低 {low.rating}（<TierBadge tier={low.tier} ... />）</span>
<span>赛季最高段位 <TierBadge tier={seasonPeakTier} ... /></span>
```

要求：

- 只对 strict 展示
- `occurredAt` 作为 `title` 或小号灰字，不抢主视觉
- `seasonPeakTier` 单独一行展示，不能误用 `seasonPeak.tier`
- `free` 不展示同类行

- [ ] **Step 5: 补详情页渲染测试**

在 `tests/data-card-details-modal.test.ts` 中直接渲染 `StrictSeasonExtremaBlock`（而不是整个 modal），断言：

```ts
expect(html).toContain('赛季最高');
expect(html).toContain('赛季最低');
expect(html).toContain('赛季最高段位');
expect(html).toContain('女王');
```

不要对 `DataCardDetailsModal` 整体做 fetch 驱动的静态渲染断言；测试只落在新提取的展示 seam 上。

- [ ] **Step 6: 运行测试确认通过**

Run: `bun test tests/data-card-meta-season-extrema.test.ts tests/data-card-details-modal.test.ts`  
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add pages/api/data-card-meta.ts components/DataCardDetailsModal.tsx tests/data-card-meta-season-extrema.test.ts tests/data-card-details-modal.test.ts
git commit -m "feat: expose strict season extrema in card details" -m "在数据卡详情中展示 strict 赛季最高/最低分与赛季最高段位。"
```

---

### Task 5: 扩展个人页资料卡，仅在最高排位角色区域展示 season extrema

**Files:**
- Modify: `pages/api/me/profile-card.ts`
- Modify: `components/me/ProfileCard.tsx`
- Create: `tests/profile-card-season-extrema.test.tsx`

- [ ] **Step 1: 写个人页渲染失败测试**

创建 `tests/profile-card-season-extrema.test.tsx`，使用一份真实可渲染的最小 `MeProfileCardPayload` fixture，至少覆盖：

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileCard } from '@/components/me/ProfileCard';

test('topRatedCharacter renders strict season peak/low/tier', () => {
  const queryClient = new QueryClient();
  const payload: MeProfileCardPayload = { ...最小完整fixture... };
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ProfileCard data={payload} />
    </QueryClientProvider>,
  );

  expect(html).toContain('赛季最高');
  expect(html).toContain('赛季最低');
  expect(html).toContain('赛季最高段位');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/profile-card-season-extrema.test.tsx`  
Expected: FAIL，页面尚未渲染 season extrema / `seasonPeakTier`

- [ ] **Step 3: 扩展 `/api/me/profile-card` 的 strict DTO**

在 `pages/api/me/profile-card.ts` 中：

- 保持 `topCards.characters[*].ratings.strict` 现有 `CardRatingLite` 形状不变
- 仅为 `topRatedCharacter` 扩展专用类型，例如：

```ts
type TopRatedStrictRatingLite = CardRatingLite & {
seasonPeak: {
  rating: number;
  games: number;
  tier: string;
  occurredAt: string;
} | null;
seasonPeakTier: string | null;
seasonLow: {
  rating: number;
  games: number;
  tier: string;
  occurredAt: string;
} | null;
};
```

- 新增 topRated-only 的 mapper，例如：

```ts
function buildTopRatedStrictRating(row: RatingRow | undefined): TopRatedStrictRatingLite | null { ... }
```

- `topCards.characters[*]` 继续走现有 `buildRating(...)`
- 只有 `topRatedCharacter` 使用 `buildTopRatedStrictRating(...)`

- [ ] **Step 4: 在 `ProfileCard.tsx` 中仅为最高排位角色渲染**

在 `components/me/ProfileCard.tsx` 中：

- 让 `renderCharacterHighlight(...)` 默认不显示 season 信息
- 为 `topRatedCharacter` 单独打开开关，或单独渲染一个 `TopRatedSeasonExtremaBlock`

然后只在 `topRatedCharacter` 区域新增三条说明：

```tsx
当前 strict：1260（花牌）
赛季最高：1332（花牌）
赛季最低：987（白牌）
赛季最高段位：女王
```

要求：

- 不把 season extrema 塞进所有 character highlight 小卡
- 不改排行榜列表
- 不扩 `topCards.characters[*]` 的前端展示与契约
- 保持导出布局稳定；如空间紧张，允许把三行压缩为：
  - `峰 1332（花牌）`
  - `谷 987（白牌）`
  - `最高段位 女王`

- [ ] **Step 5: 运行测试确认通过**

Run: `bun test tests/profile-card-season-extrema.test.tsx`  
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add pages/api/me/profile-card.ts components/me/ProfileCard.tsx tests/profile-card-season-extrema.test.tsx
git commit -m "feat: show strict season extrema on profile card" -m "在个人资料卡的最高排位角色区域展示 strict 赛季极值与赛季最高段位。"
```

---

### Task 6: 迁移说明、全量回归与收尾验证

**Files:**
- Modify: `docs/superpowers/specs/2026-03-24-strict-season-extremes-design.md`（如实现中需要补充最终约束）
- Modify: `docs/superpowers/plans/2026-03-25-strict-season-extremes.md`（仅勾选，不改语义）
- Test: `tests/arena-ratings.test.ts`
- Test: `tests/season-reset.test.ts`
- Test: `tests/season-reset-auto.test.ts`
- Test: `tests/data-card-meta-season-extrema.test.ts`
- Test: `tests/data-card-details-modal.test.ts`
- Test: `tests/profile-card-season-extrema.test.tsx`

- [ ] **Step 1: 写 migration / backfill 说明**

在最终实现说明或附带文档中明确：

- `drizzle/0005_strict_season_extrema.sql` 会对现存 strict 行做一次性初始化
- 初始化口径：
  - `seasonPeakRating = rating`
  - `seasonPeakGames = games`
  - `seasonPeakAt = updated_at`
  - `seasonPeakTier = 当前 rating + games 推导出的基础段位`
  - `seasonLowRating = rating`
  - `seasonLowGames = games`
  - `seasonLowAt = updated_at`
- 这不是历史精确回放，因此不会回填历史 `女王`

- [ ] **Step 2: 运行定向测试集**

Run:

```bash
bun test tests/arena-ratings.test.ts
bun test tests/season-reset.test.ts tests/season-reset-auto.test.ts
bun test tests/data-card-meta-season-extrema.test.ts
bun test tests/data-card-details-modal.test.ts
bun test tests/profile-card-season-extrema.test.tsx
```

Expected: 全部 PASS

- [ ] **Step 3: 运行 lint**

Run: `bun run lint`  
Expected: PASS，无新增 warning/error

- [ ] **Step 4: 如本地具备完整环境，补一轮 build**

Run: `bun run build`  
Expected: PASS  
If blocked: 在最终说明里明确未执行原因

- [ ] **Step 5: 提交收尾**

```bash
git add .
git commit -m "feat: add strict season extrema display" -m "完成 strict 赛季最高/最低分与赛季最高显示段位的数据链路、展示和测试。"
```

---

## 实施备注

- 本计划不引入独立 `season_id` 表结构；继续遵循当前“D1 仅存当前赛季 live 状态”的架构。
- `seasonPeak/seasonLow` 的 `tier` 一律用 `computeArenaBaseTier(rating, games)` 推导，不调用 `applyQueenTier(...)`。
- `seasonPeakTier` 单独承载“本赛季达到过的最高 strict 显示段位”，允许记录 `女王`，且不要求与 `seasonPeakRating` 同一时点。
- strict 写路径必须绕过 queen 缓存读取最新榜首，否则会漏记刚刚晋升的 `女王`。
- `seasonPeakTier` 的第二阶段写回必须是 monotonic update，只允许提升，不允许回退覆盖。
- 在无事务的并发 strict 结算下，极端情况下仍可能存在“短暂成为女王后又被更晚请求抢先改写”的极小窗口；实现中要写清这个限制，并优先把风险压到最小。
- `free` 本期统一返回 `null`，避免语义半成品。
- 如果实现中发现 `ProfileCard.tsx` 直接渲染完整文案会明显挤压导出布局，允许保持 API 不变，只缩短展示文案。

---

## 审核说明

- 本 plan 已按当前确认口径补齐 `seasonPeakTier`
- 下一步执行前，先派发一次 plan reviewer 子代理复审
- 执行阶段按 `subagent-driven-development` 逐 Task 落地，并在每个 Task 后做 spec review 与 code quality review
