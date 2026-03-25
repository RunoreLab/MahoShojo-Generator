import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  mapArenaRatingEventReadRow,
  mapArenaRatingSnapshotRow,
  type ArenaRatingEventReadRow,
  type ArenaRatingSnapshotRow,
} from '@/lib/db/repositories/arena-read-mappers';
export type { ArenaRatingEventReadRow, ArenaRatingSnapshotRow } from '@/lib/db/repositories/arena-read-mappers';
import {
  arenaRatingEvents,
  arenaRatings,
  battles,
  characters,
  dataCardMetrics,
  dataCards,
  dataCardTags,
  users,
} from '@/lib/db/schema';

export type ArenaReadQueue = 'strict' | 'free';
export type ArenaReadEntityType = 'data_card' | 'preset';
export type ArenaReadSort = 'rating' | 'tech';
export type ArenaReadSortOrder = 'asc' | 'desc';
export type StatsLeaderboardMode = 'all' | 'preset' | 'user';

type ArenaLeaderboardCommonOptions = {
  queue: ArenaReadQueue;
  sort: ArenaReadSort;
  order: ArenaReadSortOrder;
  includePresets: 0 | 1;
  tagIds: string[];
  excludeTagIds: string[];
  isNative: '0' | '1' | 'any';
  minRating: number | null;
  maxRating: number | null;
  minGames: number | null;
  maxGames: number | null;
  minTechScore: number | null;
  maxTechScore: number | null;
  limit: number;
};

type ArenaLeaderboardSelectRow = {
  entityType: ArenaReadEntityType;
  entityId: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  updatedAt: string;
  dataCardName: string | null;
  authorName: string | null;
  techScore: number | null;
  techLevel: string | null;
  isNative: boolean | null;
  seasonPeakRating: number | null;
  seasonPeakGames: number | null;
  seasonPeakAt: string | null;
  seasonPeakTier: string | null;
  seasonLowRating: number | null;
  seasonLowGames: number | null;
  seasonLowAt: string | null;
};

export type ArenaLeaderboardRow = ArenaLeaderboardSelectRow & {
  tagIds: string[];
};

export type CharacterWinRateRankRow = {
  name: string;
  isPreset: boolean;
  wins: number;
  participations: number;
};

export type CharacterCountRankRow = {
  name: string;
  isPreset: boolean;
  count: number;
};

const toInteger = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
};

const normalizeLimit = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
};

const buildStrictPublicSinceClause = (): SQL =>
  sql`(
    ${dataCards.publicSince} IS NULL
    OR ${dataCards.publicSince} <= datetime('now', '-3 days')
    OR (
      ${dataCards.createdAt} IS NOT NULL
      AND ${dataCards.publicSince} IS NOT NULL
      AND ABS(strftime('%s', ${dataCards.publicSince}) - strftime('%s', ${dataCards.createdAt})) <= 600
    )
  )`;

const buildPublicDataCardCondition = (queue: ArenaReadQueue): SQL => {
  const conditions: SQL[] = [
    eq(dataCards.type, 'character'),
    eq(dataCards.isPublic, true),
    eq(dataCards.reviewStatus, 'approved'),
    isNull(dataCards.deletedAt),
  ];
  if (queue === 'strict') {
    conditions.push(buildStrictPublicSinceClause());
  }
  return and(...conditions)!;
};

const buildLeaderboardOrderBy = (sort: ArenaReadSort, order: ArenaReadSortOrder): SQL[] => {
  if (sort === 'tech') {
    return [
      asc(sql`(${dataCardMetrics.techScore} IS NULL)`),
      order === 'asc' ? asc(dataCardMetrics.techScore) : desc(dataCardMetrics.techScore),
      desc(arenaRatings.rating),
      desc(arenaRatings.games),
      desc(arenaRatings.updatedAt),
      asc(arenaRatings.entityType),
      asc(arenaRatings.entityId),
    ];
  }

  return [
    order === 'asc' ? asc(arenaRatings.rating) : desc(arenaRatings.rating),
    desc(arenaRatings.games),
    desc(arenaRatings.updatedAt),
    asc(arenaRatings.entityType),
    asc(arenaRatings.entityId),
  ];
};

const sanitizeTagIds = (tagIds: string[]): string[] =>
  Array.from(
    new Set(
      tagIds
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    ),
  );

const buildLeaderboardWhereConditions = (
  db: AppDrizzleDb,
  options: ArenaLeaderboardCommonOptions,
): SQL[] => {
  const conditions: SQL[] = [eq(arenaRatings.queue, options.queue)];

  if (options.includePresets === 0) {
    conditions.push(eq(arenaRatings.entityType, 'data_card'));
  }

  const publicDataCardCondition = buildPublicDataCardCondition(options.queue);
  if (options.includePresets === 1) {
    conditions.push(
      or(
        eq(arenaRatings.entityType, 'preset'),
        and(eq(arenaRatings.entityType, 'data_card'), publicDataCardCondition),
      )!,
    );
  } else {
    conditions.push(and(eq(arenaRatings.entityType, 'data_card'), publicDataCardCondition)!);
  }

  const includeTagIds = sanitizeTagIds(options.tagIds);
  if (includeTagIds.length > 0) {
    const includeTagSubquery = db
      .select({ one: sql<number>`1` })
      .from(dataCardTags)
      .where(and(eq(dataCardTags.dataCardId, arenaRatings.entityId), inArray(dataCardTags.tagId, includeTagIds)));

    conditions.push(
      or(
        eq(arenaRatings.entityType, 'preset'),
        and(eq(arenaRatings.entityType, 'data_card'), exists(includeTagSubquery)),
      )!,
    );
  }

  const excludeTagIds = sanitizeTagIds(options.excludeTagIds);
  if (excludeTagIds.length > 0) {
    const excludeTagSubquery = db
      .select({ one: sql<number>`1` })
      .from(dataCardTags)
      .where(and(eq(dataCardTags.dataCardId, arenaRatings.entityId), inArray(dataCardTags.tagId, excludeTagIds)));

    conditions.push(
      or(
        eq(arenaRatings.entityType, 'preset'),
        and(eq(arenaRatings.entityType, 'data_card'), notExists(excludeTagSubquery)),
      )!,
    );
  }

  if (options.isNative === '1') {
    conditions.push(and(eq(arenaRatings.entityType, 'data_card'), eq(dataCardMetrics.isNative, true))!);
  } else if (options.isNative === '0') {
    conditions.push(and(eq(arenaRatings.entityType, 'data_card'), eq(dataCardMetrics.isNative, false))!);
  }

  if (typeof options.minRating === 'number') {
    conditions.push(gte(arenaRatings.rating, options.minRating));
  }
  if (typeof options.maxRating === 'number') {
    conditions.push(lte(arenaRatings.rating, options.maxRating));
  }
  if (typeof options.minGames === 'number') {
    conditions.push(gte(arenaRatings.games, options.minGames));
  }
  if (typeof options.maxGames === 'number') {
    conditions.push(lte(arenaRatings.games, options.maxGames));
  }

  if (typeof options.minTechScore === 'number' || typeof options.maxTechScore === 'number') {
    conditions.push(and(eq(arenaRatings.entityType, 'data_card'), isNotNull(dataCardMetrics.techScore))!);
    if (typeof options.minTechScore === 'number') {
      conditions.push(gte(dataCardMetrics.techScore, options.minTechScore));
    }
    if (typeof options.maxTechScore === 'number') {
      conditions.push(lte(dataCardMetrics.techScore, options.maxTechScore));
    }
  }

  return conditions;
};

const getDataCardTagMapByIds = async (db: AppDrizzleDb, dataCardIds: string[]): Promise<Map<string, string[]>> => {
  const map = new Map<string, string[]>();
  if (dataCardIds.length === 0) return map;

  const rows = await db
    .select({
      dataCardId: dataCardTags.dataCardId,
      tagId: dataCardTags.tagId,
    })
    .from(dataCardTags)
    .where(inArray(dataCardTags.dataCardId, dataCardIds));

  rows.forEach((row) => {
    const dataCardId = typeof row.dataCardId === 'string' ? row.dataCardId.trim() : '';
    const tagId = typeof row.tagId === 'string' ? row.tagId.trim() : '';
    if (!dataCardId || !tagId) return;

    const list = map.get(dataCardId) ?? [];
    list.push(tagId);
    map.set(dataCardId, list);
  });

  return map;
};

const selectArenaLeaderboardRows = async (
  db: AppDrizzleDb,
  options: ArenaLeaderboardCommonOptions,
  whereExtras: SQL[],
  offset: number,
): Promise<ArenaLeaderboardRow[]> => {
  const whereConditions = buildLeaderboardWhereConditions(db, options);
  if (whereExtras.length > 0) {
    whereConditions.push(...whereExtras);
  }

  const rows = await db
    .select({
      entityType: arenaRatings.entityType,
      entityId: arenaRatings.entityId,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
      wins: arenaRatings.wins,
      losses: arenaRatings.losses,
      draws: arenaRatings.draws,
      updatedAt: arenaRatings.updatedAt,
      dataCardName: dataCards.name,
      authorName: users.username,
      techScore: dataCardMetrics.techScore,
      techLevel: dataCardMetrics.techLevel,
      isNative: dataCardMetrics.isNative,
      seasonPeakRating: arenaRatings.seasonPeakRating,
      seasonPeakGames: arenaRatings.seasonPeakGames,
      seasonPeakAt: arenaRatings.seasonPeakAt,
      seasonPeakTier: arenaRatings.seasonPeakTier,
      seasonLowRating: arenaRatings.seasonLowRating,
      seasonLowGames: arenaRatings.seasonLowGames,
      seasonLowAt: arenaRatings.seasonLowAt,
    })
    .from(arenaRatings)
    .leftJoin(dataCards, and(eq(arenaRatings.entityType, 'data_card'), eq(dataCards.id, arenaRatings.entityId)))
    .leftJoin(users, eq(dataCards.userId, users.id))
    .leftJoin(dataCardMetrics, and(eq(arenaRatings.entityType, 'data_card'), eq(dataCardMetrics.dataCardId, arenaRatings.entityId)))
    .where(and(...whereConditions))
    .orderBy(...buildLeaderboardOrderBy(options.sort, options.order))
    .limit(normalizeLimit(options.limit, 1, 200))
    .offset(Math.max(0, Math.floor(offset)));

  const normalizedRows: ArenaLeaderboardSelectRow[] = rows.map((row) => ({
    entityType: row.entityType === 'preset' ? 'preset' : 'data_card',
    entityId: typeof row.entityId === 'string' ? row.entityId : '',
    rating: toInteger(row.rating, 0),
    games: toInteger(row.games, 0),
    wins: toInteger(row.wins, 0),
    losses: toInteger(row.losses, 0),
    draws: toInteger(row.draws, 0),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    dataCardName: typeof row.dataCardName === 'string' ? row.dataCardName : null,
    authorName: typeof row.authorName === 'string' ? row.authorName : null,
    techScore: typeof row.techScore === 'number' ? row.techScore : null,
    techLevel: typeof row.techLevel === 'string' ? row.techLevel : null,
    isNative: typeof row.isNative === 'boolean' ? row.isNative : null,
    seasonPeakRating: typeof row.seasonPeakRating === 'number' ? toInteger(row.seasonPeakRating, 0) : null,
    seasonPeakGames: typeof row.seasonPeakGames === 'number' ? toInteger(row.seasonPeakGames, 0) : null,
    seasonPeakAt: typeof row.seasonPeakAt === 'string' ? row.seasonPeakAt : null,
    seasonPeakTier: typeof row.seasonPeakTier === 'string' ? row.seasonPeakTier : null,
    seasonLowRating: typeof row.seasonLowRating === 'number' ? toInteger(row.seasonLowRating, 0) : null,
    seasonLowGames: typeof row.seasonLowGames === 'number' ? toInteger(row.seasonLowGames, 0) : null,
    seasonLowAt: typeof row.seasonLowAt === 'string' ? row.seasonLowAt : null,
  }));

  const dataCardIds = normalizedRows
    .filter((row) => row.entityType === 'data_card')
    .map((row) => row.entityId)
    .filter((value) => value.length > 0);
  const tagMap = await getDataCardTagMapByIds(db, dataCardIds);

  return normalizedRows.map((row) => ({
    ...row,
    tagIds: row.entityType === 'data_card' ? tagMap.get(row.entityId) ?? [] : [],
  }));
};

const buildCharactersModeCondition = (mode: StatsLeaderboardMode): SQL | null => {
  if (mode === 'preset') return eq(characters.isPreset, true);
  if (mode === 'user') return eq(characters.isPreset, false);
  return null;
};

export const getArenaRatingByEntity = async (
  db: AppDrizzleDb,
  queue: ArenaReadQueue,
  entityType: ArenaReadEntityType,
  entityId: string,
): Promise<{ rating: number; games: number } | null> => {
  const rows = await db
    .select({
      rating: arenaRatings.rating,
      games: arenaRatings.games,
    })
    .from(arenaRatings)
    .where(
      and(
        eq(arenaRatings.queue, queue),
        eq(arenaRatings.entityType, entityType),
        eq(arenaRatings.entityId, entityId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    rating: toInteger(row.rating, 0),
    games: Math.max(0, toInteger(row.games, 0)),
  };
};

export const listArenaPublicScepterEntities = async (
  db: AppDrizzleDb,
  queue: ArenaReadQueue,
  options: {
    minGames: number;
    minRating: number;
    limit: number;
  },
): Promise<Array<{ entityType: ArenaReadEntityType; entityId: string }>> => {
  const minGames = Math.max(0, toInteger(options.minGames, 0));
  const minRating = toInteger(options.minRating, 0);
  const limit = normalizeLimit(options.limit, 1, 200);

  const rows = await db
    .select({
      entityType: arenaRatings.entityType,
      entityId: arenaRatings.entityId,
    })
    .from(arenaRatings)
    .leftJoin(dataCards, and(eq(arenaRatings.entityType, 'data_card'), eq(dataCards.id, arenaRatings.entityId)))
    .where(
      and(
        eq(arenaRatings.queue, queue),
        gte(arenaRatings.games, minGames),
        gte(arenaRatings.rating, minRating),
        or(
          eq(arenaRatings.entityType, 'preset'),
          and(eq(arenaRatings.entityType, 'data_card'), buildPublicDataCardCondition(queue)),
        ),
      ),
    )
    .orderBy(
      desc(arenaRatings.rating),
      desc(arenaRatings.games),
      desc(arenaRatings.updatedAt),
      asc(arenaRatings.entityType),
      asc(arenaRatings.entityId),
    )
    .limit(limit);

  return rows.map((row) => ({
    entityType: row.entityType === 'preset' ? 'preset' : 'data_card',
    entityId: typeof row.entityId === 'string' ? row.entityId : '',
  }));
};

export const getPresetArenaRatingsByEntityId = async (
  db: AppDrizzleDb,
  entityId: string,
): Promise<
  Array<{
    queue: ArenaReadQueue;
    rating: number;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  }>
> => {
  const rows = await db
    .select({
      queue: arenaRatings.queue,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
      wins: arenaRatings.wins,
      losses: arenaRatings.losses,
      draws: arenaRatings.draws,
    })
    .from(arenaRatings)
    .where(
      and(
        eq(arenaRatings.entityType, 'preset'),
        eq(arenaRatings.entityId, entityId),
        inArray(arenaRatings.queue, ['strict', 'free']),
      ),
    );

  return rows.map((row) => ({
    queue: row.queue === 'free' ? 'free' : 'strict',
    rating: toInteger(row.rating, 0),
    games: Math.max(0, toInteger(row.games, 0)),
    wins: Math.max(0, toInteger(row.wins, 0)),
    losses: Math.max(0, toInteger(row.losses, 0)),
    draws: Math.max(0, toInteger(row.draws, 0)),
  }));
};

export const getArenaRatingEventsByIds = async (
  db: AppDrizzleDb,
  eventIds: string[],
): Promise<ArenaRatingEventReadRow[]> => {
  const ids = Array.from(new Set(eventIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      queue: arenaRatingEvents.queue,
      status: arenaRatingEvents.status,
      skip_reason: arenaRatingEvents.skipReason,
      details_json: arenaRatingEvents.detailsJson,
      a_entity_type: arenaRatingEvents.aEntityType,
      a_entity_id: arenaRatingEvents.aEntityId,
      b_entity_type: arenaRatingEvents.bEntityType,
      b_entity_id: arenaRatingEvents.bEntityId,
      a_before_rating: arenaRatingEvents.aBeforeRating,
      a_after_rating: arenaRatingEvents.aAfterRating,
      a_delta: arenaRatingEvents.aDelta,
      a_before_games: arenaRatingEvents.aBeforeGames,
      a_after_games: arenaRatingEvents.aAfterGames,
      b_before_rating: arenaRatingEvents.bBeforeRating,
      b_after_rating: arenaRatingEvents.bAfterRating,
      b_delta: arenaRatingEvents.bDelta,
      b_before_games: arenaRatingEvents.bBeforeGames,
      b_after_games: arenaRatingEvents.bAfterGames,
    })
    .from(arenaRatingEvents)
    .where(inArray(arenaRatingEvents.id, ids));

  return rows.map((row) => mapArenaRatingEventReadRow(row as Record<string, unknown>));
};

export const getArenaRatingsByEntities = async (
  db: AppDrizzleDb,
  entities: Array<{ entityType: ArenaReadEntityType; entityId: string }>,
  queues: ArenaReadQueue[] = ['strict', 'free'],
): Promise<ArenaRatingSnapshotRow[]> => {
  const normalizedEntities: Array<{ entityType: ArenaReadEntityType; entityId: string }> = Array.from(
    new Map(
      entities
        .map((entity) => ({
          entityType: (entity.entityType === 'preset' ? 'preset' : 'data_card') as ArenaReadEntityType,
          entityId: typeof entity.entityId === 'string' ? entity.entityId.trim() : '',
        }))
        .filter((entity) => entity.entityId.length > 0)
        .map((entity) => [`${entity.entityType}:${entity.entityId}`, entity]),
    ).values(),
  );
  if (normalizedEntities.length === 0) return [];

  const normalizedQueues = Array.from(
    new Set(
      queues
        .map((queue) => (queue === 'free' ? 'free' : 'strict'))
        .filter((queue): queue is ArenaReadQueue => queue === 'strict' || queue === 'free'),
    ),
  );
  if (normalizedQueues.length === 0) return [];

  const entityCondition = or(
    ...normalizedEntities.map((entity) =>
      and(eq(arenaRatings.entityType, entity.entityType), eq(arenaRatings.entityId, entity.entityId))!,
    ),
  )!;

  const rows = await db
    .select({
      queue: arenaRatings.queue,
      entity_type: arenaRatings.entityType,
      entity_id: arenaRatings.entityId,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
    })
    .from(arenaRatings)
    .where(and(inArray(arenaRatings.queue, normalizedQueues), entityCondition));

  return rows.map((row) => mapArenaRatingSnapshotRow(row as Record<string, unknown>));
};

export const listArenaLeaderboardRows = async (
  db: AppDrizzleDb,
  options: ArenaLeaderboardCommonOptions & { offset: number },
): Promise<ArenaLeaderboardRow[]> => {
  return selectArenaLeaderboardRows(db, options, [], options.offset);
};

export const searchArenaLeaderboardRows = async (
  db: AppDrizzleDb,
  options: ArenaLeaderboardCommonOptions & {
    keyword: string;
    matchedPresetIds: string[];
  },
): Promise<ArenaLeaderboardRow[]> => {
  const normalizedKeyword = options.keyword.trim().toLowerCase();
  const like = `%${normalizedKeyword}%`;
  const whereExtras: SQL[] = [
    or(
      sql`LOWER(COALESCE(${dataCards.name}, '')) LIKE ${like}`,
      sql`LOWER(COALESCE(${users.username}, '')) LIKE ${like}`,
      sql`LOWER(${arenaRatings.entityId}) LIKE ${like}`,
      ...(options.matchedPresetIds.length > 0
        ? [and(eq(arenaRatings.entityType, 'preset'), inArray(arenaRatings.entityId, options.matchedPresetIds))!]
        : []),
    )!,
  ];
  return selectArenaLeaderboardRows(db, options, whereExtras, 0);
};

export const getTotalBattleCount = async (db: AppDrizzleDb): Promise<number> => {
  const rows = await db
    .select({
      count: count(),
    })
    .from(battles);

  return Math.max(0, toInteger(rows[0]?.count, 0));
};

export const getTotalCharacterParticipations = async (db: AppDrizzleDb): Promise<number> => {
  const rows = await db
    .select({
      total: sum(characters.participations),
    })
    .from(characters);

  return Math.max(0, toInteger(rows[0]?.total, 0));
};

export const listCharacterWinRateRanks = async (
  db: AppDrizzleDb,
  mode: StatsLeaderboardMode,
  limit: number,
): Promise<CharacterWinRateRankRow[]> => {
  const whereConditions: SQL[] = [gte(characters.participations, 3)];
  const modeCondition = buildCharactersModeCondition(mode);
  if (modeCondition) whereConditions.push(modeCondition);

  const rows = await db
    .select({
      name: characters.name,
      isPreset: characters.isPreset,
      wins: characters.wins,
      participations: characters.participations,
    })
    .from(characters)
    .where(and(...whereConditions))
    .orderBy(
      desc(sql<number>`(CAST(${characters.wins} AS REAL) / ${characters.participations})`),
      desc(characters.wins),
    )
    .limit(normalizeLimit(limit, 1, 100));

  return rows.map((row) => ({
    name: row.name,
    isPreset: Boolean(row.isPreset),
    wins: Math.max(0, toInteger(row.wins, 0)),
    participations: Math.max(1, toInteger(row.participations, 1)),
  }));
};

export const listCharacterParticipationRanks = async (
  db: AppDrizzleDb,
  mode: StatsLeaderboardMode,
  limit: number,
): Promise<CharacterCountRankRow[]> => {
  const whereConditions: SQL[] = [];
  const modeCondition = buildCharactersModeCondition(mode);
  if (modeCondition) whereConditions.push(modeCondition);

  const rows = await db
    .select({
      name: characters.name,
      isPreset: characters.isPreset,
      participations: characters.participations,
    })
    .from(characters)
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
    .orderBy(desc(characters.participations))
    .limit(normalizeLimit(limit, 1, 100));

  return rows.map((row) => ({
    name: row.name,
    isPreset: Boolean(row.isPreset),
    count: Math.max(0, toInteger(row.participations, 0)),
  }));
};

export const listCharacterWinsRanks = async (
  db: AppDrizzleDb,
  mode: StatsLeaderboardMode,
  limit: number,
): Promise<CharacterCountRankRow[]> => {
  const whereConditions: SQL[] = [];
  const modeCondition = buildCharactersModeCondition(mode);
  if (modeCondition) whereConditions.push(modeCondition);

  const rows = await db
    .select({
      name: characters.name,
      isPreset: characters.isPreset,
      wins: characters.wins,
    })
    .from(characters)
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
    .orderBy(desc(characters.wins))
    .limit(normalizeLimit(limit, 1, 100));

  return rows.map((row) => ({
    name: row.name,
    isPreset: Boolean(row.isPreset),
    count: Math.max(0, toInteger(row.wins, 0)),
  }));
};

export const listCharacterLossesRanks = async (
  db: AppDrizzleDb,
  mode: StatsLeaderboardMode,
  limit: number,
): Promise<CharacterCountRankRow[]> => {
  const whereConditions: SQL[] = [];
  const modeCondition = buildCharactersModeCondition(mode);
  if (modeCondition) whereConditions.push(modeCondition);

  const rows = await db
    .select({
      name: characters.name,
      isPreset: characters.isPreset,
      losses: characters.losses,
    })
    .from(characters)
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
    .orderBy(desc(characters.losses))
    .limit(normalizeLimit(limit, 1, 100));

  return rows.map((row) => ({
    name: row.name,
    isPreset: Boolean(row.isPreset),
    count: Math.max(0, toInteger(row.losses, 0)),
  }));
};
