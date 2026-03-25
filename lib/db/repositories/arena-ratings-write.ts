import { and, count, eq, gte, inArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import {
  compareArenaTier,
  computeArenaBaseTier,
  getArenaTierRank,
  pickHigherArenaTier,
  type ArenaTier,
} from '@/lib/arena/tier';
import { buildInitialStrictSeasonState, computeStrictSeasonExtremaAfterApplied } from '@/lib/database/arena-ratings';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { queryArenaPublicQueenEntityByQueue } from '@/lib/db/repositories/data-card-meta';
import {
  arenaRatingEvents,
  arenaRatings,
  battleReportGenerationCombatants,
  battleReportGenerations,
  dataCards,
} from '@/lib/db/schema';

export type ArenaRatingsQueue = 'strict' | 'free';
export type ArenaRatingsEntityType = 'data_card' | 'preset';
export type ArenaRatingEventStatus = 'pending' | 'applied' | 'skipped' | 'failed';

export type ArenaRatingsEntity = {
  entityType: ArenaRatingsEntityType;
  entityId: string;
};

export type ArenaRatingsSnapshot = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

export type ArenaEligibilitySnapshotRow = {
  status: string | null;
  mode: string | null;
  userId: number | null;
  ipAnonymized: string | null;
  language: string | null;
  selectedLevel: string | null;
  hasScenario: number | null;
  hasUserGuidance: number | null;
  userGuidancePreview: string | null;
  hasAdjudicationEvents: number | null;
  readArenaHistory: number | null;
  readCurrentState: number | null;
  combatantCount: number | null;
  winner: string | null;
  extraJson: string | null;
};

export type BattleReportGenerationCombatantRow = {
  generation_id: string;
  sort_index: number;
  name: string;
  type: string | null;
  template_id: string | null;
  is_native: number | null;
  is_preset: number | null;
  team_id: number | null;
  character_guidance: string | null;
  data_card_id: string | null;
  data_card_updated_at: string | null;
  size_chars: number | null;
  size_bytes: number | null;
  created_at: string;
};

export type ArenaRatingEventInsertPayload = {
  id: string;
  generationId: string;
  queue: ArenaRatingsQueue;
  status: ArenaRatingEventStatus;
  skipReason: string | null;
  userId: number | null;
  ipAnonymized: string | null;
  pairKey: string;
  a: ArenaRatingsEntity;
  b: ArenaRatingsEntity;
  winnerSlot: 0 | 1 | 2;
  createdAtIso: string;
  detailsJson?: Record<string, unknown> | null;
};

export type ArenaRatingEventStoredRow = {
  id: string;
  status: ArenaRatingEventStatus;
  skip_reason: string | null;
  details_json: string | null;
  a_before_rating: number | null;
  a_after_rating: number | null;
  a_delta: number | null;
  a_before_games: number | null;
  a_after_games: number | null;
  b_before_rating: number | null;
  b_after_rating: number | null;
  b_delta: number | null;
  b_before_games: number | null;
  b_after_games: number | null;
};

export type ArenaRatingEventComputedPayload = {
  aBefore: ArenaRatingsSnapshot;
  bBefore: ArenaRatingsSnapshot;
  aAfter: ArenaRatingsSnapshot;
  bAfter: ArenaRatingsSnapshot;
  deltaA: number;
  deltaB: number;
  detailsJson: Record<string, unknown>;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toNullableInt = (value: unknown): number | null => {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

const normalizeEntity = (entity: ArenaRatingsEntity): ArenaRatingsEntity => ({
  entityType: entity.entityType === 'preset' ? 'preset' : 'data_card',
  entityId: entity.entityId,
});

export const resetStrictArenaRatingForDataCard = async (
  db: AppDrizzleDb,
  dataCardId: string,
  initialRating: number,
  nowIso: string,
): Promise<void> => {
  const where = and(
    eq(arenaRatings.entityType, 'data_card'),
    eq(arenaRatings.entityId, dataCardId),
    eq(arenaRatings.queue, 'strict'),
  );
  const seasonDefaults = buildInitialStrictSeasonState(initialRating, nowIso);

  try {
    await db
      .update(arenaRatings)
      .set({
        rating: initialRating,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        seasonPeakRating: seasonDefaults.seasonPeakRating,
        seasonPeakGames: seasonDefaults.seasonPeakGames,
        seasonPeakAt: seasonDefaults.seasonPeakAt,
        seasonPeakTier: seasonDefaults.seasonPeakTier,
        seasonLowRating: seasonDefaults.seasonLowRating,
        seasonLowGames: seasonDefaults.seasonLowGames,
        seasonLowAt: seasonDefaults.seasonLowAt,
        lastDelta: null,
        lastAppliedAt: null,
        updatedAt: nowIso,
      })
      .where(where);
  } catch {
    await db
      .update(arenaRatings)
      .set({
        rating: initialRating,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        seasonPeakRating: seasonDefaults.seasonPeakRating,
        seasonPeakGames: seasonDefaults.seasonPeakGames,
        seasonPeakAt: seasonDefaults.seasonPeakAt,
        seasonPeakTier: seasonDefaults.seasonPeakTier,
        seasonLowRating: seasonDefaults.seasonLowRating,
        seasonLowGames: seasonDefaults.seasonLowGames,
        seasonLowAt: seasonDefaults.seasonLowAt,
        updatedAt: nowIso,
      })
      .where(where);
  }
};

export const countStrictAppliedEventsSince = async (
  db: AppDrizzleDb,
  userId: number,
  sinceIso: string,
): Promise<number> => {
  const rows = await db
    .select({ count: count() })
    .from(arenaRatingEvents)
    .where(
      and(
        eq(arenaRatingEvents.queue, 'strict'),
        eq(arenaRatingEvents.status, 'applied'),
        eq(arenaRatingEvents.userId, userId),
        gte(arenaRatingEvents.createdAt, sinceIso),
      ),
    );

  return Math.max(0, toInt(rows[0]?.count, 0));
};

export type StrictUserPairAppliedStats = {
  pairUsedToday: number;
  latestAppliedAt: string | null;
};

export const getStrictUserPairAppliedStatsSince = async (
  db: AppDrizzleDb,
  userId: number,
  pairKey: string,
  sinceIso: string,
  daySinceIso: string,
): Promise<StrictUserPairAppliedStats> => {
  const rows = await db
    .select({
      pairUsedToday: sql<number>`COALESCE(SUM(CASE WHEN ${arenaRatingEvents.createdAt} >= ${daySinceIso} THEN 1 ELSE 0 END), 0)`,
      latestAppliedAt: sql<string | null>`MAX(${arenaRatingEvents.createdAt})`,
    })
    .from(arenaRatingEvents)
    .where(
      and(
        eq(arenaRatingEvents.queue, 'strict'),
        eq(arenaRatingEvents.status, 'applied'),
        eq(arenaRatingEvents.userId, userId),
        eq(arenaRatingEvents.pairKey, pairKey),
        gte(arenaRatingEvents.createdAt, sinceIso),
      ),
    );

  return {
    pairUsedToday: Math.max(0, toInt(rows[0]?.pairUsedToday, 0)),
    latestAppliedAt: typeof rows[0]?.latestAppliedAt === 'string' ? rows[0].latestAppliedAt : null,
  };
};

export const getStrictQueueDataCardsByIds = async (
  db: AppDrizzleDb,
  dataCardIds: string[],
): Promise<Array<{
  id: string;
  type: string | null;
  isPublic: number | boolean | null;
  reviewStatus: string | null;
  deletedAt: string | null;
}>> => {
  const ids = Array.from(new Set(dataCardIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: dataCards.id,
      type: dataCards.type,
      isPublic: dataCards.isPublic,
      reviewStatus: dataCards.reviewStatus,
      deletedAt: dataCards.deletedAt,
    })
    .from(dataCards)
    .where(inArray(dataCards.id, ids));

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    isPublic: row.isPublic,
    reviewStatus: row.reviewStatus,
    deletedAt: row.deletedAt,
  }));
};

export const getArenaEligibilitySnapshotByGenerationId = async (
  db: AppDrizzleDb,
  generationId: string,
): Promise<ArenaEligibilitySnapshotRow | null> => {
  const rows = await db
    .select({
      status: battleReportGenerations.status,
      mode: battleReportGenerations.mode,
      userId: battleReportGenerations.userId,
      ipAnonymized: battleReportGenerations.ipAnonymized,
      language: battleReportGenerations.language,
      selectedLevel: battleReportGenerations.selectedLevel,
      hasScenario: battleReportGenerations.hasScenario,
      hasUserGuidance: battleReportGenerations.hasUserGuidance,
      userGuidancePreview: battleReportGenerations.userGuidancePreview,
      hasAdjudicationEvents: battleReportGenerations.hasAdjudicationEvents,
      readArenaHistory: battleReportGenerations.readArenaHistory,
      readCurrentState: battleReportGenerations.readCurrentState,
      combatantCount: battleReportGenerations.combatantCount,
      winner: battleReportGenerations.winner,
      extraJson: battleReportGenerations.extraJson,
    })
    .from(battleReportGenerations)
    .where(eq(battleReportGenerations.id, generationId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    status: typeof row.status === 'string' ? row.status : null,
    mode: typeof row.mode === 'string' ? row.mode : null,
    userId: toNullableInt(row.userId),
    ipAnonymized: typeof row.ipAnonymized === 'string' ? row.ipAnonymized : null,
    language: typeof row.language === 'string' ? row.language : null,
    selectedLevel: typeof row.selectedLevel === 'string' ? row.selectedLevel : null,
    hasScenario: toNullableInt(row.hasScenario),
    hasUserGuidance: toNullableInt(row.hasUserGuidance),
    userGuidancePreview: typeof row.userGuidancePreview === 'string' ? row.userGuidancePreview : null,
    hasAdjudicationEvents: toNullableInt(row.hasAdjudicationEvents),
    readArenaHistory: toNullableInt(row.readArenaHistory),
    readCurrentState: toNullableInt(row.readCurrentState),
    combatantCount: toNullableInt(row.combatantCount),
    winner: typeof row.winner === 'string' ? row.winner : null,
    extraJson: typeof row.extraJson === 'string' ? row.extraJson : null,
  };
};

export const listGenerationCombatantsByGenerationId = async (
  db: AppDrizzleDb,
  generationId: string,
): Promise<BattleReportGenerationCombatantRow[]> => {
  const rows = await db
    .select({
      generationId: battleReportGenerationCombatants.generationId,
      sortIndex: battleReportGenerationCombatants.sortIndex,
      name: battleReportGenerationCombatants.name,
      type: battleReportGenerationCombatants.type,
      templateId: battleReportGenerationCombatants.templateId,
      isNative: battleReportGenerationCombatants.isNative,
      isPreset: battleReportGenerationCombatants.isPreset,
      teamId: battleReportGenerationCombatants.teamId,
      characterGuidance: battleReportGenerationCombatants.characterGuidance,
      dataCardId: battleReportGenerationCombatants.dataCardId,
      dataCardUpdatedAt: battleReportGenerationCombatants.dataCardUpdatedAt,
      sizeChars: battleReportGenerationCombatants.sizeChars,
      sizeBytes: battleReportGenerationCombatants.sizeBytes,
      createdAt: battleReportGenerationCombatants.createdAt,
    })
    .from(battleReportGenerationCombatants)
    .where(eq(battleReportGenerationCombatants.generationId, generationId))
    .orderBy(battleReportGenerationCombatants.sortIndex);

  return rows.map((row) => ({
    generation_id: row.generationId,
    sort_index: toInt(row.sortIndex, 0),
    name: row.name,
    type: typeof row.type === 'string' ? row.type : null,
    template_id: typeof row.templateId === 'string' ? row.templateId : null,
    is_native: toNullableInt(row.isNative),
    is_preset: toNullableInt(row.isPreset),
    team_id: toNullableInt(row.teamId),
    character_guidance: typeof row.characterGuidance === 'string' ? row.characterGuidance : null,
    data_card_id: typeof row.dataCardId === 'string' ? row.dataCardId : null,
    data_card_updated_at: typeof row.dataCardUpdatedAt === 'string' ? row.dataCardUpdatedAt : null,
    size_chars: toNullableInt(row.sizeChars),
    size_bytes: toNullableInt(row.sizeBytes),
    created_at: row.createdAt,
  }));
};

export const ensureArenaRatingsExist = async (
  db: AppDrizzleDb,
  queue: ArenaRatingsQueue,
  entities: [ArenaRatingsEntity, ArenaRatingsEntity],
  initialRating: number,
  nowIso: string,
): Promise<void> => {
  const [a, b] = entities.map(normalizeEntity) as [ArenaRatingsEntity, ArenaRatingsEntity];
  const seasonDefaults =
    queue === 'strict'
      ? buildInitialStrictSeasonState(initialRating, nowIso)
      : {
          seasonPeakRating: null,
          seasonPeakGames: null,
          seasonPeakAt: null,
          seasonPeakTier: null,
          seasonLowRating: null,
          seasonLowGames: null,
          seasonLowAt: null,
        };
  await db
    .insert(arenaRatings)
    .values([
      {
        entityType: a.entityType,
        entityId: a.entityId,
        queue,
        rating: initialRating,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        ...seasonDefaults,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        entityType: b.entityType,
        entityId: b.entityId,
        queue,
        rating: initialRating,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        ...seasonDefaults,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ])
    .onConflictDoNothing();
};

export const getArenaRatingsByEntitiesForQueue = async (
  db: AppDrizzleDb,
  queue: ArenaRatingsQueue,
  entities: [ArenaRatingsEntity, ArenaRatingsEntity],
): Promise<Array<ArenaRatingsEntity & ArenaRatingsSnapshot>> => {
  const [a, b] = entities.map(normalizeEntity) as [ArenaRatingsEntity, ArenaRatingsEntity];
  const rows = await db
    .select({
      entityType: arenaRatings.entityType,
      entityId: arenaRatings.entityId,
      rating: arenaRatings.rating,
      games: arenaRatings.games,
      wins: arenaRatings.wins,
      losses: arenaRatings.losses,
      draws: arenaRatings.draws,
    })
    .from(arenaRatings)
    .where(
      and(
        eq(arenaRatings.queue, queue),
        or(
          and(eq(arenaRatings.entityType, a.entityType), eq(arenaRatings.entityId, a.entityId)),
          and(eq(arenaRatings.entityType, b.entityType), eq(arenaRatings.entityId, b.entityId)),
        ),
      ),
    );

  return rows.map((row) => ({
    entityType: row.entityType === 'preset' ? 'preset' : 'data_card',
    entityId: row.entityId,
    rating: toInt(row.rating, 0),
    games: Math.max(0, toInt(row.games, 0)),
    wins: Math.max(0, toInt(row.wins, 0)),
    losses: Math.max(0, toInt(row.losses, 0)),
    draws: Math.max(0, toInt(row.draws, 0)),
  }));
};

export const hasRecentAppliedEventForPair = async (
  db: AppDrizzleDb,
  queue: ArenaRatingsQueue,
  pairKey: string,
  options: { userId: number } | { ipAnonymized: string },
  sinceIso: string,
): Promise<boolean> => {
  const identityCondition =
    'userId' in options
      ? eq(arenaRatingEvents.userId, options.userId)
      : eq(arenaRatingEvents.ipAnonymized, options.ipAnonymized);

  const rows = await db
    .select({ id: arenaRatingEvents.id })
    .from(arenaRatingEvents)
    .where(
      and(
        eq(arenaRatingEvents.queue, queue),
        eq(arenaRatingEvents.status, 'applied'),
        eq(arenaRatingEvents.pairKey, pairKey),
        gte(arenaRatingEvents.createdAt, sinceIso),
        identityCondition,
      ),
    )
    .limit(1);

  return rows.length > 0;
};

export const insertArenaRatingEvent = async (
  db: AppDrizzleDb,
  payload: ArenaRatingEventInsertPayload,
): Promise<boolean> => {
  const inserted = await db
    .insert(arenaRatingEvents)
    .values({
      id: payload.id,
      generationId: payload.generationId,
      queue: payload.queue,
      status: payload.status,
      skipReason: payload.skipReason,
      userId: payload.userId,
      ipAnonymized: payload.ipAnonymized,
      pairKey: payload.pairKey,
      aEntityType: payload.a.entityType,
      aEntityId: payload.a.entityId,
      bEntityType: payload.b.entityType,
      bEntityId: payload.b.entityId,
      winnerSlot: payload.winnerSlot,
      detailsJson: payload.detailsJson ? JSON.stringify(payload.detailsJson) : null,
      createdAt: payload.createdAtIso,
    })
    .onConflictDoNothing({
      target: arenaRatingEvents.id,
    })
    .returning({
      id: arenaRatingEvents.id,
    });

  return inserted.length > 0;
};

export const getArenaRatingEventById = async (
  db: AppDrizzleDb,
  eventId: string,
): Promise<ArenaRatingEventStoredRow | null> => {
  const rows = await db
    .select({
      id: arenaRatingEvents.id,
      status: arenaRatingEvents.status,
      skip_reason: arenaRatingEvents.skipReason,
      details_json: arenaRatingEvents.detailsJson,
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
    .where(eq(arenaRatingEvents.id, eventId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    skip_reason: typeof row.skip_reason === 'string' ? row.skip_reason : null,
    details_json: typeof row.details_json === 'string' ? row.details_json : null,
    a_before_rating: toNullableInt(row.a_before_rating),
    a_after_rating: toNullableInt(row.a_after_rating),
    a_delta: toNullableInt(row.a_delta),
    a_before_games: toNullableInt(row.a_before_games),
    a_after_games: toNullableInt(row.a_after_games),
    b_before_rating: toNullableInt(row.b_before_rating),
    b_after_rating: toNullableInt(row.b_after_rating),
    b_delta: toNullableInt(row.b_delta),
    b_before_games: toNullableInt(row.b_before_games),
    b_after_games: toNullableInt(row.b_after_games),
  };
};

export const updateArenaRatingEventComputedFields = async (
  db: AppDrizzleDb,
  eventId: string,
  computed: ArenaRatingEventComputedPayload,
): Promise<boolean> => {
  const updated = await db
    .update(arenaRatingEvents)
    .set({
      aBeforeRating: computed.aBefore.rating,
      aAfterRating: computed.aAfter.rating,
      aDelta: computed.deltaA,
      aBeforeGames: computed.aBefore.games,
      aAfterGames: computed.aAfter.games,
      bBeforeRating: computed.bBefore.rating,
      bAfterRating: computed.bAfter.rating,
      bDelta: computed.deltaB,
      bBeforeGames: computed.bBefore.games,
      bAfterGames: computed.bAfter.games,
      detailsJson: JSON.stringify(computed.detailsJson),
    })
    .where(and(eq(arenaRatingEvents.id, eventId), eq(arenaRatingEvents.status, 'pending')))
    .returning({
      id: arenaRatingEvents.id,
    });

  return updated.length > 0;
};

export const markArenaRatingEventApplied = async (
  db: AppDrizzleDb,
  eventId: string,
  appliedAtIso: string,
): Promise<void> => {
  await db
    .update(arenaRatingEvents)
    .set({
      status: 'applied',
      appliedAt: appliedAtIso,
    })
    .where(eq(arenaRatingEvents.id, eventId));
};

export const markArenaRatingEventStatus = async (
  db: AppDrizzleDb,
  eventId: string,
  status: ArenaRatingEventStatus,
  options?: { skipReason?: string | null },
): Promise<void> => {
  if (options && Object.prototype.hasOwnProperty.call(options, 'skipReason')) {
    await db
      .update(arenaRatingEvents)
      .set({
        status,
        skipReason: sql`COALESCE(${options.skipReason ?? null}, ${arenaRatingEvents.skipReason})`,
      })
      .where(eq(arenaRatingEvents.id, eventId));
    return;
  }

  await db
    .update(arenaRatingEvents)
    .set({ status })
    .where(eq(arenaRatingEvents.id, eventId));
};

export const applyArenaRatingsUpdateIfBothMatch = async (
  db: AppDrizzleDb,
  queue: ArenaRatingsQueue,
  entities: [ArenaRatingsEntity, ArenaRatingsEntity],
  computed: ArenaRatingEventComputedPayload,
  appliedAtIso: string,
): Promise<'applied' | 'already-applied' | 'conflict'> => {
  const [aEntity, bEntity] = entities.map(normalizeEntity) as [ArenaRatingsEntity, ArenaRatingsEntity];
  const buildEntityCase = (column: SQL | AnyColumn, aValue: unknown, bValue: unknown): SQL =>
    sql`CASE
      WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${aValue}
      WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${bValue}
      ELSE ${column}
    END`;
  const buildTierRankSql = (value: SQL | AnyColumn): SQL<number> =>
    sql`CASE ${value}
      WHEN '无牌' THEN 0
      WHEN '白牌' THEN 1
      WHEN '字牌' THEN 2
      WHEN '花牌' THEN 3
      WHEN '权杖' THEN 4
      WHEN '女王' THEN 5
      ELSE -1
    END`;
  let latestSeasonPeakTierA: string | null = null;
  let latestSeasonPeakTierB: string | null = null;
  const readCurrentRows = async () =>
    db
      .select({
        entityType: arenaRatings.entityType,
        entityId: arenaRatings.entityId,
        rating: arenaRatings.rating,
        games: arenaRatings.games,
        seasonPeakRating: arenaRatings.seasonPeakRating,
        seasonPeakGames: arenaRatings.seasonPeakGames,
        seasonPeakAt: arenaRatings.seasonPeakAt,
        seasonPeakTier: arenaRatings.seasonPeakTier,
        seasonLowRating: arenaRatings.seasonLowRating,
        seasonLowGames: arenaRatings.seasonLowGames,
        seasonLowAt: arenaRatings.seasonLowAt,
      })
      .from(arenaRatings)
      .where(
        and(
          eq(arenaRatings.queue, queue),
          or(
            and(eq(arenaRatings.entityType, aEntity.entityType), eq(arenaRatings.entityId, aEntity.entityId)),
            and(eq(arenaRatings.entityType, bEntity.entityType), eq(arenaRatings.entityId, bEntity.entityId)),
          ),
        ),
      );

  const runWithOption = async (includeDelta: boolean): Promise<'applied' | 'already-applied' | 'conflict'> => {
    const rows = await readCurrentRows();

    const aRow = rows.find((row) => row.entityType === aEntity.entityType && row.entityId === aEntity.entityId);
    const bRow = rows.find((row) => row.entityType === bEntity.entityType && row.entityId === bEntity.entityId);
    if (!aRow || !bRow) return 'conflict';

    latestSeasonPeakTierA = typeof aRow.seasonPeakTier === 'string' ? aRow.seasonPeakTier : null;
    latestSeasonPeakTierB = typeof bRow.seasonPeakTier === 'string' ? bRow.seasonPeakTier : null;

    const aRating = toInt(aRow.rating, 0);
    const aGames = toInt(aRow.games, 0);
    const bRating = toInt(bRow.rating, 0);
    const bGames = toInt(bRow.games, 0);

    const aSeasonNext =
      queue === 'strict'
        ? computeStrictSeasonExtremaAfterApplied({
            current: {
              seasonPeakRating: toNullableInt(aRow.seasonPeakRating),
              seasonPeakGames: toNullableInt(aRow.seasonPeakGames),
              seasonPeakAt: typeof aRow.seasonPeakAt === 'string' ? aRow.seasonPeakAt : null,
              seasonLowRating: toNullableInt(aRow.seasonLowRating),
              seasonLowGames: toNullableInt(aRow.seasonLowGames),
              seasonLowAt: typeof aRow.seasonLowAt === 'string' ? aRow.seasonLowAt : null,
            },
            afterRating: computed.aAfter.rating,
            afterGames: computed.aAfter.games,
            appliedAtIso,
          })
        : null;
    const bSeasonNext =
      queue === 'strict'
        ? computeStrictSeasonExtremaAfterApplied({
            current: {
              seasonPeakRating: toNullableInt(bRow.seasonPeakRating),
              seasonPeakGames: toNullableInt(bRow.seasonPeakGames),
              seasonPeakAt: typeof bRow.seasonPeakAt === 'string' ? bRow.seasonPeakAt : null,
              seasonLowRating: toNullableInt(bRow.seasonLowRating),
              seasonLowGames: toNullableInt(bRow.seasonLowGames),
              seasonLowAt: typeof bRow.seasonLowAt === 'string' ? bRow.seasonLowAt : null,
            },
            afterRating: computed.bAfter.rating,
            afterGames: computed.bAfter.games,
            appliedAtIso,
          })
        : null;

    if (
      aRating === computed.aAfter.rating &&
      aGames === computed.aAfter.games &&
      bRating === computed.bAfter.rating &&
      bGames === computed.bAfter.games
    ) {
      return 'already-applied';
    }

    if (
      aRating !== computed.aBefore.rating ||
      aGames !== computed.aBefore.games ||
      bRating !== computed.bBefore.rating ||
      bGames !== computed.bBefore.games
    ) {
      return 'conflict';
    }

    const seasonPayload =
      queue === 'strict' && aSeasonNext && bSeasonNext
        ? {
            seasonPeakRating: buildEntityCase(
              arenaRatings.seasonPeakRating,
              aSeasonNext.seasonPeakRating,
              bSeasonNext.seasonPeakRating,
            ),
            seasonPeakGames: buildEntityCase(
              arenaRatings.seasonPeakGames,
              aSeasonNext.seasonPeakGames,
              bSeasonNext.seasonPeakGames,
            ),
            seasonPeakAt: buildEntityCase(
              arenaRatings.seasonPeakAt,
              aSeasonNext.seasonPeakAt,
              bSeasonNext.seasonPeakAt,
            ),
            seasonLowRating: buildEntityCase(
              arenaRatings.seasonLowRating,
              aSeasonNext.seasonLowRating,
              bSeasonNext.seasonLowRating,
            ),
            seasonLowGames: buildEntityCase(
              arenaRatings.seasonLowGames,
              aSeasonNext.seasonLowGames,
              bSeasonNext.seasonLowGames,
            ),
            seasonLowAt: buildEntityCase(
              arenaRatings.seasonLowAt,
              aSeasonNext.seasonLowAt,
              bSeasonNext.seasonLowAt,
            ),
          }
        : {};

    const setPayload = includeDelta
      ? {
          rating: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.rating}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.rating}
            ELSE ${arenaRatings.rating}
          END`,
          games: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.games}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.games}
            ELSE ${arenaRatings.games}
          END`,
          wins: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.wins}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.wins}
            ELSE ${arenaRatings.wins}
          END`,
          losses: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.losses}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.losses}
            ELSE ${arenaRatings.losses}
          END`,
          draws: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.draws}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.draws}
            ELSE ${arenaRatings.draws}
          END`,
          lastDelta: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.deltaA}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.deltaB}
            ELSE ${arenaRatings.lastDelta}
          END`,
          ...seasonPayload,
          lastAppliedAt: appliedAtIso,
          updatedAt: appliedAtIso,
        }
      : {
          rating: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.rating}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.rating}
            ELSE ${arenaRatings.rating}
          END`,
          games: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.games}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.games}
            ELSE ${arenaRatings.games}
          END`,
          wins: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.wins}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.wins}
            ELSE ${arenaRatings.wins}
          END`,
          losses: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.losses}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.losses}
            ELSE ${arenaRatings.losses}
          END`,
          draws: sql`CASE
            WHEN ${arenaRatings.entityType} = ${aEntity.entityType} AND ${arenaRatings.entityId} = ${aEntity.entityId} THEN ${computed.aAfter.draws}
            WHEN ${arenaRatings.entityType} = ${bEntity.entityType} AND ${arenaRatings.entityId} = ${bEntity.entityId} THEN ${computed.bAfter.draws}
            ELSE ${arenaRatings.draws}
          END`,
          ...seasonPayload,
          updatedAt: appliedAtIso,
        };

    const updatedRows = await db
      .update(arenaRatings)
      .set(setPayload)
      .where(
        and(
          eq(arenaRatings.queue, queue),
          or(
            and(eq(arenaRatings.entityType, aEntity.entityType), eq(arenaRatings.entityId, aEntity.entityId)),
            and(eq(arenaRatings.entityType, bEntity.entityType), eq(arenaRatings.entityId, bEntity.entityId)),
          ),
          sql`(SELECT COUNT(*) FROM arena_ratings
            WHERE queue = ${queue}
              AND entity_type = ${aEntity.entityType}
              AND entity_id = ${aEntity.entityId}
              AND rating = ${computed.aBefore.rating}
              AND games = ${computed.aBefore.games}) = 1`,
          sql`(SELECT COUNT(*) FROM arena_ratings
            WHERE queue = ${queue}
              AND entity_type = ${bEntity.entityType}
              AND entity_id = ${bEntity.entityId}
              AND rating = ${computed.bBefore.rating}
              AND games = ${computed.bBefore.games}) = 1`,
        ),
      )
      .returning({
        entityType: arenaRatings.entityType,
        entityId: arenaRatings.entityId,
      });

    if (updatedRows.length === 2) return 'applied';
    if (updatedRows.length > 0) return 'conflict';

    const afterRows = await readCurrentRows();
    const aAfterRow = afterRows.find((row) => row.entityType === aEntity.entityType && row.entityId === aEntity.entityId);
    const bAfterRow = afterRows.find((row) => row.entityType === bEntity.entityType && row.entityId === bEntity.entityId);
    if (!aAfterRow || !bAfterRow) return 'conflict';

    const aAfterRating = toInt(aAfterRow.rating, 0);
    const aAfterGames = toInt(aAfterRow.games, 0);
    const bAfterRating = toInt(bAfterRow.rating, 0);
    const bAfterGames = toInt(bAfterRow.games, 0);
    if (
      aAfterRating === computed.aAfter.rating &&
      aAfterGames === computed.aAfter.games &&
      bAfterRating === computed.bAfter.rating &&
      bAfterGames === computed.bAfter.games
    ) {
      return 'already-applied';
    }

    return 'conflict';
  };

  const refreshStrictSeasonPeakTier = async (): Promise<void> => {
    if (queue !== 'strict') return;

    const queen = await queryArenaPublicQueenEntityByQueue(db, 'strict', { bypassCache: true });
    const updateSeasonPeakTier = async (
      entity: ArenaRatingsEntity,
      after: ArenaRatingsSnapshot,
      existingSeasonPeakTier: string | null,
    ): Promise<void> => {
      const baseTier = computeArenaBaseTier(after.rating, after.games);
      const isQueen =
        queen && queen.entityType === entity.entityType && queen.entityId === entity.entityId && baseTier === '权杖';
      const displayTier = isQueen ? '女王' : baseTier;
      const normalizedSeasonPeakTier =
        typeof existingSeasonPeakTier === 'string' && getArenaTierRank(existingSeasonPeakTier as ArenaTier) >= 0
          ? (existingSeasonPeakTier as ArenaTier)
          : null;
      const targetTier = pickHigherArenaTier(normalizedSeasonPeakTier, displayTier);
      if (!targetTier) return;
      if (compareArenaTier(targetTier, normalizedSeasonPeakTier) <= 0) return;

      const targetRank = getArenaTierRank(targetTier);
      if (targetRank < 0) return;

      await db
        .update(arenaRatings)
        .set({ seasonPeakTier: targetTier })
        .where(
          and(
            eq(arenaRatings.queue, 'strict'),
            eq(arenaRatings.entityType, entity.entityType),
            eq(arenaRatings.entityId, entity.entityId),
            sql`${buildTierRankSql(arenaRatings.seasonPeakTier)} < ${targetRank}`,
          ),
        );
    };

    // 并发窗口说明：女王归属可能在缓存绕过查询与写回之间发生变化，当前实现保证单调递增，无法保证即时一致。
    await updateSeasonPeakTier(aEntity, computed.aAfter, latestSeasonPeakTierA);
    await updateSeasonPeakTier(bEntity, computed.bAfter, latestSeasonPeakTierB);
  };

  const shouldRefreshSeasonPeakTier = (result: 'applied' | 'already-applied' | 'conflict'): boolean =>
    result === 'applied' || result === 'already-applied';

  const finalizeWithSeasonPeakTierRefresh = async (
    result: 'applied' | 'already-applied' | 'conflict',
  ): Promise<'applied' | 'already-applied' | 'conflict'> => {
    if (shouldRefreshSeasonPeakTier(result)) {
      await refreshStrictSeasonPeakTier();
    }
    return result;
  };

  try {
    const result = await runWithOption(true);
    return finalizeWithSeasonPeakTierRefresh(result);
  } catch {
    const fallbackResult = await runWithOption(false);
    return finalizeWithSeasonPeakTierRefresh(fallbackResult);
  }
};
