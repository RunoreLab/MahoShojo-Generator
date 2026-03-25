import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { getArenaTierRank, type ArenaTier } from '@/lib/arena/tier';

type MockQueenEntity = { entityType: 'data_card' | 'preset'; entityId: string } | null;

const mockState = {
  queen: null as MockQueenEntity,
  queenCalls: 0,
};

mock.module('@/lib/db/repositories/data-card-meta', () => ({
  queryArenaPublicQueenEntityByQueue: async () => {
    mockState.queenCalls += 1;
    return mockState.queen;
  },
}));

type TestEntity = { entityType: 'data_card' | 'preset'; entityId: string };
type TestSnapshot = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

type TestComputed = {
  aBefore: TestSnapshot;
  bBefore: TestSnapshot;
  aAfter: TestSnapshot;
  bAfter: TestSnapshot;
  deltaA: number;
  deltaB: number;
  detailsJson: Record<string, unknown>;
};

type RatingRow = {
  queue: 'strict' | 'free';
  entityType: 'data_card' | 'preset';
  entityId: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  seasonPeakRating: number | null;
  seasonPeakGames: number | null;
  seasonPeakAt: string | null;
  seasonPeakTier: string | null;
  seasonLowRating: number | null;
  seasonLowGames: number | null;
  seasonLowAt: string | null;
  lastDelta: number | null;
  lastAppliedAt: string | null;
  updatedAt: string | null;
};

const keyOf = (entity: TestEntity): string => `${entity.entityType}:${entity.entityId}`;

const sqlContainsColumn = (value: unknown, columnName: string, seen = new Set<unknown>()): boolean => {
  if (value == null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  const maybeColumn = value as { name?: unknown };
  if (typeof maybeColumn.name === 'string' && maybeColumn.name === columnName) return true;

  if (Array.isArray(value)) {
    return value.some((item) => sqlContainsColumn(item, columnName, seen));
  }

  const maybeSql = value as { queryChunks?: unknown[] };
  if (Array.isArray(maybeSql.queryChunks)) {
    return maybeSql.queryChunks.some((chunk) => sqlContainsColumn(chunk, columnName, seen));
  }

  return false;
};

const mapProjectedRow = (row: RatingRow, projection: Record<string, unknown>): Record<string, unknown> => {
  const mapped: Record<string, unknown> = {};
  for (const key of Object.keys(projection)) {
    mapped[key] = key in row ? (row as Record<string, unknown>)[key] : null;
  }
  return mapped;
};

const cloneRow = (row: RatingRow): RatingRow => ({ ...row });

const buildStrictRow = (
  entity: TestEntity,
  snapshot: TestSnapshot,
  seasonPeakTier: string | null,
  nowIso: string,
): RatingRow => ({
  queue: 'strict',
  entityType: entity.entityType,
  entityId: entity.entityId,
  rating: snapshot.rating,
  games: snapshot.games,
  wins: snapshot.wins,
  losses: snapshot.losses,
  draws: snapshot.draws,
  seasonPeakRating: snapshot.rating,
  seasonPeakGames: snapshot.games,
  seasonPeakAt: nowIso,
  seasonPeakTier,
  seasonLowRating: snapshot.rating,
  seasonLowGames: snapshot.games,
  seasonLowAt: nowIso,
  lastDelta: null,
  lastAppliedAt: null,
  updatedAt: nowIso,
});

const buildComputed = (overrides?: Partial<TestComputed>): TestComputed => ({
  aBefore: { rating: 1200, games: 5, wins: 3, losses: 2, draws: 0 },
  bBefore: { rating: 1200, games: 5, wins: 3, losses: 2, draws: 0 },
  aAfter: { rating: 1300, games: 6, wins: 4, losses: 2, draws: 0 },
  bAfter: { rating: 1100, games: 6, wins: 3, losses: 3, draws: 0 },
  deltaA: 100,
  deltaB: -100,
  detailsJson: {},
  ...overrides,
});

const createFakeDb = (params: {
  entities: [TestEntity, TestEntity];
  computed: TestComputed;
  initialRows: RatingRow[];
  enforcePromotionRatingGamesGuardFromWhere?: boolean;
  advanceRowsAfterMainUpdate?: (rows: Map<string, RatingRow>) => void;
  promotionTargets?: TestEntity[];
  throwOnPromotion?: boolean;
}) => {
  const rows = new Map<string, RatingRow>(params.initialRows.map((row) => [keyOf(row), cloneRow(row)]));
  let promotionCallIndex = 0;

  const applyMainUpdate = () => {
    const aRow = rows.get(keyOf(params.entities[0]));
    const bRow = rows.get(keyOf(params.entities[1]));
    if (!aRow || !bRow) return;
    aRow.rating = params.computed.aAfter.rating;
    aRow.games = params.computed.aAfter.games;
    aRow.wins = params.computed.aAfter.wins;
    aRow.losses = params.computed.aAfter.losses;
    aRow.draws = params.computed.aAfter.draws;
    bRow.rating = params.computed.bAfter.rating;
    bRow.games = params.computed.bAfter.games;
    bRow.wins = params.computed.bAfter.wins;
    bRow.losses = params.computed.bAfter.losses;
    bRow.draws = params.computed.bAfter.draws;
    params.advanceRowsAfterMainUpdate?.(rows);
  };

  const fakeDb = {
    select: (projection: Record<string, unknown>) => ({
      from: () => ({
        where: async () => Array.from(rows.values()).map((row) => mapProjectedRow(row, projection)),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        const isMainUpdate = Object.prototype.hasOwnProperty.call(payload, 'rating');
        const isPromotionUpdate =
          !isMainUpdate &&
          Object.keys(payload).length === 1 &&
          Object.prototype.hasOwnProperty.call(payload, 'seasonPeakTier');

        if (isMainUpdate) {
          return {
            where: () => ({
              returning: async () => {
                applyMainUpdate();
                return [
                  { entityType: params.entities[0].entityType, entityId: params.entities[0].entityId },
                  { entityType: params.entities[1].entityType, entityId: params.entities[1].entityId },
                ];
              },
            }),
          };
        }

        if (isPromotionUpdate) {
          return {
            where: async (whereExpr: unknown) => {
              if (params.throwOnPromotion) {
                throw new Error('promotion failed');
              }

              const entity = params.promotionTargets?.[promotionCallIndex] ?? params.entities[promotionCallIndex];
              const after =
                entity && entity.entityType === params.entities[0].entityType && entity.entityId === params.entities[0].entityId
                  ? params.computed.aAfter
                  : params.computed.bAfter;
              promotionCallIndex += 1;
              if (!entity) return [];

              const row = rows.get(keyOf(entity));
              if (!row) return [];

              if (params.enforcePromotionRatingGamesGuardFromWhere) {
                const hasRatingGuard = sqlContainsColumn(whereExpr, 'rating');
                const hasGamesGuard = sqlContainsColumn(whereExpr, 'games');
                if ((hasRatingGuard || hasGamesGuard) && (row.rating !== after.rating || row.games !== after.games)) {
                  return [];
                }
              }

              const nextTier = typeof payload.seasonPeakTier === 'string' ? payload.seasonPeakTier : null;
              if (!nextTier) return [];
              if (getArenaTierRank(nextTier as ArenaTier) > getArenaTierRank(row.seasonPeakTier as ArenaTier | null)) {
                row.seasonPeakTier = nextTier;
              }
              return [];
            },
          };
        }

        return {
          where: async () => [],
        };
      },
    }),
  };

  return {
    db: fakeDb as unknown,
    getRow: (entity: TestEntity): RatingRow | undefined => rows.get(keyOf(entity)),
  };
};

describe('arena-ratings-write season peak tier promotion', () => {
  const nowIso = '2026-03-25T00:00:00.000Z';
  const appliedAtIso = '2026-03-25T00:01:00.000Z';
  const entities: [TestEntity, TestEntity] = [
    { entityType: 'data_card', entityId: 'card_a' },
    { entityType: 'data_card', entityId: 'card_b' },
  ];

  beforeEach(() => {
    mockState.queen = null;
    mockState.queenCalls = 0;
  });

  test('行已前进到别的 rating/games 时仍可幂等提升 seasonPeakTier', async () => {
    const { applyArenaRatingsUpdateIfBothMatch } = await import('@/lib/db/repositories/arena-ratings-write');
    const computed = buildComputed({
      aAfter: { rating: 1300, games: 6, wins: 4, losses: 2, draws: 0 },
    });
    const { db, getRow } = createFakeDb({
      entities,
      computed,
      initialRows: [
        buildStrictRow(entities[0], computed.aBefore, '无牌', nowIso),
        buildStrictRow(entities[1], computed.bBefore, '无牌', nowIso),
      ],
      enforcePromotionRatingGamesGuardFromWhere: true,
      advanceRowsAfterMainUpdate: (rows) => {
        const aRow = rows.get(keyOf(entities[0]));
        if (!aRow) return;
        aRow.rating = 1400;
        aRow.games = 7;
      },
    });

    const result = await applyArenaRatingsUpdateIfBothMatch(
      db as Parameters<typeof applyArenaRatingsUpdateIfBothMatch>[0],
      'strict',
      entities,
      computed,
      appliedAtIso,
    );

    expect(result).toBe('applied');
    expect(getRow(entities[0])?.seasonPeakTier).toBe('花牌');
  });

  test('already-applied 仍会执行 seasonPeakTier 幂等提升', async () => {
    const { applyArenaRatingsUpdateIfBothMatch } = await import('@/lib/db/repositories/arena-ratings-write');
    const computed = buildComputed({
      aAfter: { rating: 1500, games: 6, wins: 4, losses: 2, draws: 0 },
      bAfter: { rating: 1500, games: 6, wins: 4, losses: 2, draws: 0 },
    });
    const { db, getRow } = createFakeDb({
      entities,
      computed,
      initialRows: [
        buildStrictRow(entities[0], computed.aAfter, '无牌', nowIso),
        buildStrictRow(entities[1], computed.bAfter, '无牌', nowIso),
      ],
      enforcePromotionRatingGamesGuardFromWhere: true,
    });

    const result = await applyArenaRatingsUpdateIfBothMatch(
      db as Parameters<typeof applyArenaRatingsUpdateIfBothMatch>[0],
      'strict',
      entities,
      computed,
      appliedAtIso,
    );

    expect(result).toBe('already-applied');
    expect(mockState.queenCalls).toBe(1);
    expect(getRow(entities[0])?.seasonPeakTier).toBe('权杖');
    expect(getRow(entities[1])?.seasonPeakTier).toBe('权杖');
  });

  test('seasonPeakTier 提升失败会向上传递错误，不允许静默吞掉', async () => {
    const { applyArenaRatingsUpdateIfBothMatch } = await import('@/lib/db/repositories/arena-ratings-write');
    const computed = buildComputed();
    const { db } = createFakeDb({
      entities,
      computed,
      initialRows: [
        buildStrictRow(entities[0], computed.aBefore, '无牌', nowIso),
        buildStrictRow(entities[1], computed.bBefore, '无牌', nowIso),
      ],
      throwOnPromotion: true,
    });

    await expect(
      applyArenaRatingsUpdateIfBothMatch(
        db as Parameters<typeof applyArenaRatingsUpdateIfBothMatch>[0],
        'strict',
        entities,
        computed,
        appliedAtIso,
      ),
    ).rejects.toThrow('promotion failed');
  });

  test('单调性：queen 窗口变化后 seasonPeakTier 只能升不能降', async () => {
    const { applyArenaRatingsUpdateIfBothMatch } = await import('@/lib/db/repositories/arena-ratings-write');
    const computed = buildComputed({
      aAfter: { rating: 1600, games: 7, wins: 5, losses: 2, draws: 0 },
      bAfter: { rating: 1500, games: 6, wins: 4, losses: 2, draws: 0 },
    });

    const { db, getRow } = createFakeDb({
      entities,
      computed,
      initialRows: [
        buildStrictRow(entities[0], computed.aAfter, '女王', nowIso),
        buildStrictRow(entities[1], computed.bAfter, '权杖', nowIso),
      ],
      enforcePromotionRatingGamesGuardFromWhere: true,
    });

    const result = await applyArenaRatingsUpdateIfBothMatch(
      db as Parameters<typeof applyArenaRatingsUpdateIfBothMatch>[0],
      'strict',
      entities,
      computed,
      appliedAtIso,
    );

    expect(result).toBe('already-applied');
    expect(getRow(entities[0])?.seasonPeakTier).toBe('女王');
  });

  test('strict 结算后若当前女王不是参赛双方，也会提升当前女王的 seasonPeakTier', async () => {
    const { applyArenaRatingsUpdateIfBothMatch } = await import('@/lib/db/repositories/arena-ratings-write');
    const queenEntity: TestEntity = { entityType: 'data_card', entityId: 'card_queen' };
    mockState.queen = queenEntity;

    const computed = buildComputed({
      aAfter: { rating: 1490, games: 20, wins: 12, losses: 8, draws: 0 },
      bAfter: { rating: 1400, games: 20, wins: 10, losses: 10, draws: 0 },
    });

    const { db, getRow } = createFakeDb({
      entities,
      computed,
      initialRows: [
        buildStrictRow(entities[0], computed.aBefore, '花牌', nowIso),
        buildStrictRow(entities[1], computed.bBefore, '花牌', nowIso),
        buildStrictRow(
          queenEntity,
          { rating: 1570, games: 180, wins: 172, losses: 8, draws: 0 },
          '权杖',
          nowIso,
        ),
      ],
      promotionTargets: [queenEntity],
    });

    const result = await applyArenaRatingsUpdateIfBothMatch(
      db as Parameters<typeof applyArenaRatingsUpdateIfBothMatch>[0],
      'strict',
      entities,
      computed,
      appliedAtIso,
    );

    expect(result).toBe('applied');
    expect(getRow(queenEntity)?.seasonPeakTier).toBe('女王');
  });
});
