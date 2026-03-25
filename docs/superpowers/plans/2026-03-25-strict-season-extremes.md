# Strict 赛季最高/最低分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为公开角色卡的 strict 排位新增“本赛季最高分 / 最低分”记录，并在角色卡详情与个人页中展示。

**Architecture:** 直接扩展 `arena_ratings` 当前赛季 live 行，记录 strict 队列的赛季极值分、对应 games 与发生时间；结算、strict reset、season soft reset 同步维护这些字段；读取链路复用现有 `data-card-meta` 与 `me/profile-card`，UI 仅在详情页和个人页主角色区域展示，排行榜列表不加字段。

**Tech Stack:** Next.js Pages Router、Cloudflare Edge Runtime、Drizzle ORM、Cloudflare D1、TypeScript、Bun test、React Query

---

## 文件结构与职责

**数据与 schema**

- Modify: `lib/db/schema/business.ts`
  - 为 `arenaRatings` 增加 strict 赛季极值字段
- Modify: `lib/database/schema.sql`
  - 同步 SQLite DDL
- Create: `drizzle/0005_strict_season_extrema.sql`
  - 为线上 D1 增加 season extrema 列，并回填现存 strict 行
- Modify: `lib/db/repositories/data-card-meta.ts`
  - 读取 `season_peak_* / season_low_*`
- Modify: `lib/db/repositories/arena-ratings-write.ts`
  - strict 结算写入、strict reset 同步维护 season extrema
- Modify: `lib/db/repositories/season-soft-reset.ts`
  - season soft reset 时同步重置 season extrema

**领域与 API**

- Modify: `lib/database/arena-ratings.ts`
  - 暴露 season extrema 相关的辅助类型/计算入口
- Modify: `pages/api/data-card-meta.ts`
  - 对外返回 `ratings.strict.seasonPeak / seasonLow`
- Modify: `pages/api/me/profile-card.ts`
  - 对外返回 `topRatedCharacter.ratings.strict.seasonPeak / seasonLow`

**展示层**

- Modify: `components/DataCardDetailsModal.tsx`
  - strict 排位区域展示赛季最高/最低
- Modify: `components/me/ProfileCard.tsx`
  - 在最高排位角色区域展示赛季最高/最低

**测试**

- Modify: `tests/arena-ratings.test.ts`
  - 覆盖 strict season extrema 更新规则
- Modify: `tests/season-reset.test.ts`
  - 覆盖 season soft reset 对 extrema 的处理
- Create: `tests/data-card-meta-season-extrema.test.ts`
  - 覆盖 `data-card-meta` 的 DTO 映射
- Create: `tests/profile-card-season-extrema.test.tsx`
  - 覆盖个人页资料卡对 season extrema 的渲染
- Modify: `tests/data-card-details-modal.test.ts`
  - 覆盖详情页 season extrema 文案

**文档**

- Modify: `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md`
  - 补充 season soft reset 会同时刷新 season extrema

---

### Task 1: 扩展 strict season extrema 数据模型

**Files:**
- Modify: `lib/db/schema/business.ts`
- Modify: `lib/database/schema.sql`
- Create: `drizzle/0005_strict_season_extrema.sql`
- Modify: `lib/db/repositories/data-card-meta.ts`
- Test: `tests/data-card-meta-season-extrema.test.ts`

- [ ] **Step 1: 写仓储层 DTO 的失败测试**

```ts
import { describe, expect, test } from 'bun:test';

describe('data-card-meta season extrema mapping', () => {
  test('strict row exposes season peak/low fields for API mapping', () => {
    const row = {
      queue: 'strict',
      rating: 1234,
      games: 17,
      seasonPeakRating: 1310,
      seasonPeakGames: 14,
      seasonPeakAt: '2026-03-25T00:00:00.000Z',
      seasonLowRating: 980,
      seasonLowGames: 6,
      seasonLowAt: '2026-03-24T00:00:00.000Z',
    };

    expect(row.seasonPeakRating).toBe(1310);
    expect(row.seasonLowRating).toBe(980);
  });
});
```

- [ ] **Step 2: 运行测试，确认当前缺字段/缺文件**

Run: `bun test tests/data-card-meta-season-extrema.test.ts`  
Expected: FAIL，提示测试文件不存在或 season extrema 字段未定义

- [ ] **Step 3: 为 `arena_ratings` 增加字段**

在 `lib/db/schema/business.ts` 的 `arenaRatings` 表定义中新增：

```ts
seasonPeakRating: integer('season_peak_rating'),
seasonPeakGames: integer('season_peak_games'),
seasonPeakAt: text('season_peak_at'),
seasonLowRating: integer('season_low_rating'),
seasonLowGames: integer('season_low_games'),
seasonLowAt: text('season_low_at'),
```

在 `lib/database/schema.sql` 的 `CREATE TABLE IF NOT EXISTS arena_ratings` 中新增：

```sql
  season_peak_rating INTEGER,
  season_peak_games INTEGER,
  season_peak_at TEXT,
  season_low_rating INTEGER,
  season_low_games INTEGER,
  season_low_at TEXT,
```

- [ ] **Step 4: 扩展仓储读取结构**

- [ ] **Step 4: 编写 D1 migration + strict 存量回填**

创建 `drizzle/0005_strict_season_extrema.sql`：

```sql
ALTER TABLE arena_ratings ADD COLUMN season_peak_rating INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_peak_games INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_peak_at TEXT;
ALTER TABLE arena_ratings ADD COLUMN season_low_rating INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_low_games INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_low_at TEXT;

UPDATE arena_ratings
SET
  season_peak_rating = rating,
  season_peak_games = games,
  season_peak_at = updated_at,
  season_low_rating = rating,
  season_low_games = games,
  season_low_at = updated_at
WHERE queue = 'strict'
  AND season_peak_rating IS NULL
  AND season_low_rating IS NULL;
```

要求：

- migration 文件必须进入 `drizzle/`
- 回填只针对现存 `strict` 行
- `free` 行维持 `NULL`
- `WHERE ... IS NULL` 保证重复执行时不会覆盖后续真实 extrema

- [ ] **Step 5: 扩展仓储读取结构**

在 `lib/db/repositories/data-card-meta.ts` 中：

- 给 `DataCardArenaRatingRow` 增加：

```ts
seasonPeakRating: number | null;
seasonPeakGames: number | null;
seasonPeakAt: string | null;
seasonLowRating: number | null;
seasonLowGames: number | null;
seasonLowAt: string | null;
```

- 在 `getArenaRatingsByDataCardId(...)` 的 `select(...)` 中新增对应字段映射

- [ ] **Step 6: 运行测试确认通过**

Run: `bun test tests/data-card-meta-season-extrema.test.ts`  
Expected: PASS

- [ ] **Step 7: 预演 migration 执行命令**

Run:

```bash
node scripts/d1-migrate-safe.mjs --database DB --remote --env production --env-file .env
```

Expected:

- 新 migration `0005_strict_season_extrema.sql` 被识别
- 线上/目标 D1 将新增 6 列
- 现存 strict 行被初始化为 `rating/games/updated_at`

若当前环境没有可用 D1 凭据，则在最终执行说明中明确“migration 命令未在本地实际执行”。

- [ ] **Step 8: 提交**

```bash
git add lib/db/schema/business.ts lib/database/schema.sql drizzle/0005_strict_season_extrema.sql lib/db/repositories/data-card-meta.ts tests/data-card-meta-season-extrema.test.ts
git commit -m "feat: add strict season extrema schema" -m "补充 strict 赛季最高/最低分字段、D1 migration 与基础仓储读取。"
```

---

### Task 2: 在 strict 结算与 strict reset 中维护 season extrema

**Files:**
- Modify: `lib/db/repositories/arena-ratings-write.ts`
- Modify: `lib/database/arena-ratings.ts`
- Test: `tests/arena-ratings.test.ts`

- [ ] **Step 1: 写 strict season extrema 更新规则的失败测试**

在 `tests/arena-ratings.test.ts` 新增三个测试：

```ts
test('strict applied: 首次初始化 season peak/low', () => {
  const current = { rating: 1000, games: 0, wins: 0, losses: 0, draws: 0 };
  const next = { rating: 1020, games: 1 };
  expect(next.rating).toBe(1020);
});

test('strict applied: 更高 afterRating 刷新 peak，更低 afterRating 刷新 low', () => {
  expect({ peak: 1200, low: 900 }).toEqual({ peak: 1200, low: 900 });
});

test('strict reset: season peak/low 同步重置为 initialRating', () => {
  expect(1000).toBe(1000);
});
```

注：实现时请将这三个测试改成真正断言 season extrema 更新 helper / reset payload 的行为，而不是保留占位断言。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `bun test tests/arena-ratings.test.ts`  
Expected: FAIL，缺少 season extrema helper 或 reset 断言不成立

- [ ] **Step 3: 在写路径中新增 season extrema 维护**

在 `lib/db/repositories/arena-ratings-write.ts` 中：

- 为 strict `applied` 更新逻辑补以下字段：

```ts
seasonPeakRating: sql`CASE
  WHEN ${arenaRatings.queue} = 'strict'
   AND (${arenaRatings.seasonPeakRating} IS NULL OR ${afterRating} > ${arenaRatings.seasonPeakRating})
  THEN ${afterRating}
  ELSE ${arenaRatings.seasonPeakRating}
END`,
```

同理补：

- `seasonPeakGames`
- `seasonPeakAt`
- `seasonLowRating`
- `seasonLowGames`
- `seasonLowAt`

要求：

- 仅在 `queue='strict'` 时更新
- 相等时不覆盖时间
- 使用 after 值，不用 before 值

- [ ] **Step 4: 在 strict reset 逻辑中同步重置 extrema**

在 `resetStrictArenaRatingForDataCard(...)` 中，把 reset payload 改成：

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
  seasonLowRating: initialRating,
  seasonLowGames: 0,
  seasonLowAt: nowIso,
  updatedAt: nowIso,
}
```

- [ ] **Step 5: 如有必要，提取最小 helper**

如果 SQL `CASE` 过于难读，可在 `lib/database/arena-ratings.ts` 中增加一个最小 helper 仅用于测试和说明，例如：

```ts
export function computeSeasonExtremeUpdate(current: ..., next: ..., appliedAt: string): ...
```

只有在能明显降低测试复杂度时才提取；否则保持现有风格，不做额外抽象。

- [ ] **Step 6: 运行测试确认通过**

Run: `bun test tests/arena-ratings.test.ts`  
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add lib/db/repositories/arena-ratings-write.ts lib/database/arena-ratings.ts tests/arena-ratings.test.ts
git commit -m "feat: track strict season extrema on rating updates" -m "为 strict 结算与重置链路补充赛季最高/最低分维护。"
```

---

### Task 3: 在 season soft reset 中同步刷新 season extrema

**Files:**
- Modify: `lib/db/repositories/season-soft-reset.ts`
- Modify: `scripts/season-soft-reset.ts`
- Modify: `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md`
- Test: `tests/season-reset.test.ts`

- [ ] **Step 1: 写 season soft reset 的失败测试**

在 `tests/season-reset.test.ts` 新增断言，要求 reset 后：

```ts
expect(result.startRating).toBe(1100);
expect(result.extrema.peak.rating).toBe(1100);
expect(result.extrema.low.rating).toBe(1100);
expect(result.extrema.peak.games).toBe(0);
expect(result.extrema.low.games).toBe(0);
```

注：若当前测试文件没有直接暴露 SQL 更新结果，请改为为 reset 规则提取最小纯函数后测试该纯函数。

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/season-reset.test.ts tests/season-reset-auto.test.ts`  
Expected: FAIL，仅新增的 season extrema 相关断言失败

- [ ] **Step 3: 修改 soft reset UPDATE 语句**

在 `lib/db/repositories/season-soft-reset.ts` 的 `UPDATE arena_ratings` 语句中同步设置：

```sql
season_peak_rating = <reset后的rating>,
season_peak_games = 0,
season_peak_at = <nowIso>,
season_low_rating = <reset后的rating>,
season_low_games = 0,
season_low_at = <nowIso>
```

要求：

- 与当前 `rating/games/W-L-D` 同一次更新完成
- 不新增额外表扫描

- [ ] **Step 4: 更新脚本输出与 runbook**

在 `scripts/season-soft-reset.ts` 的日志中补一句说明：

```text
[season-soft-reset] strict season extrema 已同步重置为新赛季起始值
```

在 `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md` 的 Step 3 说明里补充：

- soft reset 会同时重置 season extrema

- [ ] **Step 5: 运行测试确认通过**

Run: `bun test tests/season-reset.test.ts tests/season-reset-auto.test.ts`  
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lib/db/repositories/season-soft-reset.ts scripts/season-soft-reset.ts docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md tests/season-reset.test.ts
git commit -m "feat: reset strict season extrema during season soft reset" -m "让新赛季 soft reset 同步刷新 strict 赛季极值。"
```

---

### Task 4: 扩展 `data-card-meta` 并在角色卡详情页展示

**Files:**
- Modify: `pages/api/data-card-meta.ts`
- Modify: `components/DataCardDetailsModal.tsx`
- Modify: `tests/data-card-details-modal.test.ts`
- Test: `tests/data-card-meta-season-extrema.test.ts`

- [ ] **Step 1: 为 API DTO 写失败测试**

在 `tests/data-card-meta-season-extrema.test.ts` 增加断言：

```ts
expect(apiStrictRating.seasonPeak).toEqual({
  rating: 1310,
  games: 14,
  occurredAt: '2026-03-25T00:00:00.000Z',
  tier: '花牌',
});
```

以及：

```ts
expect(apiFreeRating.seasonPeak).toBeNull();
expect(apiFreeRating.seasonLow).toBeNull();
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/data-card-meta-season-extrema.test.ts`  
Expected: FAIL，`seasonPeak` / `seasonLow` 未返回

- [ ] **Step 3: 扩展 `/api/data-card-meta`**

在 `pages/api/data-card-meta.ts` 中：

- 新增：

```ts
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
seasonLow: ApiRatingSeasonExtreme | null;
```

- 对 strict：
  - 当 `seasonPeakRating/seasonPeakGames/seasonPeakAt` 完整存在时，调用 `computeArenaBaseTier(...)`
  - 组装 `seasonPeak`
  - `seasonLow` 同理
- 对 free：
  - 明确返回 `null`

- [ ] **Step 4: 在详情页展示**

在 `components/DataCardDetailsModal.tsx` strict 排位区域新增两行弱信息：

```tsx
<span>赛季最高 {peak.rating}（<TierBadge tier={peak.tier} ... />）</span>
<span>赛季最低 {low.rating}（<TierBadge tier={low.tier} ... />）</span>
```

要求：

- 只对 strict 展示
- `occurredAt` 作为 `title` 或小号灰字，不抢主视觉
- `free` 不展示同类行

- [ ] **Step 5: 补详情页渲染测试**

在 `tests/data-card-details-modal.test.ts` 增加一条渲染测试：

```ts
expect(html).toContain('赛季最高');
expect(html).toContain('赛季最低');
```

若现有组件通过 `fetch('/api/data-card-meta')` 拉数据，不要硬测网络；请提取一个最小的格式化 helper，或直接在已有 meta 已注入场景下测试静态渲染。

- [ ] **Step 6: 运行测试确认通过**

Run: `bun test tests/data-card-meta-season-extrema.test.ts tests/data-card-details-modal.test.ts`  
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add pages/api/data-card-meta.ts components/DataCardDetailsModal.tsx tests/data-card-meta-season-extrema.test.ts tests/data-card-details-modal.test.ts
git commit -m "feat: expose strict season extrema in card details" -m "在数据卡详情中展示 strict 赛季最高/最低分。"
```

---

### Task 5: 扩展个人页资料卡，仅在最高排位角色区域展示 season extrema

**Files:**
- Modify: `pages/api/me/profile-card.ts`
- Modify: `components/me/ProfileCard.tsx`
- Create: `tests/profile-card-season-extrema.test.tsx`

- [ ] **Step 1: 写个人页渲染失败测试**

创建 `tests/profile-card-season-extrema.test.tsx`：

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileCard } from '@/components/me/ProfileCard';

test('topRatedCharacter renders strict season peak/low', () => {
  const queryClient = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ProfileCard data={mockPayload} />
    </QueryClientProvider>,
  );

  expect(html).toContain('赛季最高');
  expect(html).toContain('赛季最低');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/profile-card-season-extrema.test.tsx`  
Expected: FAIL，页面尚未渲染 season extrema

- [ ] **Step 3: 扩展 `/api/me/profile-card` 的 strict DTO**

在 `pages/api/me/profile-card.ts` 中：

- 扩展 `CardRatingLite`：

```ts
seasonPeak: {
  rating: number;
  games: number;
  tier: string;
  occurredAt: string;
} | null;
seasonLow: {
  rating: number;
  games: number;
  tier: string;
  occurredAt: string;
} | null;
```

- 在 `buildRating(...)` 中，对 strict row 组装 `seasonPeak / seasonLow`
- 只给 `topRatedCharacter` 必需链路补齐；若复用同一 `buildRating`，则 `characters` 也会自然拿到，允许但不要求在 UI 展示

- [ ] **Step 4: 在 `ProfileCard.tsx` 中仅为最高排位角色渲染**

在显示 `topRatedCharacter` 的区域新增两条说明：

```tsx
当前 strict：1260（花牌）
赛季最高：1332（花牌）
赛季最低：987（白牌）
```

要求：

- 不把 season extrema 塞进所有 character highlight 小卡
- 不改排行榜列表
- 保持资料卡导出布局稳定，避免超过当前两行摘要高度太多

- [ ] **Step 5: 运行测试确认通过**

Run: `bun test tests/profile-card-season-extrema.test.tsx`  
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add pages/api/me/profile-card.ts components/me/ProfileCard.tsx tests/profile-card-season-extrema.test.tsx
git commit -m "feat: show strict season extrema on profile card" -m "在个人资料卡的最高排位角色区域展示 strict 赛季极值。"
```

---

### Task 6: 迁移验证与全量回归

**Files:**
- Modify: `docs/superpowers/specs/2026-03-24-strict-season-extremes-design.md`（如实现中有必要补注）
- Modify: `docs/superpowers/plans/2026-03-25-strict-season-extremes.md`（仅勾选，不改内容）
- Test: `tests/arena-ratings.test.ts`
- Test: `tests/season-reset.test.ts`
- Test: `tests/data-card-meta-season-extrema.test.ts`
- Test: `tests/data-card-details-modal.test.ts`
- Test: `tests/profile-card-season-extrema.test.tsx`

- [ ] **Step 1: 写迁移/回填说明**

在实现 PR 描述或附带文档中明确：

- 已通过 `drizzle/0005_strict_season_extrema.sql` 对现存 strict 行做一次性初始化
- 初始化口径为“当前 rating/games/updated_at 即为 season peak/low”
- 这不是历史精确回填，而是从迁移时点开始可信追踪后续 extrema

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
git commit -m "feat: add strict season extrema display" -m "完成 strict 赛季最高/最低分的数据链路、展示与测试。"
```

---

## 实施备注

- 本计划不引入独立 `season_id` 表结构；严格遵循当前“D1 仅存当前赛季 live 状态”的架构。
- `seasonPeak/seasonLow` 的 `tier` 一律用 `computeArenaBaseTier(rating, games)` 推导，不调用 `applyQueenTier(...)`。
- `free` 本期统一返回 `null`，避免语义半成品。
- 如果实现中发现 `ProfileCard.tsx` 直接渲染 season extrema 会让图片导出明显拥挤，允许在不改变 API 的前提下把文案收短为：
  - `峰 1332（花牌）`
  - `谷 987（白牌）`

---

## 审核说明

按 skill 原流程应派发 plan reviewer 子代理复审。当前会话未获得显式的子代理授权，因此本计划先以本地人工自审版本落盘；如需我继续走子代理复审，请直接明确说“允许你用 subagent review 这份 plan”。
