// lib/database/admin.ts

import { getAdminPvpOverview } from './admin-pvp';
import { getAdminUserAccountSummary } from './admin-user-accounts';
import { MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';
import { queryFromD1 } from './core';

/**
 * [新增] 获取仪表盘所需的各项统计数据。
 * @description
 * 该函数按模块（核心/排位/标签/大对象/存储）汇总关键指标，并在某些表尚未迁移时自动降级为 0/空值，避免仪表盘崩溃。
 * D1 单次请求只能执行一条语句，因此每个模块尽量压缩成单条 SELECT（含子查询）以减少请求次数。
 * @returns {Promise<object>} 返回一个包含所有统计数据的对象。
 */
export type DashboardStats = {
  totalUsers: number;
  totalDataCards: number;
  pendingReviewCount: number;
  bannedUsersCount: number;
  bannedDataCardsCount: number;
  newUsersToday: number;
  newDataCardsToday: number;
  battleReportGenerationsToday: number;
  battleReportGenerationsAbortFailToday: number;
  battleReportGenerationAbortFailRateToday: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activityTrackingOk: boolean;
  serverTimeIso: string;
  d1NowUtc: string | null;
  d1NowLocal: string | null;
  d1PageCount: number | null;
  d1PageSize: number | null;
  d1FreelistCount: number | null;
  d1EstimatedFileBytes: number | null;
  d1EstimatedUsedBytes: number | null;

  arenaRatingsStrictTotal: number;
  arenaRatingsFreeTotal: number;
  arenaRatingEventsPendingTotal: number;
  arenaRatingEventsTodayTotal: number;
  arenaRatingEventsAppliedTodayTotal: number;
  arenaRatingEventsSkippedTodayTotal: number;
  arenaRatingEventsFailedTodayTotal: number;
  leaderboardEligibleStrictDataCardTotal: number;
  leaderboardEligibleFreeDataCardTotal: number;

  dataCardMetricsTotal: number;
  publicApprovedCharacterCardsTotal: number;
  publicApprovedCharacterMetricsTotal: number;
  activeTagsTotal: number;
  tagAliasesTotal: number;
  dataCardTagsTotal: number;

  largeObjectsTotal: number;
  largeObjectsBytesTotal: number;
  largeObjectsStoredBytesTotal: number;
  largeObjectsBattleReportOutputTotal: number;
  largeObjectsBattleReportOutputBytesTotal: number;

  authLinkedUsersCount: number;
  legacyOnlyUsersCount: number;
  authEmailUnverifiedUsersCount: number;
  authSuccess24h: number;
  authFailure24h: number;

  pvpOpenRoomsTotal: number;
  pvpActiveRoomsTotal: number;
  pvpStalledRoomsTotal: number;
  pvpActiveMatchesTotal: number;
  pvpMatches7dTotal: number;

  openReportCasesTotal: number;
  underReviewReportCasesTotal: number;
  activeCrowdReviewRoundsTotal: number;
  submittedReportAppealsTotal: number;
  activeInspectorsTotal: number;
  recentSiteMessagesTotal: number;
  recentDirectMessagesTotal: number;
};

export type DashboardStatsSection =
  | 'core'
  | 'arena'
  | 'tags'
  | 'storage'
  | 'activity'
  | 'accounts'
  | 'pvp'
  | 'governance';

export type DashboardStatsCore = Pick<
  DashboardStats,
  | 'totalUsers'
  | 'totalDataCards'
  | 'pendingReviewCount'
  | 'bannedUsersCount'
  | 'bannedDataCardsCount'
  | 'newUsersToday'
  | 'newDataCardsToday'
  | 'battleReportGenerationsToday'
  | 'battleReportGenerationsAbortFailToday'
  | 'battleReportGenerationAbortFailRateToday'
  | 'serverTimeIso'
  | 'd1NowUtc'
  | 'd1NowLocal'
>;

export type DashboardStatsArena = Pick<
  DashboardStats,
  | 'arenaRatingsStrictTotal'
  | 'arenaRatingsFreeTotal'
  | 'arenaRatingEventsPendingTotal'
  | 'arenaRatingEventsTodayTotal'
  | 'arenaRatingEventsAppliedTodayTotal'
  | 'arenaRatingEventsSkippedTodayTotal'
  | 'arenaRatingEventsFailedTodayTotal'
  | 'leaderboardEligibleStrictDataCardTotal'
  | 'leaderboardEligibleFreeDataCardTotal'
>;

export type DashboardStatsActivity = Pick<DashboardStats, 'activeUsers24h' | 'activeUsers7d' | 'activityTrackingOk'>;

export type DashboardStatsTags = Pick<
  DashboardStats,
  | 'dataCardMetricsTotal'
  | 'publicApprovedCharacterCardsTotal'
  | 'publicApprovedCharacterMetricsTotal'
  | 'activeTagsTotal'
  | 'tagAliasesTotal'
  | 'dataCardTagsTotal'
>;

export type DashboardStatsStorage = Pick<
  DashboardStats,
  | 'd1PageCount'
  | 'd1PageSize'
  | 'd1FreelistCount'
  | 'd1EstimatedFileBytes'
  | 'd1EstimatedUsedBytes'
  | 'largeObjectsTotal'
  | 'largeObjectsBytesTotal'
  | 'largeObjectsStoredBytesTotal'
  | 'largeObjectsBattleReportOutputTotal'
  | 'largeObjectsBattleReportOutputBytesTotal'
>;

export type DashboardStatsAccounts = Pick<
  DashboardStats,
  | 'authLinkedUsersCount'
  | 'legacyOnlyUsersCount'
  | 'authEmailUnverifiedUsersCount'
  | 'authSuccess24h'
  | 'authFailure24h'
>;

export type DashboardStatsPvp = Pick<
  DashboardStats,
  | 'pvpOpenRoomsTotal'
  | 'pvpActiveRoomsTotal'
  | 'pvpStalledRoomsTotal'
  | 'pvpActiveMatchesTotal'
  | 'pvpMatches7dTotal'
>;

export type DashboardStatsGovernance = Pick<
  DashboardStats,
  | 'openReportCasesTotal'
  | 'underReviewReportCasesTotal'
  | 'activeCrowdReviewRoundsTotal'
  | 'submittedReportAppealsTotal'
  | 'activeInspectorsTotal'
  | 'recentSiteMessagesTotal'
  | 'recentDirectMessagesTotal'
>;

type D1Row = Record<string, unknown>;

const readFirstRow = (result: any): D1Row => {
  const row = result?.result?.[0]?.results?.[0];
  return row && typeof row === 'object' ? (row as D1Row) : {};
};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
};

const readStringOrNull = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (value == null) return null;
  return String(value);
};

export async function getDashboardStatsCore(): Promise<DashboardStatsCore> {
  const serverTimeIso = new Date().toISOString();

  const stats: DashboardStatsCore = {
    totalUsers: 0,
    totalDataCards: 0,
    pendingReviewCount: 0,
    bannedUsersCount: 0,
    bannedDataCardsCount: 0,
    newUsersToday: 0,
    newDataCardsToday: 0,
    battleReportGenerationsToday: 0,
    battleReportGenerationsAbortFailToday: 0,
    battleReportGenerationAbortFailRateToday: 0,
    serverTimeIso,
    d1NowUtc: null,
    d1NowLocal: null,
  };

  try {
    const coreSql = `
      SELECT
        (SELECT COUNT(id) FROM users) AS totalUsers,
        (SELECT COUNT(id) FROM data_cards) AS totalDataCards,
        (SELECT COUNT(id) FROM data_cards WHERE review_status = 'pending' AND is_public = 1) AS pendingReviewCount,
        (SELECT COUNT(id) FROM users WHERE is_banned IS NOT NULL AND is_banned != '') AS bannedUsersCount,
        (SELECT COUNT(id) FROM data_cards WHERE is_public = -1) AS bannedDataCardsCount,
        (
          SELECT COUNT(id)
          FROM users
          WHERE created_at >= datetime('now', 'localtime', 'start of day')
            AND created_at < datetime('now', 'localtime', 'start of day', '+1 day')
        ) AS newUsersToday,
        (
          SELECT COUNT(id)
          FROM data_cards
          WHERE created_at >= datetime('now', 'localtime', 'start of day')
            AND created_at < datetime('now', 'localtime', 'start of day', '+1 day')
        ) AS newDataCardsToday,
        (
          SELECT COUNT(id)
          FROM battle_report_generations
          WHERE started_at >= datetime('now', 'localtime', 'start of day')
            AND started_at < datetime('now', 'localtime', 'start of day', '+1 day')
        ) AS battleReportGenerationsToday,
        (
          SELECT COUNT(id)
          FROM battle_report_generations
          WHERE started_at >= datetime('now', 'localtime', 'start of day')
            AND started_at < datetime('now', 'localtime', 'start of day', '+1 day')
            AND status IN ('aborted','failed')
        ) AS battleReportGenerationsAbortFailToday,
        datetime('now') AS d1NowUtc,
        datetime('now', 'localtime') AS d1NowLocal;
    `;

    const coreResult = await queryFromD1(coreSql);
    const row = readFirstRow(coreResult as any);

    stats.totalUsers = readInt(row.totalUsers);
    stats.totalDataCards = readInt(row.totalDataCards);
    stats.pendingReviewCount = readInt(row.pendingReviewCount);
    stats.bannedUsersCount = readInt(row.bannedUsersCount);
    stats.bannedDataCardsCount = readInt(row.bannedDataCardsCount);
    stats.newUsersToday = readInt(row.newUsersToday);
    stats.newDataCardsToday = readInt(row.newDataCardsToday);
    stats.battleReportGenerationsToday = readInt(row.battleReportGenerationsToday);
    stats.battleReportGenerationsAbortFailToday = readInt(row.battleReportGenerationsAbortFailToday);
    stats.d1NowUtc = readStringOrNull(row.d1NowUtc);
    stats.d1NowLocal = readStringOrNull(row.d1NowLocal);

    stats.battleReportGenerationAbortFailRateToday =
      stats.battleReportGenerationsToday > 0
        ? stats.battleReportGenerationsAbortFailToday / stats.battleReportGenerationsToday
        : 0;
  } catch (error) {
    console.error('[Admin] 获取仪表盘核心统计失败:', error);
  }

  return stats;
}

export async function getDashboardStatsActivity(): Promise<DashboardStatsActivity> {
  const stats: DashboardStatsActivity = {
    activeUsers24h: 0,
    activeUsers7d: 0,
    activityTrackingOk: false,
  };

  try {
    const now = Date.now();
    const since24hIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7dIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END), 0) AS activeUsers24h,
        COUNT(1) AS activeUsers7d
      FROM user_last_activity
      WHERE last_seen_at >= ?;
    `;

    const result = await queryFromD1(sql, [since24hIso, since7dIso]);
    const row = readFirstRow(result as any);

    stats.activeUsers24h = readInt(row.activeUsers24h);
    stats.activeUsers7d = readInt(row.activeUsers7d);
    stats.activityTrackingOk = true;
  } catch (error) {
    console.warn('[Admin] user_last_activity 未就绪，跳过活跃用户统计:', error);
  }

  return stats;
}

export async function getDashboardStatsArena(): Promise<DashboardStatsArena> {
  const stats: DashboardStatsArena = {
    arenaRatingsStrictTotal: 0,
    arenaRatingsFreeTotal: 0,
    arenaRatingEventsPendingTotal: 0,
    arenaRatingEventsTodayTotal: 0,
    arenaRatingEventsAppliedTodayTotal: 0,
    arenaRatingEventsSkippedTodayTotal: 0,
    arenaRatingEventsFailedTodayTotal: 0,
    leaderboardEligibleStrictDataCardTotal: 0,
    leaderboardEligibleFreeDataCardTotal: 0,
  };

  try {
    const arenaSql = `
      SELECT
        (SELECT COUNT(*) FROM arena_ratings WHERE queue = 'strict') AS arenaRatingsStrictTotal,
        (SELECT COUNT(*) FROM arena_ratings WHERE queue = 'free') AS arenaRatingsFreeTotal,
        (SELECT COUNT(*) FROM arena_rating_events WHERE status = 'pending') AS arenaRatingEventsPendingTotal,
        (SELECT COUNT(*) FROM arena_rating_events WHERE DATE(created_at) = DATE('now', 'localtime')) AS arenaRatingEventsTodayTotal,
        (SELECT COUNT(*) FROM arena_rating_events WHERE DATE(created_at) = DATE('now', 'localtime') AND status = 'applied') AS arenaRatingEventsAppliedTodayTotal,
        (SELECT COUNT(*) FROM arena_rating_events WHERE DATE(created_at) = DATE('now', 'localtime') AND status = 'skipped') AS arenaRatingEventsSkippedTodayTotal,
        (SELECT COUNT(*) FROM arena_rating_events WHERE DATE(created_at) = DATE('now', 'localtime') AND status = 'failed') AS arenaRatingEventsFailedTodayTotal,
        (
          SELECT COUNT(*)
          FROM arena_ratings ar
          JOIN data_cards dc
            ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
          WHERE ar.queue = 'strict'
            AND dc.type = 'character'
            AND dc.is_public = 1
            AND dc.review_status = 'approved'
            AND dc.deleted_at IS NULL
        ) AS leaderboardEligibleStrictDataCardTotal,
        (
          SELECT COUNT(*)
          FROM arena_ratings ar
          JOIN data_cards dc
            ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
          WHERE ar.queue = 'free'
            AND dc.type = 'character'
            AND dc.is_public = 1
            AND dc.review_status = 'approved'
            AND dc.deleted_at IS NULL
        ) AS leaderboardEligibleFreeDataCardTotal;
    `;

    const arenaResult = await queryFromD1(arenaSql);
    const row = readFirstRow(arenaResult as any);

    stats.arenaRatingsStrictTotal = readInt(row.arenaRatingsStrictTotal);
    stats.arenaRatingsFreeTotal = readInt(row.arenaRatingsFreeTotal);
    stats.arenaRatingEventsPendingTotal = readInt(row.arenaRatingEventsPendingTotal);
    stats.arenaRatingEventsTodayTotal = readInt(row.arenaRatingEventsTodayTotal);
    stats.arenaRatingEventsAppliedTodayTotal = readInt(row.arenaRatingEventsAppliedTodayTotal);
    stats.arenaRatingEventsSkippedTodayTotal = readInt(row.arenaRatingEventsSkippedTodayTotal);
    stats.arenaRatingEventsFailedTodayTotal = readInt(row.arenaRatingEventsFailedTodayTotal);
    stats.leaderboardEligibleStrictDataCardTotal = readInt(row.leaderboardEligibleStrictDataCardTotal);
    stats.leaderboardEligibleFreeDataCardTotal = readInt(row.leaderboardEligibleFreeDataCardTotal);
  } catch (error) {
    console.warn('[Admin] arena_ratings/arena_rating_events 未就绪，跳过排位统计:', error);
  }

  return stats;
}

export async function getDashboardStatsTags(): Promise<DashboardStatsTags> {
  const stats: DashboardStatsTags = {
    dataCardMetricsTotal: 0,
    publicApprovedCharacterCardsTotal: 0,
    publicApprovedCharacterMetricsTotal: 0,
    activeTagsTotal: 0,
    tagAliasesTotal: 0,
    dataCardTagsTotal: 0,
  };

  try {
    const tagsSql = `
      SELECT
        (SELECT COUNT(*) FROM data_card_metrics) AS dataCardMetricsTotal,
        (
          SELECT COUNT(*)
          FROM data_cards
          WHERE type = 'character'
            AND is_public = 1
            AND review_status = 'approved'
            AND deleted_at IS NULL
        ) AS publicApprovedCharacterCardsTotal,
        (
          SELECT COUNT(*)
          FROM data_card_metrics dcm
          JOIN data_cards dc
            ON dc.id = dcm.data_card_id
          WHERE dc.type = 'character'
            AND dc.is_public = 1
            AND dc.review_status = 'approved'
            AND dc.deleted_at IS NULL
        ) AS publicApprovedCharacterMetricsTotal,
        (SELECT COUNT(*) FROM tags WHERE is_active = 1) AS activeTagsTotal,
        (SELECT COUNT(*) FROM tag_aliases) AS tagAliasesTotal,
        (SELECT COUNT(*) FROM data_card_tags) AS dataCardTagsTotal;
    `;

    const tagsResult = await queryFromD1(tagsSql);
    const row = readFirstRow(tagsResult as any);

    stats.dataCardMetricsTotal = readInt(row.dataCardMetricsTotal);
    stats.publicApprovedCharacterCardsTotal = readInt(row.publicApprovedCharacterCardsTotal);
    stats.publicApprovedCharacterMetricsTotal = readInt(row.publicApprovedCharacterMetricsTotal);
    stats.activeTagsTotal = readInt(row.activeTagsTotal);
    stats.tagAliasesTotal = readInt(row.tagAliasesTotal);
    stats.dataCardTagsTotal = readInt(row.dataCardTagsTotal);
  } catch (error) {
    console.warn('[Admin] tags/data_card_metrics 未就绪，跳过标签/技术值统计:', error);
  }

  return stats;
}

export async function getDashboardStatsStorage(): Promise<DashboardStatsStorage> {
  const stats: DashboardStatsStorage = {
    d1PageCount: null,
    d1PageSize: null,
    d1FreelistCount: null,
    d1EstimatedFileBytes: null,
    d1EstimatedUsedBytes: null,
    largeObjectsTotal: 0,
    largeObjectsBytesTotal: 0,
    largeObjectsStoredBytesTotal: 0,
    largeObjectsBattleReportOutputTotal: 0,
    largeObjectsBattleReportOutputBytesTotal: 0,
  };

  try {
    const largeObjectsSql = `
      SELECT
        COUNT(*) AS largeObjectsTotal,
        COALESCE(SUM(bytes), 0) AS largeObjectsBytesTotal,
        COALESCE(SUM(COALESCE(stored_bytes, bytes)), 0) AS largeObjectsStoredBytesTotal,
        COALESCE(SUM(CASE WHEN kind = 'battle_report_generation_output' THEN 1 ELSE 0 END), 0) AS largeObjectsBattleReportOutputTotal,
        COALESCE(SUM(CASE WHEN kind = 'battle_report_generation_output' THEN bytes ELSE 0 END), 0) AS largeObjectsBattleReportOutputBytesTotal
      FROM large_objects;
    `;

    const largeObjectsResult = await queryFromD1(largeObjectsSql);
    const row = readFirstRow(largeObjectsResult as any);

    stats.largeObjectsTotal = readInt(row.largeObjectsTotal);
    stats.largeObjectsBytesTotal = readInt(row.largeObjectsBytesTotal);
    stats.largeObjectsStoredBytesTotal = readInt(row.largeObjectsStoredBytesTotal);
    stats.largeObjectsBattleReportOutputTotal = readInt(row.largeObjectsBattleReportOutputTotal);
    stats.largeObjectsBattleReportOutputBytesTotal = readInt(row.largeObjectsBattleReportOutputBytesTotal);
  } catch (error) {
    console.warn('[Admin] large_objects 未就绪，跳过大对象统计:', error);
  }

  return stats;
}

export async function getDashboardStatsAccounts(): Promise<DashboardStatsAccounts> {
  const stats: DashboardStatsAccounts = {
    authLinkedUsersCount: 0,
    legacyOnlyUsersCount: 0,
    authEmailUnverifiedUsersCount: 0,
    authSuccess24h: 0,
    authFailure24h: 0,
  };

  try {
    const summary = await getAdminUserAccountSummary();
    stats.authLinkedUsersCount = summary.linkedUsers;
    stats.legacyOnlyUsersCount = summary.legacyOnlyUsers;
    stats.authEmailUnverifiedUsersCount = summary.emailUnverifiedUsers;
    stats.authSuccess24h = summary.authSuccess24h;
    stats.authFailure24h = summary.authFailure24h;
  } catch (error) {
    console.warn('[Admin] auth 后台统计未就绪，跳过账号统计:', error);
  }

  return stats;
}

export async function getDashboardStatsPvp(): Promise<DashboardStatsPvp> {
  const stats: DashboardStatsPvp = {
    pvpOpenRoomsTotal: 0,
    pvpActiveRoomsTotal: 0,
    pvpStalledRoomsTotal: 0,
    pvpActiveMatchesTotal: 0,
    pvpMatches7dTotal: 0,
  };

  try {
    const overview = await getAdminPvpOverview();
    stats.pvpOpenRoomsTotal = overview.openRooms;
    stats.pvpActiveRoomsTotal = overview.activeRooms;
    stats.pvpStalledRoomsTotal = overview.stalledRooms;
    stats.pvpActiveMatchesTotal = overview.activeMatches;
    stats.pvpMatches7dTotal = overview.matches7d;
  } catch (error) {
    console.warn('[Admin] PVP 后台统计未就绪，跳过 PVP 统计:', error);
  }

  return stats;
}

export async function getDashboardStatsGovernance(): Promise<DashboardStatsGovernance> {
  const stats: DashboardStatsGovernance = {
    openReportCasesTotal: 0,
    underReviewReportCasesTotal: 0,
    activeCrowdReviewRoundsTotal: 0,
    submittedReportAppealsTotal: 0,
    activeInspectorsTotal: 0,
    recentSiteMessagesTotal: 0,
    recentDirectMessagesTotal: 0,
  };

  try {
    const governanceSql = `
      SELECT
        (SELECT COUNT(*) FROM report_cases WHERE status = 'open') AS openReportCasesTotal,
        (SELECT COUNT(*) FROM report_cases WHERE status = 'under_review') AS underReviewReportCasesTotal,
        (
          SELECT COUNT(*)
          FROM crowd_review_rounds
          WHERE status IN ('pending_dispatch', 'active', 'waiting_more_votes')
        ) AS activeCrowdReviewRoundsTotal,
        (
          SELECT COUNT(*)
          FROM report_appeals
          WHERE status IN ('submitted', 'under_review')
        ) AS submittedReportAppealsTotal,
        (
          SELECT COUNT(*)
          FROM crowd_review_inspectors
          WHERE status = 'active'
        ) AS activeInspectorsTotal,
        (
          SELECT COUNT(*)
          FROM site_messages
          WHERE created_at >= datetime('now', '-7 day')
        ) AS recentSiteMessagesTotal,
        (
          SELECT COUNT(*)
          FROM user_messages
          WHERE created_at >= datetime('now', '-7 day')
        ) AS recentDirectMessagesTotal;
    `;

    const result = await queryFromD1(governanceSql);
    const row = readFirstRow(result as any);

    stats.openReportCasesTotal = readInt(row.openReportCasesTotal);
    stats.underReviewReportCasesTotal = readInt(row.underReviewReportCasesTotal);
    stats.activeCrowdReviewRoundsTotal = readInt(row.activeCrowdReviewRoundsTotal);
    stats.submittedReportAppealsTotal = readInt(row.submittedReportAppealsTotal);
    stats.activeInspectorsTotal = readInt(row.activeInspectorsTotal);
    stats.recentSiteMessagesTotal = readInt(row.recentSiteMessagesTotal);
    stats.recentDirectMessagesTotal = readInt(row.recentDirectMessagesTotal);
  } catch (error) {
    console.warn('[Admin] 治理后台统计未就绪，跳过治理统计:', error);
  }

  return stats;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [core, arena, activity, tags, storage, accounts, pvp, governance] = await Promise.all([
    getDashboardStatsCore(),
    getDashboardStatsArena(),
    getDashboardStatsActivity(),
    getDashboardStatsTags(),
    getDashboardStatsStorage(),
    getDashboardStatsAccounts(),
    getDashboardStatsPvp(),
    getDashboardStatsGovernance(),
  ]);

  return {
    ...core,
    ...arena,
    ...activity,
    ...tags,
    ...storage,
    ...accounts,
    ...pvp,
    ...governance,
  };
}

/**
 * [Admin] 获取数据卡列表，支持多维度筛选和分页
 * @param filters - 包含所有筛选条件的对
 * @returns 返回查询到的数据卡数组
 */
export async function getAdminDataCards(filters: {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  isPublic?: '0' | '1' | '-1'; // 0=私有, 1=公开, -1=封禁
  isRecommended?: '0' | '1';
  type?: 'character' | 'scenario' | 'history' | 'questionnaire';
  search?: string; // 搜索名称、描述或作者名
  hasPendingUpdate?: '0' | '1';
  metricsState?: 'stale' | 'fresh' | 'missing';
  hasVisualAssets?: '0' | '1';
  sizeBucket?: 'warning' | 'overLimit';
  includePendingUpdates?: boolean; // 是否将待审核更新信息合并进列表
}): Promise<{ cards: any[], total: number }> {
  const {
    page = 1,
    limit = 20,
    sortBy = 'updated_at',
    sortOrder = 'desc',
    reviewStatus,
    isPublic,
    isRecommended,
    type,
    search,
    hasPendingUpdate,
    metricsState,
    hasVisualAssets,
    sizeBucket,
    includePendingUpdates = false,
  } = filters;

  const sizeWarningThreshold = Math.floor(MAX_DATA_CARD_BYTES * 0.8);
  const offset = (page - 1) * limit;
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  const needsPendingUpdateJoin = includePendingUpdates || hasPendingUpdate === '0' || hasPendingUpdate === '1';
  const effectiveDataSql = needsPendingUpdateJoin ? 'COALESCE(dcu.data, dc.data)' : 'dc.data';
  const sizeBytesSql = `LENGTH(CAST(${effectiveDataSql} AS BLOB))`;
  const sizeCharsSql = `LENGTH(${effectiveDataSql})`;
  const loweredEffectiveDataSql = `LOWER(${effectiveDataSql})`;
  const hasVisualAssetsSql = `CASE
    WHEN ${loweredEffectiveDataSql} LIKE '%data:image/%'
      OR ${loweredEffectiveDataSql} LIKE '%"portrait"%'
      OR ${loweredEffectiveDataSql} LIKE '%"illustration"%'
      OR ${loweredEffectiveDataSql} LIKE '%"avatar"%'
      OR ${loweredEffectiveDataSql} LIKE '%"imageurl"%'
      OR ${loweredEffectiveDataSql} LIKE '%"coverimage"%'
      OR ${loweredEffectiveDataSql} LIKE '%"thumbnail"%'
      OR ${loweredEffectiveDataSql} LIKE '%.png%'
      OR ${loweredEffectiveDataSql} LIKE '%.jpg%'
      OR ${loweredEffectiveDataSql} LIKE '%.jpeg%'
      OR ${loweredEffectiveDataSql} LIKE '%.webp%'
      OR ${loweredEffectiveDataSql} LIKE '%.gif%'
      OR ${loweredEffectiveDataSql} LIKE '%.svg%'
      OR ${loweredEffectiveDataSql} LIKE '%.avif%'
    THEN 1
    ELSE 0
  END`;
  const metricsStaleSql = `CASE
    WHEN ${needsPendingUpdateJoin ? 'dcu.id IS NOT NULL' : '0 = 1'} THEN 1
    WHEN dcm.data_card_id IS NULL THEN 1
    WHEN COALESCE(dcm.data_card_updated_at, '') != COALESCE(dc.updated_at, '') THEN 1
    ELSE 0
  END`;

  // --- 动态构建 WHERE 子句 ---
  if (reviewStatus) {
    if (needsPendingUpdateJoin && reviewStatus === 'pending') {
      whereClauses.push("(dc.review_status = 'pending' OR dcu.id IS NOT NULL)");
    } else {
      whereClauses.push('dc.review_status = ?');
      params.push(reviewStatus);
    }
  }
  if (isPublic) {
    whereClauses.push('dc.is_public = ?');
    params.push(parseInt(isPublic, 10));
  }
  if (isRecommended) {
    whereClauses.push('dc.is_recommended = ?');
    params.push(parseInt(isRecommended, 10));
  }
  if (type) {
    whereClauses.push('dc.type = ?');
    params.push(type);
  }
  if (search) {
    // 搜索范围包括卡片名称、描述和作者用户名
    if (includePendingUpdates) {
      whereClauses.push('(dc.name LIKE ? OR dc.description LIKE ? OR u.username LIKE ? OR dc.id LIKE ? OR dcu.name LIKE ? OR dcu.description LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    } else {
      whereClauses.push('(dc.name LIKE ? OR dc.description LIKE ? OR u.username LIKE ? OR dc.id LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
  }
  if (hasPendingUpdate === '1') {
    whereClauses.push('dcu.id IS NOT NULL');
  } else if (hasPendingUpdate === '0') {
    whereClauses.push('dcu.id IS NULL');
  }
  if (metricsState === 'stale') {
    whereClauses.push(`(${metricsStaleSql}) = 1`);
  } else if (metricsState === 'fresh') {
    whereClauses.push(`(${metricsStaleSql}) = 0`);
  } else if (metricsState === 'missing') {
    whereClauses.push('dcm.data_card_id IS NULL');
  }
  if (hasVisualAssets === '1') {
    whereClauses.push(`(${hasVisualAssetsSql}) = 1`);
  } else if (hasVisualAssets === '0') {
    whereClauses.push(`(${hasVisualAssetsSql}) = 0`);
  }
  if (sizeBucket === 'warning') {
    whereClauses.push(`${sizeBytesSql} >= ? AND ${sizeBytesSql} < ?`);
    params.push(sizeWarningThreshold, MAX_DATA_CARD_BYTES);
  } else if (sizeBucket === 'overLimit') {
    whereClauses.push(`${sizeBytesSql} >= ?`);
    params.push(MAX_DATA_CARD_BYTES);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // --- 分别构建数据查询和总数查询 ---
  const pendingUpdateSelectSql = needsPendingUpdateJoin
    ? `,
      dcu.id AS pending_update_id,
      dcu.name AS pending_update_name,
      dcu.description AS pending_update_description,
      dcu.data AS pending_update_data,
      dcu.created_at AS pending_update_created_at
    `
    : '';

  const pendingUpdateJoinSql = needsPendingUpdateJoin
    ? `LEFT JOIN (
        SELECT dcu.*
        FROM data_card_updates dcu
        JOIN (
          SELECT data_card_id, MAX(created_at) AS created_at
          FROM data_card_updates
          GROUP BY data_card_id
        ) latest ON latest.data_card_id = dcu.data_card_id AND latest.created_at = dcu.created_at
        JOIN (
          SELECT data_card_id, created_at, MAX(id) AS id
          FROM data_card_updates
          GROUP BY data_card_id, created_at
        ) latest2 ON latest2.data_card_id = dcu.data_card_id AND latest2.created_at = dcu.created_at AND latest2.id = dcu.id
      ) dcu ON dcu.data_card_id = dc.id`
    : '';

  const countSelectSql = needsPendingUpdateJoin ? 'COUNT(DISTINCT dc.id) as total' : 'COUNT(dc.id) as total';

  const dataSql = `
    SELECT
      dc.*,
      u.username,
      ${sizeBytesSql} AS size_bytes,
      ${sizeCharsSql} AS size_chars,
      (${metricsStaleSql}) AS metrics_stale,
      (${hasVisualAssetsSql}) AS has_visual_assets,
      (
        SELECT rc.id
        FROM report_cases rc
        WHERE rc.target_entity_type = 'data_card'
          AND rc.target_entity_id = dc.id
        ORDER BY rc.latest_reported_at DESC, rc.created_at DESC, rc.id DESC
        LIMIT 1
      ) AS latest_report_case_id,
      (
        SELECT rc.status
        FROM report_cases rc
        WHERE rc.target_entity_type = 'data_card'
          AND rc.target_entity_id = dc.id
        ORDER BY rc.latest_reported_at DESC, rc.created_at DESC, rc.id DESC
        LIMIT 1
      ) AS latest_report_case_status,
      (
        SELECT rc.resolution_code
        FROM report_cases rc
        WHERE rc.target_entity_type = 'data_card'
          AND rc.target_entity_id = dc.id
        ORDER BY rc.latest_reported_at DESC, rc.created_at DESC, rc.id DESC
        LIMIT 1
      ) AS latest_report_case_resolution_code,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM report_cases rc
          JOIN crowd_review_rounds crr ON crr.report_case_id = rc.id
          WHERE rc.target_entity_type = 'data_card'
            AND rc.target_entity_id = dc.id
            AND crr.status IN ('pending_dispatch', 'active', 'waiting_more_votes')
        ) THEN 1
        ELSE 0
      END AS has_active_crowd_review,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM report_cases rc
          JOIN report_appeals ra ON ra.report_case_id = rc.id
          WHERE rc.target_entity_type = 'data_card'
            AND rc.target_entity_id = dc.id
            AND ra.status IN ('submitted', 'under_review')
        ) THEN 1
        ELSE 0
      END AS has_active_appeal,
      COALESCE((
        SELECT CASE
          WHEN COALESCE(rc.target_card_updated_at_at_notice, rc.creator_notified_at) IS NULL THEN 0
          WHEN dc.updated_at > COALESCE(rc.target_card_updated_at_at_notice, rc.creator_notified_at) THEN 1
          ELSE 0
        END
        FROM report_cases rc
        WHERE rc.target_entity_type = 'data_card'
          AND rc.target_entity_id = dc.id
        ORDER BY rc.latest_reported_at DESC, rc.created_at DESC, rc.id DESC
        LIMIT 1
      ), 0) AS is_self_remediation_candidate
      ${pendingUpdateSelectSql}
    FROM data_cards dc
    JOIN users u ON dc.user_id = u.id
    LEFT JOIN data_card_metrics dcm ON dcm.data_card_id = dc.id
    ${pendingUpdateJoinSql}
    ${whereSql}
    ORDER BY dc.${sortBy} ${sortOrder.toUpperCase()}
    LIMIT ? OFFSET ?;
  `;
  const countSql = `
    SELECT ${countSelectSql}
    FROM data_cards dc
    JOIN users u ON dc.user_id = u.id
    LEFT JOIN data_card_metrics dcm ON dcm.data_card_id = dc.id
    ${pendingUpdateJoinSql}
    ${whereSql};
  `;

  // D1 不支持在单次请求中执行多条语句，因此我们分别执行
  try {
    const dataParams = [...params, limit, offset];
    const countParams = [...params];

    const dataResult = (await queryFromD1(dataSql, dataParams)) as any;
    const countResult = (await queryFromD1(countSql, countParams)) as any;

    const cards = dataResult.success ? dataResult.result[0]?.results || [] : [];
    const total = countResult.success ? countResult.result[0]?.results[0]?.total || 0 : 0;
    
    return { cards, total };
  } catch (error) {
    console.error('[Admin] 获取数据卡失败:', error);
    throw error;
  }
}

/**
 * [Admin] 批量更新数据卡的状态
 * @param cardIds - 要更新的数据卡ID数组
 * @param updates - 要更新的字段和值，例如 { review_status: 'approved' }
 * @returns 返回一个布尔值表示操作是否成功
 */
export async function batchUpdateDataCards(
  cardIds: string[],
  updates: { review_status?: 'approved' | 'rejected'; is_public?: 0 | 1 | -1; is_recommended?: 0 | 1 }
): Promise<boolean> {
  if (cardIds.length === 0) return true;

  const setClauses: string[] = [];
  const params: (string | number)[] = [];

  if (updates.review_status) {
    setClauses.push('review_status = ?');
    params.push(updates.review_status);
  }
  if (updates.is_public !== undefined) {
    setClauses.push('is_public = ?');
    params.push(updates.is_public);
  }
  if (updates.is_recommended !== undefined) {
    setClauses.push('is_recommended = ?');
    params.push(updates.is_recommended);
  }

  if (setClauses.length === 0) {
    // 没有需要更新的字段
    return false;
  }
  
  // 添加 updated_at 以反映最后修改时间
  setClauses.push('updated_at = CURRENT_TIMESTAMP');

  // 构建 '?' 占位符字符串，例如 (?, ?, ?)
  const placeholders = cardIds.map(() => '?').join(', ');
  
  const sql = `
    UPDATE data_cards
    SET ${setClauses.join(', ')}
    WHERE id IN (${placeholders})
  `;

  const finalParams = [...params, ...cardIds];

  try {
    const result = (await queryFromD1(sql, finalParams)) as any;
    return result.success;
  } catch (error) {
    console.error('[Admin] 批量更新数据卡失败:', error);
    return false;
  }
}

// 获取待审核的更新记录，携带原卡片信息
export async function getPendingDataCardUpdates(): Promise<any[]> {
  const sql = `
    SELECT dcu.*, dc.name AS original_name, dc.description AS original_description, dc.data AS original_data,
           dc.type, dc.user_id, dc.is_public, dc.review_status, dc.like_count, dc.usage_count, dc.favorite_count,
           u.username
    FROM data_card_updates dcu
    JOIN data_cards dc ON dcu.data_card_id = dc.id
    JOIN users u ON dc.user_id = u.id
    ORDER BY dcu.created_at DESC;
  `;

  const result = await queryFromD1(sql) as any;
  return result?.result?.[0]?.results || [];
}

// 审核更新记录：approve -> 覆盖主表并删除更新；reject -> 删除更新
export async function reviewDataCardUpdate(
  updateId: string,
  action: 'approve' | 'reject'
): Promise<boolean> {
  if (!updateId) return false;

  // 先取出更新记录
  const updateResult = await queryFromD1(
    'SELECT * FROM data_card_updates WHERE id = ?',
    [updateId]
  ) as any;

  const updateRow = updateResult?.result?.[0]?.results?.[0];
  if (!updateRow) return false;

  if (action === 'reject') {
    const del = await queryFromD1('DELETE FROM data_card_updates WHERE id = ?', [updateId]) as any;
    return Boolean(del?.success);
  }

  // approve: 覆盖 data_cards
  const fields: string[] = [];
  const params: any[] = [];
  if (updateRow.name !== null && updateRow.name !== undefined) {
    fields.push('name = ?');
    params.push(updateRow.name);
  }
  if (updateRow.description !== null && updateRow.description !== undefined) {
    fields.push('description = ?');
    params.push(updateRow.description);
  }
  if (updateRow.data !== null && updateRow.data !== undefined) {
    fields.push('data = ?');
    params.push(updateRow.data);
  }
  // 审核通过后保持 review_status 为 approved
  fields.push("review_status = 'approved'");
  fields.push('updated_at = CURRENT_TIMESTAMP');

  const updateSql = `UPDATE data_cards SET ${fields.join(', ')} WHERE id = ?`;
  params.push(updateRow.data_card_id);
  const upd = await queryFromD1(updateSql, params) as any;
  if (!(upd?.success)) return false;

  const del = await queryFromD1('DELETE FROM data_card_updates WHERE id = ?', [updateId]) as any;
  return Boolean(del?.success);
}

/**
 * [Admin] 根据ID列表获取用于导出的数据卡核心数据
 * @param cardIds - 要导出的数据卡ID数组
 * @returns 返回一个包含data字段内容的数组
 */
export async function getDataForExport(cardIds: string[]): Promise<any[]> {
  if (cardIds.length === 0) return [];

  const placeholders = cardIds.map(() => '?').join(', ');
  const sql = `SELECT data FROM data_cards WHERE id IN (${placeholders})`;

  try {
    const result = (await queryFromD1(sql, cardIds)) as any;
    if (result.success && result.result[0]?.results) {
      // 从结果中提取 data 字段并解析 JSON 字符串
      return result.result[0].results.map((row: { data: string }) => JSON.parse(row.data));
    }
    return [];
  } catch (error) {
    console.error('[Admin] 获取导出数据失败:', error);
    throw error;
  }
}

export type DataCardNotificationTarget = {
  recipientUserId: number;
  dataCardId: string;
  dataCardName: string;
  reasonKey: string;
};

export async function getDataCardNotificationTargets(cardIds: string[]): Promise<DataCardNotificationTarget[]> {
  if (cardIds.length === 0) return [];

  const placeholders = cardIds.map(() => '?').join(', ');
  const sql = `
    SELECT id AS data_card_id, user_id AS recipient_user_id, name AS data_card_name
    FROM data_cards
    WHERE id IN (${placeholders})
  `;

  const result = (await queryFromD1(sql, cardIds)) as any;
  const rows = result?.success ? result.result?.[0]?.results || [] : [];
  return rows.map((row: Record<string, unknown>) => ({
    recipientUserId: Number(row.recipient_user_id),
    dataCardId: String(row.data_card_id),
    dataCardName: String(row.data_card_name ?? ''),
    reasonKey: String(row.data_card_id),
  }));
}

export async function getDataCardUpdateNotificationTargets(updateIds: string[]): Promise<DataCardNotificationTarget[]> {
  if (updateIds.length === 0) return [];

  const placeholders = updateIds.map(() => '?').join(', ');
  const sql = `
    SELECT
      dcu.id AS reason_key,
      dc.id AS data_card_id,
      dc.user_id AS recipient_user_id,
      COALESCE(dcu.name, dc.name) AS data_card_name
    FROM data_card_updates dcu
    JOIN data_cards dc ON dc.id = dcu.data_card_id
    WHERE dcu.id IN (${placeholders})
  `;

  const result = (await queryFromD1(sql, updateIds)) as any;
  const rows = result?.success ? result.result?.[0]?.results || [] : [];
  return rows.map((row: Record<string, unknown>) => ({
    recipientUserId: Number(row.recipient_user_id),
    dataCardId: String(row.data_card_id),
    dataCardName: String(row.data_card_name ?? ''),
    reasonKey: String(row.reason_key),
  }));
}

/**
 * [Admin] 根据ID列表获取AI审查所需的数据卡核心内容
 * @param cardIds - 要审查的数据卡ID数组
 * @returns 返回一个包含审查所需字段的数组
 */
export async function getCardsForReview(cardIds: string[]): Promise<{ id: string; name: string; description: string; data: string; }[]> {
  if (cardIds.length === 0) return [];

  const placeholders = cardIds.map(() => '?').join(', ');
  const sql = `SELECT id, name, description, data FROM data_cards WHERE id IN (${placeholders})`;

  try {
    const result = (await queryFromD1(sql, cardIds)) as any;
    if (result.success && result.result[0]?.results) {
      return result.result[0].results;
    }
    return [];
  } catch (error) {
    console.error('[Admin] 获取审查数据失败:', error);
    throw error;
  }
}

export type AdminAiReviewTarget =
  | { kind: 'card'; id: string; targetId: string }
  | { kind: 'update'; id: string; targetId: string };

/**
 * [Admin] 根据目标列表获取AI审查所需的核心内容，支持“新建待审查”与“待审核更新”。
 * - kind='card'：直接读取 data_cards
 * - kind='update'：读取 data_card_updates，并用 COALESCE 合成“待审核版本内容”
 */
export async function getReviewTargetsForAiReview(
  targets: AdminAiReviewTarget[]
): Promise<{ id: string; name: string; description: string; data: string }[]> {
  if (targets.length === 0) return [];

  const cardTargets = targets.filter((t): t is Extract<AdminAiReviewTarget, { kind: 'card' }> => t.kind === 'card');
  const updateTargets = targets.filter((t): t is Extract<AdminAiReviewTarget, { kind: 'update' }> => t.kind === 'update');

  const rows: { id: string; name: string; description: string; data: string }[] = [];

  if (cardTargets.length > 0) {
    const ids = cardTargets.map(t => t.id);
    const placeholders = ids.map(() => '?').join(', ');
    const sql = `SELECT id, name, description, data FROM data_cards WHERE id IN (${placeholders})`;

    const result = (await queryFromD1(sql, ids)) as any;
    const items = result?.success ? result.result[0]?.results || [] : [];

    const targetIdById = new Map(cardTargets.map(t => [t.id, t.targetId]));
    for (const item of items) {
      rows.push({
        id: targetIdById.get(item.id) || item.id,
        name: item.name,
        description: item.description,
        data: item.data,
      });
    }
  }

  if (updateTargets.length > 0) {
    const ids = updateTargets.map(t => t.id);
    const placeholders = ids.map(() => '?').join(', ');
    const sql = `
      SELECT
        dcu.id AS update_id,
        COALESCE(dcu.name, dc.name) AS name,
        COALESCE(dcu.description, dc.description) AS description,
        COALESCE(dcu.data, dc.data) AS data
      FROM data_card_updates dcu
      JOIN data_cards dc ON dcu.data_card_id = dc.id
      WHERE dcu.id IN (${placeholders});
    `;

    const result = (await queryFromD1(sql, ids)) as any;
    const items = result?.success ? result.result[0]?.results || [] : [];

    const targetIdById = new Map(updateTargets.map(t => [t.id, t.targetId]));
    for (const item of items) {
      rows.push({
        id: targetIdById.get(item.update_id) || item.update_id,
        name: item.name,
        description: item.description,
        data: item.data,
      });
    }
  }

  return rows;
}

/**
 * [Admin] 获取用户列表，支持复杂的多维度筛选和分页
 * [修改] 增加了 card count 相关的筛选参数
 * @param filters - 包含所有筛选条件的对
 * @returns 返回查询到的用户数组及总数
 */
export async function getAdminUsers(filters: {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string; // 搜索用户名
  regDateStart?: string;
  regDateEnd?: string;
  loginDateStart?: string;
  loginDateEnd?: string;
  activeDateStart?: string;
  activeDateEnd?: string;
  activity?: '24h' | '7d' | '30d' | 'tracked' | 'untracked';
  status?: 'normal' | 'banned' | 'exempt';
  minPublicCards?: number; // 新增：最少公开卡片数
  maxPublicCards?: number; // 新增：最多公开卡片数
  minBannedCards?: number; // 新增：最少封禁卡片数
  maxBannedCards?: number; // 新增：最多封禁卡片数
}) {
  const {
    page = 1,
    limit = 20,
    sortBy = 'created_at',
    sortOrder = 'desc',
    search,
    regDateStart,
    regDateEnd,
    loginDateStart,
    loginDateEnd,
    activeDateStart,
    activeDateEnd,
    activity,
    status,
    minPublicCards,
    maxPublicCards,
    minBannedCards,
    maxBannedCards,
  } = filters;

  const offset = (page - 1) * limit;
  const baseWhereClauses: string[] = [];
  const activityWhereClauses: string[] = [];
  const havingClauses: string[] = [];
  const baseWhereParams: (string | number)[] = [];
  const activityWhereParams: (string | number)[] = [];
  const havingParams: (string | number)[] = [];

  const isIsoDateOnly = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

  const normalizeActivityDateStart = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (isIsoDateOnly(trimmed)) return `${trimmed}T00:00:00.000Z`;
    return trimmed;
  };

  const normalizeActivityDateEnd = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (isIsoDateOnly(trimmed)) return `${trimmed}T23:59:59.999Z`;
    return trimmed;
  };

  // --- 动态构建 WHERE 子句 (过滤用户属性) ---
  if (search) {
    // 搜索范围包括：用户ID（精确匹配）、用户名、邮箱（模糊匹配）
    const normalizedSearch = search.trim();
    const searchTerm = `%${normalizedSearch}%`;
    const isNumericId = /^\d+$/.test(normalizedSearch);
    const numericId = isNumericId ? Number.parseInt(normalizedSearch, 10) : null;

    if (typeof numericId === 'number' && Number.isFinite(numericId)) {
      baseWhereClauses.push('(u.id = ? OR u.username LIKE ? OR u.email LIKE ?)');
      baseWhereParams.push(numericId, searchTerm, searchTerm);
    } else {
      baseWhereClauses.push('(u.username LIKE ? OR u.email LIKE ?)');
      baseWhereParams.push(searchTerm, searchTerm);
    }
  }
  if (regDateStart) {
    baseWhereClauses.push('DATE(u.created_at) >= DATE(?)');
    baseWhereParams.push(regDateStart);
  }
  if (regDateEnd) {
    baseWhereClauses.push('DATE(u.created_at) <= DATE(?)');
    baseWhereParams.push(regDateEnd);
  }
  if (loginDateStart) {
    baseWhereClauses.push('DATE(u.last_login_at) >= DATE(?)');
    baseWhereParams.push(loginDateStart);
  }
  if (loginDateEnd) {
    baseWhereClauses.push('DATE(u.last_login_at) <= DATE(?)');
    baseWhereParams.push(loginDateEnd);
  }
  if (activity) {
    const now = Date.now();
    if (activity === 'tracked') {
      activityWhereClauses.push('ula.user_id IS NOT NULL');
    } else if (activity === 'untracked') {
      activityWhereClauses.push('ula.user_id IS NULL');
    } else if (activity === '24h') {
      activityWhereClauses.push('ula.last_seen_at >= ?');
      activityWhereParams.push(new Date(now - 24 * 60 * 60 * 1000).toISOString());
    } else if (activity === '7d') {
      activityWhereClauses.push('ula.last_seen_at >= ?');
      activityWhereParams.push(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());
    } else if (activity === '30d') {
      activityWhereClauses.push('ula.last_seen_at >= ?');
      activityWhereParams.push(new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString());
    }
  }
  if (activeDateStart) {
    const normalized = normalizeActivityDateStart(activeDateStart);
    if (normalized) {
      activityWhereClauses.push('ula.last_seen_at >= ?');
      activityWhereParams.push(normalized);
    }
  }
  if (activeDateEnd) {
    const normalized = normalizeActivityDateEnd(activeDateEnd);
    if (normalized) {
      activityWhereClauses.push('ula.last_seen_at <= ?');
      activityWhereParams.push(normalized);
    }
  }
  if (status) {
    if (status === 'banned') baseWhereClauses.push("u.is_banned IS NOT NULL AND u.is_banned != ''");
    else if (status === 'exempt') baseWhereClauses.push('u.is_review_exempt = 1');
    else if (status === 'normal') baseWhereClauses.push("(u.is_banned IS NULL OR u.is_banned = '') AND u.is_review_exempt = 0");
  }

  // --- 动态构建 HAVING 子句 (过滤聚合结果) ---
  if (minPublicCards !== undefined) { havingClauses.push('public_cards >= ?'); havingParams.push(minPublicCards); }
  if (maxPublicCards !== undefined) { havingClauses.push('public_cards <= ?'); havingParams.push(maxPublicCards); }
  if (minBannedCards !== undefined) { havingClauses.push('banned_cards >= ?'); havingParams.push(minBannedCards); }
  if (maxBannedCards !== undefined) { havingClauses.push('banned_cards <= ?'); havingParams.push(maxBannedCards); }
  // 处理特殊情况： "no banned cards"
  if (maxBannedCards === 0 && minBannedCards === undefined) {
      if (!havingClauses.some(c => c.includes('banned_cards <= ?'))) {
          havingClauses.push('banned_cards <= ?');
          havingParams.push(0);
      }
  }

  const baseWhereSql = baseWhereClauses.length > 0 ? `WHERE ${baseWhereClauses.join(' AND ')}` : '';
  const whereClauses = [...baseWhereClauses, ...activityWhereClauses];
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const havingSql = havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';

  const params = [...baseWhereParams, ...activityWhereParams, ...havingParams];
  const fallbackParams = [...baseWhereParams, ...havingParams];

  // D1 不支持在 FROM 子句中使用复杂的子查询，所以我们将使用 LEFT JOIN 和 COUNT
  const dataSql = `
    SELECT
      u.id, u.username, u.email, u.created_at, u.last_login_at, u.is_banned, u.is_review_exempt,
      MAX(ula.last_seen_at) AS last_active_at,
      COUNT(dc.id) as total_cards,
      SUM(CASE WHEN dc.is_public = 1 THEN 1 ELSE 0 END) as public_cards,
      SUM(CASE WHEN dc.is_public = -1 THEN 1 ELSE 0 END) as banned_cards,
      SUM(CASE WHEN dc.review_status = 'rejected' THEN 1 ELSE 0 END) as rejected_cards
    FROM users u
    LEFT JOIN data_cards dc ON u.id = dc.user_id
    LEFT JOIN user_last_activity ula ON u.id = ula.user_id
    ${whereSql}
    GROUP BY u.id -- 按用户分组
    ${havingSql} -- 在分组后应用聚合筛选
    ORDER BY u.${sortBy} ${sortOrder.toUpperCase()}
    LIMIT ? OFFSET ?;
  `;

  const fallbackDataSql = `
    SELECT
      u.id, u.username, u.email, u.created_at, u.last_login_at, u.is_banned, u.is_review_exempt,
      NULL AS last_active_at,
      COUNT(dc.id) as total_cards,
      SUM(CASE WHEN dc.is_public = 1 THEN 1 ELSE 0 END) as public_cards,
      SUM(CASE WHEN dc.is_public = -1 THEN 1 ELSE 0 END) as banned_cards,
      SUM(CASE WHEN dc.review_status = 'rejected' THEN 1 ELSE 0 END) as rejected_cards
    FROM users u
    LEFT JOIN data_cards dc ON u.id = dc.user_id
    ${baseWhereSql}
    GROUP BY u.id
    ${havingSql}
    ORDER BY u.${sortBy} ${sortOrder.toUpperCase()}
    LIMIT ? OFFSET ?;
  `;

  // --- 构建总数查询 SQL (使用子查询来应用 HAVING) ---
  const countSql = `
    SELECT COUNT(*) as total
    FROM (
      SELECT
        u.id,
        SUM(CASE WHEN dc.is_public = 1 THEN 1 ELSE 0 END) as public_cards,
        SUM(CASE WHEN dc.is_public = -1 THEN 1 ELSE 0 END) as banned_cards
      FROM users u
      LEFT JOIN data_cards dc ON u.id = dc.user_id
      LEFT JOIN user_last_activity ula ON u.id = ula.user_id
      ${whereSql}
      GROUP BY u.id
      ${havingSql}
    ) AS subquery;
  `;

  const fallbackCountSql = `
    SELECT COUNT(*) as total
    FROM (
      SELECT
        u.id,
        SUM(CASE WHEN dc.is_public = 1 THEN 1 ELSE 0 END) as public_cards,
        SUM(CASE WHEN dc.is_public = -1 THEN 1 ELSE 0 END) as banned_cards
      FROM users u
      LEFT JOIN data_cards dc ON u.id = dc.user_id
      ${baseWhereSql}
      GROUP BY u.id
      ${havingSql}
    ) AS subquery;
  `;

  try {
    const dataParams = [...params, limit, offset];
    const countParams = [...params];

    // 并行执行数据查询和总数查询
    const [dataResult, countResult] = await Promise.all([
      queryFromD1(dataSql, dataParams),
      queryFromD1(countSql, countParams)
    ]) as [any, any];

    const users = dataResult.success ? dataResult.result[0]?.results || [] : [];
    const total = countResult.success ? countResult.result[0]?.results[0]?.total || 0 : 0;

    return { users, total };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingActivityTable = message.includes('user_last_activity') && message.toLowerCase().includes('no such table');
    if (!missingActivityTable) {
      console.error('[Admin] 获取用户列表失败:', error);
      throw error;
    }

    // 兼容：若 user_last_activity 尚未建表，则退化为不返回活跃时间、且忽略活跃筛选条件。
    try {
      const fallbackDataParams = [...fallbackParams, limit, offset];
      const fallbackCountParams = [...fallbackParams];
      const [dataResult, countResult] = await Promise.all([
        queryFromD1(fallbackDataSql, fallbackDataParams),
        queryFromD1(fallbackCountSql, fallbackCountParams),
      ]) as [any, any];

      const users = dataResult.success ? dataResult.result[0]?.results || [] : [];
      const total = countResult.success ? countResult.result[0]?.results[0]?.total || 0 : 0;
      return { users, total };
    } catch (fallbackError) {
      console.error('[Admin] user_last_activity 未就绪，且回退查询失败:', error, fallbackError);
      throw fallbackError;
    }
  }
}

const readFirstAdminUserRow = (result: any): any | null => {
  const row = result?.result?.[0]?.results?.[0];
  return row && typeof row === 'object' ? row : null;
};

export async function getAdminUserDetailsById(userId: number): Promise<any | null> {
  const safeUserId = Number.isFinite(userId) ? Math.floor(userId) : 0;
  if (safeUserId <= 0) return null;

  try {
    const result = (await queryFromD1(
      `SELECT
        u.*,
        ula.last_seen_at AS last_active_at
       FROM users u
       LEFT JOIN user_last_activity ula ON ula.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [safeUserId]
    )) as any;

    const row = readFirstAdminUserRow(result);
    if (row) return row;
    return null;
  } catch (error) {
    // 兼容：若 user_last_activity 尚未建表，则退化为仅 users 表
    try {
      const fallback = (await queryFromD1('SELECT * FROM users WHERE id = ? LIMIT 1', [safeUserId])) as any;
      const row = readFirstAdminUserRow(fallback);
      if (!row) return null;
      return { ...row, last_active_at: null };
    } catch (fallbackError) {
      console.error('[Admin] 获取用户详情失败:', error, fallbackError);
      return null;
    }
  }
}

export async function getAdminUserDetailsByUsername(username: string): Promise<any | null> {
  const safeUsername = typeof username === 'string' ? username.trim() : '';
  if (!safeUsername) return null;

  try {
    const result = (await queryFromD1(
      `SELECT
        u.*,
        ula.last_seen_at AS last_active_at
       FROM users u
       LEFT JOIN user_last_activity ula ON ula.user_id = u.id
       WHERE u.username = ?
       LIMIT 1`,
      [safeUsername]
    )) as any;

    const row = readFirstAdminUserRow(result);
    if (row) return row;
    return null;
  } catch (error) {
    // 兼容：若 user_last_activity 尚未建表，则退化为仅 users 表
    try {
      const fallback = (await queryFromD1('SELECT * FROM users WHERE username = ? LIMIT 1', [safeUsername])) as any;
      const row = readFirstAdminUserRow(fallback);
      if (!row) return null;
      return { ...row, last_active_at: null };
    } catch (fallbackError) {
      console.error('[Admin] 获取用户详情失败:', error, fallbackError);
      return null;
    }
  }
}

/**
 * [Admin] 批量更新用户的状态
 * @param userIds - 要更新的用户ID数组
 * @param updates - 要更新的字段和值, e.g., { is_review_exempt: 1 }
 * @returns 返回操作是否成功的布尔值
 */
export async function batchUpdateUsers(
  userIds: number[],
  updates: { is_review_exempt?: 0 | 1; is_banned?: string | null }
): Promise<boolean> {
  if (userIds.length === 0) return true;

  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.is_review_exempt !== undefined) {
    setClauses.push('is_review_exempt = ?');
    params.push(updates.is_review_exempt);
  }
  if (updates.is_banned !== undefined) {
    setClauses.push('is_banned = ?');
    params.push(updates.is_banned);
  }

  if (setClauses.length === 0) return false;

  const placeholders = userIds.map(() => '?').join(', ');
  const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id IN (${placeholders})`;
  const finalParams = [...params, ...userIds];

  try {
    const result = (await queryFromD1(sql, finalParams)) as any;
    return result.success;
  } catch (error) {
    console.error('[Admin] 批量更新用户失败:', error);
    return false;
  }
}
