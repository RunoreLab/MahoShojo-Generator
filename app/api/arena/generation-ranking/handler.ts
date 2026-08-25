import { getRequestUrl } from '@/lib/request-url';
import type { NextRequest } from 'next/server';

import { applyQueenTier, computeArenaBaseTier } from '@/lib/arena/tier';
import { isStrictRankedModelBlacklisted } from '@/lib/arena/ranked-model-policy';
import {
  buildPublicGenerationRankingSnapshot,
  getGenerationRankingCacheControl,
  type GenerationRankingResponse,
} from '@/lib/arena/generation-ranking';
import {
  buildGenerationRankingRateLimitResponse,
  enforceGenerationRankingRateLimit,
  getGenerationRankingRateLimitBindings,
} from '@/lib/arena/generation-ranking-rate-limit';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getArenaRatingEventsByIds, getArenaRatingsByEntities, type ArenaRatingEventReadRow } from '@/lib/db/repositories/arena-read';
import { getDataCardMetricsByDataCardIds, queryArenaPublicQueenEntityByQueue } from '@/lib/db/repositories/data-card-meta';
import { getBattleReportGenerationCombatantsByGenerationId, type BattleReportGenerationCombatantRow } from '@/lib/database/battle-report-generation-combatants';
import {
  buildArenaRatingEventId,
  buildEntityKey,
  getArenaEligibilitySnapshotByGenerationId,
  isFreeEligible,
  isStrictEligible,
  parseCombatantEntity,
  parseGenerationCombatantsFallback,
  type ArenaEntity,
  type ArenaEligibilitySnapshot,
} from '@/lib/database/arena-ratings';

type ApiQueue = 'strict' | 'free';

let hasWarnedMissingRateLimitBinding = false;

type ApiQueueResult = {
  eligible: boolean;
  ineligibleReasons: string[];
  eventStatus: 'missing' | 'pending' | 'applied' | 'skipped' | 'failed';
  skipReason: string | null;
  rating: number | null;
  games: number | null;
  tier: string | null;
  delta: number | null;
  rank: number | null;
  total: number | null;
  rankDelta: number | null;
};

type ApiParticipantResult = {
  displayName: string;
  entityType: 'data_card' | 'preset' | 'unknown';
  entityId: string | null;
  entityKey: string | null;
  dataCardId: string | null;
  presetId: string | null;
  techScore: number | null;
  techLevel: string | null;
  queues: Record<ApiQueue, ApiQueueResult>;
};

type ApiResponse = GenerationRankingResponse;

const buildApiResponse = (response: ApiResponse, status = 200): Response =>
  new Response(JSON.stringify(response), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? getGenerationRankingCacheControl(response) : 'no-store',
    },
  });

const buildStrictIneligibleReasons = (snapshot: ArenaEligibilitySnapshot, combatants: BattleReportGenerationCombatantRow[]): string[] => {
  const parsedExtraJson = (() => {
    if (typeof snapshot.extraJson !== 'string' || !snapshot.extraJson.trim()) return null;
    try {
      return JSON.parse(snapshot.extraJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const strictPolicy = typeof parsedExtraJson?.arenaStrictPolicy === 'string'
    ? parsedExtraJson.arenaStrictPolicy.trim()
    : '';
  const isNewStrictPolicy = strictPolicy === '1+3:v1';

  const rankedMatchOkRaw = parsedExtraJson?.rankedMatchOk;
  const rankedMatchOk = typeof rankedMatchOkRaw === 'boolean'
    ? rankedMatchOkRaw
    : (typeof rankedMatchOkRaw === 'number' && Number.isFinite(rankedMatchOkRaw) ? rankedMatchOkRaw !== 0 : null);
  const rankedMatchReason = typeof parsedExtraJson?.rankedMatchReason === 'string'
    ? parsedExtraJson.rankedMatchReason.trim()
    : '';

  const readNarrativeHistoryRaw = parsedExtraJson?.readNarrativeHistory;
  const readNarrativeHistory = typeof readNarrativeHistoryRaw === 'boolean'
    ? readNarrativeHistoryRaw
    : (typeof readNarrativeHistoryRaw === 'number' && Number.isFinite(readNarrativeHistoryRaw) ? readNarrativeHistoryRaw !== 0 : null);

  const questionnaireLoreEnabledRaw = parsedExtraJson?.questionnaireLoreEnabled;
  const questionnaireLoreEnabled = typeof questionnaireLoreEnabledRaw === 'boolean'
    ? questionnaireLoreEnabledRaw
    : (typeof questionnaireLoreEnabledRaw === 'number' && Number.isFinite(questionnaireLoreEnabledRaw) ? questionnaireLoreEnabledRaw !== 0 : null);

  const seasonQuestionnaireLoreAllowedRaw = parsedExtraJson?.seasonQuestionnaireLoreAllowed;
  const seasonQuestionnaireLoreAllowed = typeof seasonQuestionnaireLoreAllowedRaw === 'boolean'
    ? seasonQuestionnaireLoreAllowedRaw
    : (typeof seasonQuestionnaireLoreAllowedRaw === 'number' && Number.isFinite(seasonQuestionnaireLoreAllowedRaw)
      ? seasonQuestionnaireLoreAllowedRaw !== 0
      : null);

  const seasonQuestionnaireLorePresetIds = Array.isArray(parsedExtraJson?.seasonQuestionnaireLorePresetIds)
    ? (parsedExtraJson?.seasonQuestionnaireLorePresetIds as unknown[])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => Boolean(value))
        .slice(0, 20)
    : [];
  const questionnaireLoreIds = Array.isArray(parsedExtraJson?.questionnaireLoreIds)
    ? (parsedExtraJson?.questionnaireLoreIds as unknown[])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => Boolean(value))
        .slice(0, 20)
    : [];

  const resolvedModelOverride = typeof parsedExtraJson?.resolvedModelOverride === 'string'
    ? parsedExtraJson.resolvedModelOverride.trim()
    : '';

  const seasonModeRaw = typeof parsedExtraJson?.seasonMode === 'string' ? parsedExtraJson.seasonMode.trim() : '';
  const requiredMode =
    seasonModeRaw === 'classic' || seasonModeRaw === 'kizuna' || seasonModeRaw === 'daily' || seasonModeRaw === 'scenario'
      ? seasonModeRaw
      : 'classic';

  const seasonStoryGuidance = typeof parsedExtraJson?.seasonStoryGuidance === 'string' ? parsedExtraJson.seasonStoryGuidance.trim() : '';
  const seasonScenarioPreset = typeof parsedExtraJson?.seasonScenarioPreset === 'string' ? parsedExtraJson.seasonScenarioPreset.trim() : '';
  const scenarioFileName = typeof parsedExtraJson?.scenarioFileName === 'string' ? parsedExtraJson.scenarioFileName.trim() : '';
  const hasAuxScenarios = (() => {
    const raw = parsedExtraJson?.auxScenarioCount;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 0;
    if (typeof raw === 'string') return Boolean(raw.trim() && Number(raw) > 0);
    return false;
  })();
  const hasMaterials = (() => {
    const raw = parsedExtraJson?.materialCount;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 0;
    if (typeof raw === 'string') return Boolean(raw.trim() && Number(raw) > 0);
    return false;
  })();

  const reasons: string[] = [];
  if (snapshot.status !== 'completed') reasons.push('status-not-completed');
  if (snapshot.combatantCount !== 2) reasons.push('combatant-count-not-2');
  if (snapshot.ipAnonymized == null) reasons.push('ip-missing');
  if ((snapshot.mode ?? '').trim() !== requiredMode) reasons.push(requiredMode === 'classic' ? 'mode-not-classic' : 'mode-not-season');
  if (snapshot.userId == null) reasons.push('need-login');
  if ((snapshot.language ?? '').trim() !== 'zh-CN') reasons.push('language-not-zh-cn');
  if (!isNewStrictPolicy && rankedMatchOk !== true) {
    if (rankedMatchReason) {
      const map: Record<string, string> = {
        missing: 'ranked-match-missing',
        'invalid-shape': 'ranked-match-invalid',
        'invalid-signature': 'ranked-match-invalid',
        'need-login': 'need-login',
        'user-mismatch': 'ranked-match-user-mismatch',
        expired: 'ranked-match-expired',
        'settings-changed': 'ranked-match-settings-changed',
        'combatants-not-2': 'combatant-count-not-2',
        'combatants-unrankable': 'ranked-match-unrankable',
        'roster-changed': 'ranked-match-roster-changed',
      };
      reasons.push(map[rankedMatchReason] ?? `ranked-match:${rankedMatchReason}`);
    } else {
      reasons.push('need-ranked-match');
    }
  }

  if (seasonStoryGuidance) {
    const actual = typeof snapshot.userGuidancePreview === 'string' ? snapshot.userGuidancePreview.trim() : '';
    if (!actual) reasons.push('season-user-guidance-missing');
    else if (actual !== seasonStoryGuidance) reasons.push('season-user-guidance-mismatch');
  } else {
    if (snapshot.hasUserGuidance !== 0) reasons.push('has-user-guidance');
  }

  if (seasonQuestionnaireLorePresetIds.length > 0) {
    const requiredSet = new Set(seasonQuestionnaireLorePresetIds);
    const actualSet = new Set(questionnaireLoreIds);
    let ok = requiredSet.size === actualSet.size;
    if (ok) {
      for (const id of requiredSet) {
        if (!actualSet.has(id)) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) reasons.push('season-questionnaire-lore-mismatch');
  } else if (questionnaireLoreEnabled === true && seasonQuestionnaireLoreAllowed !== true) {
    reasons.push('season-questionnaire-lore-not-allowed');
  }

  if (requiredMode === 'scenario') {
    const hasScenario = snapshot.hasScenario === 1 || snapshot.hasScenario === true;
    if (!hasScenario) reasons.push('season-scenario-missing');

    if (seasonScenarioPreset) {
      if (!scenarioFileName || scenarioFileName !== seasonScenarioPreset) reasons.push('season-scenario-preset-mismatch');
    }
    if (hasAuxScenarios) reasons.push('season-aux-scenarios-not-allowed');
  }

  if (snapshot.hasAdjudicationEvents !== 0) reasons.push('has-adjudication-events');
  if (snapshot.readArenaHistory !== 0) reasons.push('read-arena-history');
  if (snapshot.readCurrentState !== 0) reasons.push('read-current-state');
  if (readNarrativeHistory !== false) reasons.push('read-narrative-history');
  if (hasMaterials) reasons.push('has-materials');
  if (isStrictRankedModelBlacklisted(resolvedModelOverride)) reasons.push('ai-model-blacklisted');
  if (combatants.some((c) => typeof c.character_guidance === 'string' && c.character_guidance.trim())) reasons.push('has-character-guidance');
  return reasons;
};

const buildFreeIneligibleReasons = (snapshot: ArenaEligibilitySnapshot): string[] => {
  const reasons: string[] = [];
  const arenaFreeRankingEnabled = (() => {
    const raw = typeof snapshot.extraJson === 'string' ? snapshot.extraJson.trim() : '';
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed?.arenaFreeRankingEnabled;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
      }
      return null;
    } catch {
      return null;
    }
  })();
  if (arenaFreeRankingEnabled === false) reasons.push('free-disabled');
  if (snapshot.status !== 'completed') reasons.push('status-not-completed');
  if (snapshot.combatantCount !== 2) reasons.push('combatant-count-not-2');
  if (snapshot.ipAnonymized == null) reasons.push('ip-missing');
  return reasons;
};

const buildDefaultQueueResult = (eligible: boolean, ineligibleReasons: string[]): ApiQueueResult => ({
  eligible,
  ineligibleReasons,
  eventStatus: eligible ? 'missing' : 'missing',
  skipReason: null,
  rating: null,
  games: null,
  tier: null,
  delta: null,
  rank: null,
  total: null,
  rankDelta: null,
});

type HandlerOptions = {
  internalGenerationId?: string;
};

async function handler(req: NextRequest, options: HandlerOptions = {}) {
  const url = getRequestUrl(req);
  const generationId = (options.internalGenerationId ?? url.searchParams.get('generationId') ?? '').trim();
  const isInternalRead = Boolean(options.internalGenerationId);

  if (!isInternalRead && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!generationId) {
    return buildApiResponse({ success: false, generationId: '', error: '缺少 generationId' }, 400);
  }

  if (!isInternalRead) {
    const rateLimit = await enforceGenerationRankingRateLimit({
      req,
      generationId,
      bindings: getGenerationRankingRateLimitBindings(),
    });
    if (!rateLimit.bindingAvailable && !hasWarnedMissingRateLimitBinding) {
      hasWarnedMissingRateLimitBinding = true;
      console.warn('[generation-ranking] rate limit binding 不可用，当前请求降级放行');
    }
    const rateLimitResponse = buildGenerationRankingRateLimitResponse(rateLimit);
    if (rateLimitResponse) {
      console.warn('[generation-ranking] 请求被限流', {
        route: '/api/arena/generation-ranking',
        responseState: 'rate_limited',
        limitedBy: rateLimit.limitedBy,
      });
      return rateLimitResponse;
    }
  }

  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) {
      return buildApiResponse({ success: false, generationId, error: '数据库绑定不可用，请检查 Cloudflare D1 配置' }, 503);
    }

    const snapshot = await getArenaEligibilitySnapshotByGenerationId(generationId);
    if (!snapshot) {
      const res: ApiResponse = {
        success: true,
        generationId,
        state: 'pending',
        message: '战报记录尚未落库，排位结算尚不可用（请稍后重试）',
      };
      return buildApiResponse(res);
    }

    const rawCombatants = await getBattleReportGenerationCombatantsByGenerationId(generationId);
    const combatants = Array.isArray(rawCombatants) && rawCombatants.length === 2
      ? rawCombatants
      : parseGenerationCombatantsFallback(generationId, snapshot.extraJson);

    if (!Array.isArray(combatants) || combatants.length !== 2) {
      if (snapshot.combatantCount !== 2) {
        const res: ApiResponse = {
          success: true,
          generationId,
          state: 'ready',
          snapshot: buildPublicGenerationRankingSnapshot(snapshot),
          participants: [],
        };
        return buildApiResponse(res);
      }

      const res: ApiResponse = {
        success: true,
        generationId,
        state: 'pending',
        message: '参战者明细尚未落库，排位结算尚不可用（请稍后重试）',
      };
      return buildApiResponse(res);
    }

    const strictEligible = isStrictEligible(snapshot, combatants);
    const freeEligible = isFreeEligible(snapshot);

    const strictIneligibleReasons = strictEligible ? [] : buildStrictIneligibleReasons(snapshot, combatants);
    const freeIneligibleReasons = freeEligible ? [] : buildFreeIneligibleReasons(snapshot);

    const participantEntities = combatants.map((c) => parseCombatantEntity(c));

    const participants: ApiParticipantResult[] = combatants.map((combatant, index) => {
      const entity = participantEntities[index];
      const entityType = entity?.entityType === 'data_card' ? 'data_card' : entity?.entityType === 'preset' ? 'preset' : 'unknown';
      const entityId = entity?.entityId ?? null;
      const entityKey = entity ? buildEntityKey(entity as ArenaEntity) : null;
      return {
        displayName: combatant.name,
        entityType,
        entityId,
        entityKey,
        dataCardId: typeof combatant.data_card_id === 'string' ? combatant.data_card_id : null,
        presetId: combatant.is_preset === 1 ? (typeof combatant.template_id === 'string' ? combatant.template_id : null) : null,
        techScore: null,
        techLevel: null,
        queues: {
          strict: buildDefaultQueueResult(strictEligible, strictIneligibleReasons),
          free: buildDefaultQueueResult(freeEligible, freeIneligibleReasons),
        },
      };
    });

    const dataCardIds = participants
      .map((p) => (typeof p.dataCardId === 'string' ? p.dataCardId.trim() : ''))
      .filter(Boolean);
    if (dataCardIds.length > 0) {
      const byId = await getDataCardMetricsByDataCardIds(db, dataCardIds);
      participants.forEach((p) => {
        if (!p.dataCardId) return;
        const meta = byId.get(p.dataCardId);
        if (!meta) return;
        p.techScore = typeof meta.techScore === 'number' ? meta.techScore : null;
        p.techLevel = typeof meta.techLevel === 'string' ? meta.techLevel : null;
      });
    }

    const readEventRows = async (): Promise<ArenaRatingEventReadRow[]> =>
      getArenaRatingEventsByIds(db, [buildArenaRatingEventId(generationId, 'strict'), buildArenaRatingEventId(generationId, 'free')]);

    // 公共 GET 只读取结算事件；缺失或 pending 时由客户端恢复查询，绝不触发写入。
    const eventRows = await readEventRows();

    const eventByQueue = new Map<ApiQueue, (typeof eventRows)[number]>();
    eventRows.forEach((row) => eventByQueue.set(row.queue === 'free' ? 'free' : 'strict', row));

    const entitiesForRatings: ArenaEntity[] = participantEntities.filter((e): e is ArenaEntity => Boolean(e));

    // 读取当前分数（用于展示当前段位/分数；同时可在 pending/缺事件时作为回退）
    const ratingRows = await getArenaRatingsByEntities(db, entitiesForRatings, ['strict', 'free']);

    const ratingByKey = new Map<string, { queue: ApiQueue; rating: number; games: number; tier: string }>();
    ratingRows.forEach((row) => {
      const key = `${row.queue}:${row.entityType}:${row.entityId}`;
      const rating = typeof row.rating === 'number' ? row.rating : 0;
      const games = typeof row.games === 'number' ? row.games : 0;
      ratingByKey.set(key, { queue: row.queue, rating, games, tier: computeArenaBaseTier(rating, games) });
    });

    const applyEventToParticipants = (queue: ApiQueue) => {
      const event = eventByQueue.get(queue);
      if (!event) {
        // eligible 但缺事件：保持 missing（客户端可轮询）
        participants.forEach((p) => {
          p.queues[queue].eventStatus = p.queues[queue].eligible ? 'missing' : 'missing';
        });
        return;
      }

      const eventStatus = event.status;
      const skipReason = typeof event.skipReason === 'string' ? event.skipReason : null;
      const aKey = buildEntityKey({ entityType: event.aEntityType, entityId: event.aEntityId });
      const bKey = buildEntityKey({ entityType: event.bEntityType, entityId: event.bEntityId });
      const parsedDetails = (() => {
        const raw = typeof event.detailsJson === 'string' ? event.detailsJson.trim() : '';
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as any) : null;
        } catch {
          return null;
        }
      })();

      participants.forEach((p) => {
        const qr = p.queues[queue];
        const entityKey = p.entityKey;
        if (entityKey) {
          const ratingFallback = ratingByKey.get(`${queue}:${entityKey}`);
          if (ratingFallback) {
            qr.rating = ratingFallback.rating;
            qr.games = ratingFallback.games;
            qr.tier = ratingFallback.tier;
          }
        }

        if (!qr.eligible) return;
        qr.eventStatus = eventStatus;
        qr.skipReason = skipReason;

        if (eventStatus !== 'applied') return;
        if (!entityKey) return;

        if (entityKey === aKey) {
          if (typeof event.aAfterRating === 'number') qr.rating = event.aAfterRating;
          if (typeof event.aAfterGames === 'number') qr.games = event.aAfterGames;
          if (typeof qr.rating === 'number' && typeof qr.games === 'number') qr.tier = computeArenaBaseTier(qr.rating, qr.games);
          qr.delta = typeof event.aDelta === 'number' ? event.aDelta : null;
          const before = parsedDetails?.ranks?.a?.before;
          const after = parsedDetails?.ranks?.a?.after;
          if (typeof before === 'number' && typeof after === 'number') {
            qr.rankDelta = before - after;
          }
          return;
        }
        if (entityKey === bKey) {
          if (typeof event.bAfterRating === 'number') qr.rating = event.bAfterRating;
          if (typeof event.bAfterGames === 'number') qr.games = event.bAfterGames;
          if (typeof qr.rating === 'number' && typeof qr.games === 'number') qr.tier = computeArenaBaseTier(qr.rating, qr.games);
          qr.delta = typeof event.bDelta === 'number' ? event.bDelta : null;
          const before = parsedDetails?.ranks?.b?.before;
          const after = parsedDetails?.ranks?.b?.after;
          if (typeof before === 'number' && typeof after === 'number') {
            qr.rankDelta = before - after;
          }
        }
      });
    };

    applyEventToParticipants('strict');
    applyEventToParticipants('free');

    const [strictQueen, freeQueen] = await Promise.all([
      queryArenaPublicQueenEntityByQueue(db, 'strict').catch((error) => {
        console.warn('读取女王段位失败（降级为无女王）:', error);
        return null;
      }),
      queryArenaPublicQueenEntityByQueue(db, 'free').catch((error) => {
        console.warn('读取女王段位失败（降级为无女王）:', error);
        return null;
      }),
    ]);

    for (const participant of participants) {
      if ((participant.entityType !== 'data_card' && participant.entityType !== 'preset') || !participant.entityId) continue;

      const entityType = participant.entityType;
      const entityId = participant.entityId;

      const queues: Array<{ queue: ApiQueue; queen: typeof strictQueen }> = [
        { queue: 'strict', queen: strictQueen },
        { queue: 'free', queen: freeQueen },
      ];

      for (const { queue, queen } of queues) {
        const qr = participant.queues[queue];
        if (typeof qr.rating !== 'number' || typeof qr.games !== 'number') continue;
        const baseTier = computeArenaBaseTier(qr.rating, qr.games);
        const isQueen = queen?.entityType === entityType && queen?.entityId === entityId;
        qr.tier = applyQueenTier(baseTier, isQueen);
      }
    }

    const res: ApiResponse = {
      success: true,
      generationId,
      state: 'ready',
      snapshot: buildPublicGenerationRankingSnapshot(snapshot),
      participants,
    };
    return buildApiResponse(res);
  } catch (error) {
    console.error('读取 generation-ranking 失败:', error);
    const res: ApiResponse = {
      success: false,
      generationId,
      error: '无法加载本局排位信息',
    };
    return buildApiResponse(res, 500);
  }
}

export const appRouteHandler = (req: NextRequest): Promise<Response> => handler(req);

export const readGenerationRankingForGeneration = async (
  generationId: string,
): Promise<GenerationRankingResponse> => {
  const request = new Request('https://internal.invalid/api/arena/generation-ranking', {
    method: 'GET',
  }) as NextRequest;
  const response = await handler(request, { internalGenerationId: generationId });
  return (await response.json()) as GenerationRankingResponse;
};

export default appRouteHandler;
