import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { arenaRatings } from '@/lib/db/schema';
import { ensureArenaRatingsExist } from '@/lib/db/repositories/arena-ratings-write';
import {
  getArenaRatingsByDataCardId as getArenaRatingsByDataCardIdReader,
  getStrictArenaRatingsByDataCardIds,
} from '@/lib/db/repositories/data-card-meta';

describe('data-card meta season extrema schema', () => {
  test('arena_ratings 季度极值字段名保持 snake_case', () => {
    const columns = arenaRatings as Record<string, { name: string } | undefined>;

    expect(columns.seasonPeakRating?.name).toBe('season_peak_rating');
    expect(columns.seasonPeakGames?.name).toBe('season_peak_games');
    expect(columns.seasonPeakAt?.name).toBe('season_peak_at');
    expect(columns.seasonPeakTier?.name).toBe('season_peak_tier');
    expect(columns.seasonLowRating?.name).toBe('season_low_rating');
    expect(columns.seasonLowGames?.name).toBe('season_low_games');
    expect(columns.seasonLowAt?.name).toBe('season_low_at');
  });

  test('getArenaRatingsByDataCardId 读取 projection 包含季节极值字段', async () => {
    let capturedProjection: Record<string, unknown> | null = null;

    const fakeDb = {
      select: (projection: Record<string, unknown>) => {
        capturedProjection = projection;
        return {
          from: () => ({
            where: async () => [],
          }),
        };
      },
    } as unknown as Parameters<typeof getArenaRatingsByDataCardIdReader>[0];

    await getArenaRatingsByDataCardIdReader(fakeDb, 'card_1', ['strict', 'free']);

    expect(capturedProjection).toBeTruthy();
    expect(capturedProjection?.seasonPeakRating).toBeTruthy();
    expect(capturedProjection?.seasonPeakGames).toBeTruthy();
    expect(capturedProjection?.seasonPeakAt).toBeTruthy();
    expect(capturedProjection?.seasonPeakTier).toBeTruthy();
    expect(capturedProjection?.seasonLowRating).toBeTruthy();
    expect(capturedProjection?.seasonLowGames).toBeTruthy();
    expect(capturedProjection?.seasonLowAt).toBeTruthy();
  });

  test('getStrictArenaRatingsByDataCardIds 读取 projection 包含季节极值字段', async () => {
    let capturedProjection: Record<string, unknown> | null = null;

    const fakeDb = {
      select: (projection: Record<string, unknown>) => {
        capturedProjection = projection;
        return {
          from: () => ({
            where: async () => [],
          }),
        };
      },
    } as unknown as Parameters<typeof getStrictArenaRatingsByDataCardIds>[0];

    await getStrictArenaRatingsByDataCardIds(fakeDb, ['card_1']);

    expect(capturedProjection).toBeTruthy();
    expect(capturedProjection?.seasonPeakRating).toBeTruthy();
    expect(capturedProjection?.seasonPeakGames).toBeTruthy();
    expect(capturedProjection?.seasonPeakAt).toBeTruthy();
    expect(capturedProjection?.seasonPeakTier).toBeTruthy();
    expect(capturedProjection?.seasonLowRating).toBeTruthy();
    expect(capturedProjection?.seasonLowGames).toBeTruthy();
    expect(capturedProjection?.seasonLowAt).toBeTruthy();
  });

  test('ensureArenaRatingsExist strict 初始化写入 season extrema', async () => {
    let capturedValues: Record<string, unknown>[] | null = null;

    const fakeDb = {
      insert: (_table: unknown) => ({
        values: (values: Record<string, unknown>[]) => {
          capturedValues = values;
          return {
            onConflictDoNothing: async () => {},
          };
        },
      }),
    } as unknown as Parameters<typeof ensureArenaRatingsExist>[0];

    await ensureArenaRatingsExist(
      fakeDb,
      'strict',
      [
        { entityType: 'data_card', entityId: 'card_a' },
        { entityType: 'data_card', entityId: 'card_b' },
      ],
      1200,
      '2026-03-25T00:00:00.000Z',
    );

    expect(capturedValues).toBeTruthy();
    expect(capturedValues?.length).toBe(2);
    const first = capturedValues?.[0] ?? {};
    expect(first.seasonPeakRating).toBe(1200);
    expect(first.seasonPeakGames).toBe(0);
    expect(first.seasonPeakAt).toBe('2026-03-25T00:00:00.000Z');
    expect(first.seasonPeakTier).toBe('无牌');
    expect(first.seasonLowRating).toBe(1200);
    expect(first.seasonLowGames).toBe(0);
    expect(first.seasonLowAt).toBe('2026-03-25T00:00:00.000Z');
  });

  test('ensureArenaRatingsExist free 初始化 season extrema 为空', async () => {
    let capturedValues: Record<string, unknown>[] | null = null;

    const fakeDb = {
      insert: (_table: unknown) => ({
        values: (values: Record<string, unknown>[]) => {
          capturedValues = values;
          return {
            onConflictDoNothing: async () => {},
          };
        },
      }),
    } as unknown as Parameters<typeof ensureArenaRatingsExist>[0];

    await ensureArenaRatingsExist(
      fakeDb,
      'free',
      [
        { entityType: 'preset', entityId: 'M01' },
        { entityType: 'data_card', entityId: 'card_c' },
      ],
      1000,
      '2026-03-25T00:00:00.000Z',
    );

    expect(capturedValues).toBeTruthy();
    expect(capturedValues?.length).toBe(2);
    const first = capturedValues?.[0] ?? {};
    expect(first.seasonPeakRating).toBe(null);
    expect(first.seasonPeakGames).toBe(null);
    expect(first.seasonPeakAt).toBe(null);
    expect(first.seasonPeakTier).toBe(null);
    expect(first.seasonLowRating).toBe(null);
    expect(first.seasonLowGames).toBe(null);
    expect(first.seasonLowAt).toBe(null);
  });

  test('migration 只对 strict 回填 season extrema', () => {
    const migrationPath = join(process.cwd(), 'drizzle/0005_strict_season_extrema.sql');
    const content = readFileSync(migrationPath, 'utf8');

    expect(content.includes("WHERE queue = 'strict'")).toBe(true);
    expect(content.includes('season_peak_tier = CASE')).toBe(true);
    expect(content.includes("queue = 'free'")).toBe(false);
  });
});
