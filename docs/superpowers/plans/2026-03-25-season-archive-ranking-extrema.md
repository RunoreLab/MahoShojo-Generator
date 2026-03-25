# Season Archive Ranking Extrema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为历史赛季归档补齐 strict 赛季最高/最低分与赛季最高段位 facts，并让 `/ranking` 当前赛季与历史赛季主视图统一展示这组信息。

**Architecture:** 归档层继续保存 flat facts，不把展示态直接写入 `archive_<season>.json`。实现中新增可复用的 strict 赛季极值映射 helper，live 排行榜 API 与历史赛季快照解析都映射到同一套 `seasonPeak / seasonPeakTier / seasonLow` 视图模型，再由排行榜名称列下方的轻量组件统一渲染。历史详情弹窗继续读取当前公开卡，不纳入本轮。

**Tech Stack:** Next.js Pages Router、React、TypeScript strict、Cloudflare Edge Runtime、Drizzle ORM、Cloudflare D1、Bun test

---

## 文件结构与职责

**赛季极值视图模型**

- Create: `lib/ranking/season-extrema.ts`
  - 统一封装 strict 赛季极值原始字段到排行榜视图模型的映射
  - 提供 `seasonPeak / seasonPeakTier / seasonLow` 的 pure helper

**历史归档 facts**

- Modify: `lib/seasons.ts`
  - 扩展 `SeasonArchiveQueueSnapshot` 的 strict 可选字段
- Modify: `lib/db/repositories/season-archive.ts`
  - 归档查询增加 season extrema 原始列
- Modify: `lib/database/season-archive.ts`
  - 同步 runtime wrapper row type
- Create: `lib/season-archive/snapshot.ts`
  - 组装归档 `queues.strict` 快照的 pure helper
- Modify: `scripts/season-archive.ts`
  - 使用快照 helper，把 season extrema facts 写入归档 JSON

**live 当前赛季排行榜**

- Modify: `lib/db/repositories/arena-read.ts`
  - live 榜单查询增加 strict season extrema 原始列
- Modify: `pages/api/arena/leaderboard.ts`
  - 导出可测试的 row -> API item mapper，并为 strict 返回 `seasonPeak / seasonPeakTier / seasonLow`

**排行榜主视图**

- Create: `components/ranking/LeaderboardSeasonExtrema.tsx`
  - 渲染名称列下方的赛季最高/最低/最高段位信息块
- Modify: `components/ranking/RankingPage.tsx`
  - 当前赛季与历史赛季统一使用带 season 字段的 `LeaderboardItem`
  - 历史快照解析接入 season extrema facts
  - 名称列渲染新组件

**文档**

- Modify: `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md`
  - 说明新归档会保存 strict 赛季极值 facts，旧归档缺字段时主视图降级为空

**测试**

- Create: `tests/leaderboard-season-extrema.test.ts`
  - 验证 strict season extrema 视图模型 helper
- Create: `tests/season-archive-ranking-extrema.test.ts`
  - 验证归档快照 helper / script 输出结构
- Create: `tests/arena-leaderboard-season-extrema.test.ts`
  - 验证 live leaderboard API mapper
- Create: `tests/leaderboard-season-extrema-block.test.tsx`
  - 验证排行榜名称列 season extrema 组件渲染

---

### Task 1: 建立排行榜 strict 赛季极值视图模型 helper

**Files:**
- Create: `lib/ranking/season-extrema.ts`
- Test: `tests/leaderboard-season-extrema.test.ts`

- [ ] **Step 1: 写 strict season extrema helper 的失败测试**

创建 `tests/leaderboard-season-extrema.test.ts`，至少覆盖：

```ts
import { describe, expect, test } from 'bun:test';
import {
  buildStrictLeaderboardSeasonExtrema,
  normalizeStrictSeasonPeakTier,
} from '@/lib/ranking/season-extrema';

describe('leaderboard season extrema', () => {
  test('strict 原始字段会映射出 seasonPeak / seasonPeakTier / seasonLow', () => {
    expect(
      buildStrictLeaderboardSeasonExtrema('strict', {
        seasonPeakRating: 1600,
        seasonPeakGames: 28,
        seasonPeakAt: '2026-03-20T10:00:00.000Z',
        seasonPeakTier: '女王',
        seasonLowRating: 900,
        seasonLowGames: 6,
        seasonLowAt: '2026-02-01T10:00:00.000Z',
      }),
    ).toEqual({
      seasonPeak: {
        rating: 1600,
        games: 28,
        occurredAt: '2026-03-20T10:00:00.000Z',
        tier: '权杖',
      },
      seasonPeakTier: '女王',
      seasonLow: {
        rating: 900,
        games: 6,
        occurredAt: '2026-02-01T10:00:00.000Z',
        tier: '白牌',
      },
    });
  });

  test('free 队列统一返回 null', () => {
    expect(
      buildStrictLeaderboardSeasonExtrema('free', {
        seasonPeakRating: 1600,
        seasonPeakGames: 28,
        seasonPeakAt: '2026-03-20T10:00:00.000Z',
        seasonPeakTier: '权杖',
        seasonLowRating: 900,
        seasonLowGames: 6,
        seasonLowAt: '2026-02-01T10:00:00.000Z',
      }),
    ).toEqual({
      seasonPeak: null,
      seasonPeakTier: null,
      seasonLow: null,
    });
  });

  test('非法 seasonPeakTier 与缺字段 extrema 会降级为 null', () => {
    expect(normalizeStrictSeasonPeakTier('strict', '  非法段位  ')).toBeNull();
    expect(
      buildStrictLeaderboardSeasonExtrema('strict', {
        seasonPeakRating: 1500,
        seasonPeakGames: null,
        seasonPeakAt: '2026-03-20T10:00:00.000Z',
        seasonPeakTier: ' 女王 ',
        seasonLowRating: 900,
        seasonLowGames: 6,
        seasonLowAt: null,
      }),
    ).toEqual({
      seasonPeak: null,
      seasonPeakTier: '女王',
      seasonLow: null,
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/leaderboard-season-extrema.test.ts`
Expected: FAIL，原因是 helper 文件与导出尚不存在

- [ ] **Step 3: 实现 strict season extrema helper**

在 `lib/ranking/season-extrema.ts` 中实现：

```ts
import { computeArenaBaseTier } from '@/lib/arena/tier';

export type LeaderboardSeasonExtreme = {
  rating: number;
  games: number;
  occurredAt: string;
  tier: string;
};

type RawStrictSeasonExtrema = {
  seasonPeakRating: number | null;
  seasonPeakGames: number | null;
  seasonPeakAt: string | null;
  seasonPeakTier: string | null;
  seasonLowRating: number | null;
  seasonLowGames: number | null;
  seasonLowAt: string | null;
};

const ARENA_TIER_WHITELIST = new Set(['无牌', '白牌', '字牌', '花牌', '权杖', '女王']);

const buildSeasonExtreme = (
  rating: number | null,
  games: number | null,
  occurredAt: string | null,
): LeaderboardSeasonExtreme | null => {
  if (typeof rating !== 'number' || typeof games !== 'number' || typeof occurredAt !== 'string') return null;
  return {
    rating,
    games,
    occurredAt,
    tier: computeArenaBaseTier(rating, games),
  };
};

export const normalizeStrictSeasonPeakTier = (
  queue: 'strict' | 'free',
  seasonPeakTier: unknown,
): string | null => {
  if (queue !== 'strict') return null;
  if (typeof seasonPeakTier !== 'string') return null;
  const normalized = seasonPeakTier.trim();
  if (!normalized) return null;
  return ARENA_TIER_WHITELIST.has(normalized) ? normalized : null;
};

export const buildStrictLeaderboardSeasonExtrema = (
  queue: 'strict' | 'free',
  raw: RawStrictSeasonExtrema,
) => ({
  seasonPeak: queue === 'strict' ? buildSeasonExtreme(raw.seasonPeakRating, raw.seasonPeakGames, raw.seasonPeakAt) : null,
  seasonPeakTier: normalizeStrictSeasonPeakTier(queue, raw.seasonPeakTier),
  seasonLow: queue === 'strict' ? buildSeasonExtreme(raw.seasonLowRating, raw.seasonLowGames, raw.seasonLowAt) : null,
});
```

- [ ] **Step 4: 运行测试，确认 helper 通过**

Run: `bun test tests/leaderboard-season-extrema.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/ranking/season-extrema.ts tests/leaderboard-season-extrema.test.ts
git commit -m "feat: add leaderboard season extrema mapper"
```

---

### Task 2: 扩展历史赛季归档 facts 写入链路

**Files:**
- Modify: `lib/seasons.ts`
- Modify: `lib/db/repositories/season-archive.ts`
- Modify: `lib/database/season-archive.ts`
- Create: `lib/season-archive/snapshot.ts`
- Modify: `scripts/season-archive.ts`
- Test: `tests/season-archive-ranking-extrema.test.ts`

- [ ] **Step 1: 写归档快照 helper 的失败测试**

创建 `tests/season-archive-ranking-extrema.test.ts`，至少覆盖：

```ts
import { describe, expect, test } from 'bun:test';
import { buildSeasonArchiveQueueSnapshot } from '@/lib/season-archive/snapshot';

describe('season archive queue snapshot', () => {
  test('strict 快照会带出 season extrema facts', () => {
    expect(
      buildSeasonArchiveQueueSnapshot('strict', {
        rating: 1320,
        games: 18,
        wins: 10,
        losses: 7,
        draws: 1,
        ratingUpdatedAt: '2026-03-25T10:00:00.000Z',
        seasonPeakRating: 1600,
        seasonPeakGames: 28,
        seasonPeakAt: '2026-03-20T10:00:00.000Z',
        seasonPeakTier: '女王',
        seasonLowRating: 900,
        seasonLowGames: 6,
        seasonLowAt: '2026-02-01T10:00:00.000Z',
      }),
    ).toEqual({
      rating: 1320,
      games: 18,
      wins: 10,
      losses: 7,
      draws: 1,
      ratingUpdatedAt: '2026-03-25T10:00:00.000Z',
      seasonPeakRating: 1600,
      seasonPeakGames: 28,
      seasonPeakAt: '2026-03-20T10:00:00.000Z',
      seasonPeakTier: '女王',
      seasonLowRating: 900,
      seasonLowGames: 6,
      seasonLowAt: '2026-02-01T10:00:00.000Z',
    });
  });

  test('free 快照不写 season extrema facts', () => {
    expect(
      buildSeasonArchiveQueueSnapshot('free', {
        rating: 1200,
        games: 18,
        wins: 9,
        losses: 8,
        draws: 1,
        ratingUpdatedAt: '2026-03-25T10:00:00.000Z',
        seasonPeakRating: 1500,
        seasonPeakGames: 20,
        seasonPeakAt: '2026-03-12T10:00:00.000Z',
        seasonPeakTier: '权杖',
        seasonLowRating: 800,
        seasonLowGames: 5,
        seasonLowAt: '2026-02-01T10:00:00.000Z',
      }),
    ).toEqual({
      rating: 1200,
      games: 18,
      wins: 9,
      losses: 8,
      draws: 1,
      ratingUpdatedAt: '2026-03-25T10:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/season-archive-ranking-extrema.test.ts`
Expected: FAIL，原因是快照 helper 尚不存在

- [ ] **Step 3: 扩展归档类型与快照 helper**

在 `lib/seasons.ts` 的 `SeasonArchiveQueueSnapshot` 中追加可选字段：

```ts
seasonPeakRating?: number | null;
seasonPeakGames?: number | null;
seasonPeakAt?: string | null;
seasonPeakTier?: string | null;
seasonLowRating?: number | null;
seasonLowGames?: number | null;
seasonLowAt?: string | null;
```

创建 `lib/season-archive/snapshot.ts`：

```ts
import type { SeasonArchiveQueueSnapshot } from '@/lib/seasons';

type RawSeasonArchiveRow = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  ratingUpdatedAt: string | null;
  seasonPeakRating: number | null;
  seasonPeakGames: number | null;
  seasonPeakAt: string | null;
  seasonPeakTier: string | null;
  seasonLowRating: number | null;
  seasonLowGames: number | null;
  seasonLowAt: string | null;
};

export const buildSeasonArchiveQueueSnapshot = (
  queue: 'strict' | 'free',
  row: RawSeasonArchiveRow,
): SeasonArchiveQueueSnapshot => {
  const base: SeasonArchiveQueueSnapshot = {
    rating: row.rating,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    ratingUpdatedAt: row.ratingUpdatedAt,
  };

  if (queue !== 'strict') return base;

  return {
    ...base,
    seasonPeakRating: row.seasonPeakRating,
    seasonPeakGames: row.seasonPeakGames,
    seasonPeakAt: row.seasonPeakAt,
    seasonPeakTier: row.seasonPeakTier,
    seasonLowRating: row.seasonLowRating,
    seasonLowGames: row.seasonLowGames,
    seasonLowAt: row.seasonLowAt,
  };
};
```

- [ ] **Step 4: 扩展归档仓储查询与 runtime row type**

在 `lib/db/repositories/season-archive.ts` 与 `lib/database/season-archive.ts` 中同步补齐：

```ts
seasonPeakRating: number | null;
seasonPeakGames: number | null;
seasonPeakAt: string | null;
seasonPeakTier: string | null;
seasonLowRating: number | null;
seasonLowGames: number | null;
seasonLowAt: string | null;
```

并在 SQL select / drizzle select projection 中补这些列。

- [ ] **Step 5: 改造归档脚本写出 season extrema facts**

在 `scripts/season-archive.ts`：

1. 导入 `buildSeasonArchiveQueueSnapshot`
2. 删除内联的 `buildQueueSnapshot`，改为：

```ts
const snapshot = buildSeasonArchiveQueueSnapshot(options.queue, {
  rating,
  games,
  wins,
  losses,
  draws,
  ratingUpdatedAt,
  seasonPeakRating: row.seasonPeakRating,
  seasonPeakGames: row.seasonPeakGames,
  seasonPeakAt: row.seasonPeakAt,
  seasonPeakTier: row.seasonPeakTier,
  seasonLowRating: row.seasonLowRating,
  seasonLowGames: row.seasonLowGames,
  seasonLowAt: row.seasonLowAt,
});
```

要求：

- `strict` 写入 flat facts
- `free` 不写这些字段
- 旧归档 schema 兼容通过可选字段实现，不在脚本里做额外版本分支

- [ ] **Step 6: 运行测试，确认归档快照逻辑通过**

Run: `bun test tests/season-archive-ranking-extrema.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add lib/seasons.ts lib/db/repositories/season-archive.ts lib/database/season-archive.ts lib/season-archive/snapshot.ts scripts/season-archive.ts tests/season-archive-ranking-extrema.test.ts
git commit -m "feat: archive strict season extrema facts"
```

---

### Task 3: 扩展 live 当前赛季排行榜 API 返回 strict 赛季极值

**Files:**
- Modify: `lib/db/repositories/arena-read.ts`
- Modify: `pages/api/arena/leaderboard.ts`
- Test: `tests/arena-leaderboard-season-extrema.test.ts`

- [ ] **Step 1: 写 live leaderboard mapper 的失败测试**

创建 `tests/arena-leaderboard-season-extrema.test.ts`，测试 `pages/api/arena/leaderboard.ts` 导出的纯 mapper，例如：

```ts
import { describe, expect, test } from 'bun:test';
import { buildLeaderboardItemFromRow } from '@/pages/api/arena/leaderboard';

describe('arena leaderboard season extrema mapper', () => {
  test('strict item 返回 seasonPeak / seasonPeakTier / seasonLow', () => {
    const item = buildLeaderboardItemFromRow(
      {
        entityType: 'data_card',
        entityId: 'card_1',
        dataCardName: '角色A',
        authorName: '作者A',
        rating: 1320,
        games: 18,
        wins: 10,
        losses: 7,
        draws: 1,
        updatedAt: '2026-03-25T10:00:00.000Z',
        techScore: 88,
        techLevel: 'A',
        isNative: true,
        tagIds: ['tag_a'],
        seasonPeakRating: 1600,
        seasonPeakGames: 28,
        seasonPeakAt: '2026-03-20T10:00:00.000Z',
        seasonPeakTier: '女王',
        seasonLowRating: 900,
        seasonLowGames: 6,
        seasonLowAt: '2026-02-01T10:00:00.000Z',
      },
      {
        offset: 0,
        index: 0,
        queue: 'strict',
        isQueen: false,
        presetNameByFilename: new Map(),
      },
    );

    expect(item.seasonPeak?.tier).toBe('权杖');
    expect(item.seasonPeakTier).toBe('女王');
    expect(item.seasonLow?.tier).toBe('白牌');
  });

  test('free item 的 season 字段全部为 null', () => {
    const item = buildLeaderboardItemFromRow(/* queue=free */);
    expect(item.seasonPeak).toBeNull();
    expect(item.seasonPeakTier).toBeNull();
    expect(item.seasonLow).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/arena-leaderboard-season-extrema.test.ts`
Expected: FAIL，原因是 mapper 尚未导出，或 item shape 尚未包含 season 字段

- [ ] **Step 3: 扩展 live leaderboard 仓储行结构**

在 `lib/db/repositories/arena-read.ts`：

1. 为 `ArenaLeaderboardSelectRow` / `ArenaLeaderboardRow` 增加：

```ts
seasonPeakRating: number | null;
seasonPeakGames: number | null;
seasonPeakAt: string | null;
seasonPeakTier: string | null;
seasonLowRating: number | null;
seasonLowGames: number | null;
seasonLowAt: string | null;
```

2. 在 select projection 中补齐 `arenaRatings.seasonPeakRating` 等字段
3. 在 `normalizedRows` 映射中把这些值保留下来

- [ ] **Step 4: 在 API 层组装 additive season 字段**

在 `pages/api/arena/leaderboard.ts`：

1. 扩展 `LeaderboardItem`：

```ts
seasonPeak: LeaderboardSeasonExtreme | null;
seasonPeakTier: string | null;
seasonLow: LeaderboardSeasonExtreme | null;
```

2. 导出纯函数：

```ts
export const buildLeaderboardItemFromRow = (
  row: ArenaLeaderboardRow,
  options: {
    offset: number;
    index: number;
    queue: 'strict' | 'free';
    isQueen: boolean;
    presetNameByFilename: Map<string, string>;
  },
): LeaderboardItem => { ... };
```

3. 在 mapper 内调用 `buildStrictLeaderboardSeasonExtrema(options.queue, row)`
4. handler 中改用该 pure mapper 组装 `items`

要求：

- season 字段只做加法，不移除任何现有字段
- `ArenaRankingModal` 与其他 `/api/arena/leaderboard` 消费者无需改动即可继续工作

- [ ] **Step 5: 运行测试，确认 live leaderboard mapper 通过**

Run: `bun test tests/arena-leaderboard-season-extrema.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lib/db/repositories/arena-read.ts pages/api/arena/leaderboard.ts tests/arena-leaderboard-season-extrema.test.ts
git commit -m "feat: expose leaderboard season extrema"
```

---

### Task 4: 统一 `/ranking` 当前/历史赛季主视图的 season 渲染

**Files:**
- Create: `components/ranking/LeaderboardSeasonExtrema.tsx`
- Modify: `components/ranking/RankingPage.tsx`
- Test: `tests/leaderboard-season-extrema-block.test.tsx`

- [ ] **Step 1: 写主视图 season 信息块的失败测试**

创建 `tests/leaderboard-season-extrema-block.test.tsx`，至少覆盖：

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeaderboardSeasonExtrema } from '@/components/ranking/LeaderboardSeasonExtrema';

describe('LeaderboardSeasonExtrema', () => {
  test('strict season 信息会渲染最高/最低/最高段位', () => {
    const html = renderToStaticMarkup(
      <LeaderboardSeasonExtrema
        seasonPeak={{
          rating: 1600,
          games: 28,
          occurredAt: '2026-03-20T10:00:00.000Z',
          tier: '权杖',
        }}
        seasonPeakTier="女王"
        seasonLow={{
          rating: 900,
          games: 6,
          occurredAt: '2026-02-01T10:00:00.000Z',
          tier: '白牌',
        }}
      />,
    );

    expect(html).toContain('赛季最高');
    expect(html).toContain('赛季最低');
    expect(html).toContain('赛季最高段位');
    expect(html).toContain('女王');
  });

  test('season 信息全缺失时为空渲染', () => {
    expect(
      renderToStaticMarkup(
        <LeaderboardSeasonExtrema seasonPeak={null} seasonPeakTier={null} seasonLow={null} />,
      ),
    ).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/leaderboard-season-extrema-block.test.tsx`
Expected: FAIL，原因是组件尚不存在

- [ ] **Step 3: 实现轻量渲染组件**

创建 `components/ranking/LeaderboardSeasonExtrema.tsx`：

```tsx
import { TierBadge } from '@/components/ranking/TierBadge';
import { formatDateTime } from '@/lib/constants';
import type { LeaderboardSeasonExtreme } from '@/lib/ranking/season-extrema';

export function LeaderboardSeasonExtrema(props: {
  seasonPeak: LeaderboardSeasonExtreme | null;
  seasonPeakTier: string | null;
  seasonLow: LeaderboardSeasonExtreme | null;
}) {
  const { seasonPeak, seasonPeakTier, seasonLow } = props;
  if (!seasonPeak && !seasonPeakTier && !seasonLow) return null;

  return (
    <div className="mt-2 flex flex-col gap-1 text-[11px] text-gray-500">
      {seasonPeak ? (
        <div className="flex flex-wrap items-center gap-1">
          <span>赛季最高 {seasonPeak.rating}（<TierBadge tier={seasonPeak.tier} className="mx-1 align-middle" />）</span>
          <span title={seasonPeak.occurredAt}>{formatDateTime(seasonPeak.occurredAt)}</span>
        </div>
      ) : null}
      {seasonLow ? (
        <div className="flex flex-wrap items-center gap-1">
          <span>赛季最低 {seasonLow.rating}（<TierBadge tier={seasonLow.tier} className="mx-1 align-middle" />）</span>
          <span title={seasonLow.occurredAt}>{formatDateTime(seasonLow.occurredAt)}</span>
        </div>
      ) : null}
      {seasonPeakTier ? (
        <div>赛季最高段位 <TierBadge tier={seasonPeakTier} className="mx-1 align-middle" /></div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: 在 RankingPage 中统一 live/history 视图模型**

在 `components/ranking/RankingPage.tsx`：

1. 扩展 `LeaderboardItem` 与 `HistoryBaseItem`：

```ts
seasonPeak?: LeaderboardSeasonExtreme | null;
seasonPeakTier?: string | null;
seasonLow?: LeaderboardSeasonExtreme | null;
```

2. history 快照解析时，对 `entity.queues.strict` 调用 `buildStrictLeaderboardSeasonExtrema('strict', {...})`
3. `free` 模式下仍保持 season 字段为空
4. live 数据直接消费 API 返回字段，不二次推导

- [ ] **Step 5: 在名称列挂载 season extrema 组件**

在名称列 `tagPreviewIds` 渲染之后插入：

```tsx
{appliedFilters.queue === 'strict' ? (
  <LeaderboardSeasonExtrema
    seasonPeak={item.seasonPeak ?? null}
    seasonPeakTier={item.seasonPeakTier ?? null}
    seasonLow={item.seasonLow ?? null}
  />
) : null}
```

要求：

- 不新增独立表格列
- 当前赛季与历史赛季复用同一组件
- 搜索结果与详情弹窗链路不在本任务扩展

- [ ] **Step 6: 运行测试，确认渲染组件通过**

Run: `bun test tests/leaderboard-season-extrema-block.test.tsx`
Expected: PASS

- [ ] **Step 7: 做一次针对 `RankingPage` 的手工 smoke 验证**

Run: `bun run dev`
Expected:

- `/ranking` strict 当前赛季主表可看到赛季最高/最低/最高段位
- 切换到历史赛季后同样在名称列看到这组信息
- 切换 `free` 队列后这组信息不渲染

若本地不跑 dev，则在最终说明中明确“主视图 smoke 未实际执行”。

- [ ] **Step 8: 提交**

```bash
git add components/ranking/LeaderboardSeasonExtrema.tsx components/ranking/RankingPage.tsx tests/leaderboard-season-extrema-block.test.tsx
git commit -m "feat: show season extrema in ranking page"
```

---

### Task 5: 更新运行文档并做最终验证

**Files:**
- Modify: `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md`

- [ ] **Step 1: 更新 runbook 文案**

在 `docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md` 中补充：

- `season-archive.ts` 新生成的归档会写入 strict `seasonPeak / seasonLow / seasonPeakTier` 对应 facts
- 旧归档文件若缺失这些字段，`/ranking` 历史赛季主视图会自动降级为空，不影响列表加载
- 本轮仍不解决“历史赛季详情弹窗读取当前公开卡”的漂移问题

- [ ] **Step 2: 运行本轮新增测试**

Run:

```bash
bun test tests/leaderboard-season-extrema.test.ts
bun test tests/season-archive-ranking-extrema.test.ts
bun test tests/arena-leaderboard-season-extrema.test.ts
bun test tests/leaderboard-season-extrema-block.test.tsx
```

Expected: 全部 PASS

- [ ] **Step 3: 运行 lint**

Run: `bun run lint`
Expected: PASS，无新增 lint 错误

- [ ] **Step 4: 运行全量测试**

Run: `bun test`
Expected: PASS，至少不出现与排行榜/赛季归档相关的回归

- [ ] **Step 5: 运行生产构建**

Run: `bun run build`
Expected: PASS，Next.js 生产构建成功

- [ ] **Step 6: 最终提交**

```bash
git add docs/RANKING_SEASON_SETTLEMENT_RUNBOOK.md
git commit -m "docs: clarify ranking archive season extrema"
```

---

## 备注

- 本计划刻意把可测逻辑抽到 `lib/ranking/season-extrema.ts` 与 `lib/season-archive/snapshot.ts`，避免把 season 映射细节埋进大文件后难以回归。
- `LeaderboardItem` 的 season 字段建议保持 **additive / optional**，这样不会强迫同步修改排行榜搜索接口与其他 `/api/arena/leaderboard` 消费方。
- 若在执行时发现 `RankingPage.tsx` 再继续膨胀，可以在不改行为的前提下把历史快照解析 helper 再拆到 `lib/ranking/` 下，但这不是本计划的必做项。
