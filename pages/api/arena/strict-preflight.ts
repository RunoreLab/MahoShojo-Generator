import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getRequestUrl } from '@/lib/request-url';
import type { NextRequest } from 'next/server';

import { createRequestAuthUserResolver } from '@/lib/auth/request-auth-user';
import { isStrictRankedModelBlacklisted } from '@/lib/arena/ranked-model-policy';
import {
  buildPairKey,
  getStrictDailyUsage,
  getStrictPairUsage,
  getStrictRangeCheckResult,
  INITIAL_RATING,
  STRICT_DEDUP_WINDOW_MS,
  STRICT_DAILY_LIMIT,
  STRICT_SAME_PAIR_DAILY_LIMIT,
  type StrictRangeCheckResult,
} from '@/lib/database/arena-ratings';
import { getDrizzleDbFromRuntime, type AppDrizzleDb } from '@/lib/db/drizzle';
import { getDataCardMetaCardsByIds } from '@/lib/db/repositories/data-card-meta';
import { getStrictArenaRatingsByEntities } from '@/lib/db/repositories/arena-strict-preflight';
import { fetchCurrentSeasonFromOrigin } from '@/lib/seasons-config';
import { deriveSeasonStrictRules } from '@/lib/seasons';

type ApiSuccessResponse = {
  success: true;
  willCount: boolean;
  reasons: string[];
  range: StrictRangeCheckResult | null;
  daily: {
    used: number | null;
    limit: number;
    exceeded: boolean | null;
    sinceIso: string | null;
  };
  pair: {
    used: number | null;
    limit: number;
    exceeded: boolean | null;
    recentDeduped: boolean | null;
    recentAppliedAtIso: string | null;
    nextEligibleAtIso: string | null;
    windowMinutes: number;
  };
};

type ApiErrorResponse = { success: false; error: string };

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');
const trimString = (value: unknown): string => readString(value).trim();
const readBoolean = (value: unknown): boolean => value === true || value === 'true' || value === 1 || value === '1';
const readNonNegativeInt = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
};

const normalizeStrictStoryGuidance = (value: unknown): string => {
  const trimmed = trimString(value);
  if (!trimmed) return '';
  return trimmed.slice(0, 200);
};

type ArenaEntity = { entityType: 'data_card' | 'preset'; entityId: string };

const isRankableCombatant = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const anyValue = value as any;
  if (anyValue.isPreset) {
    return typeof anyValue.filename === 'string' && anyValue.filename.trim().length > 0;
  }
  return typeof anyValue.sourceDataCardId === 'string' && anyValue.sourceDataCardId.trim().length > 0;
};

const parseArenaEntityFromCombatant = (value: unknown): ArenaEntity | null => {
  if (!value || typeof value !== 'object') return null;
  const anyValue = value as any;
  if (anyValue.isPreset) {
    const filename = typeof anyValue.filename === 'string' ? anyValue.filename.trim() : '';
    if (!filename) return null;
    return { entityType: 'preset', entityId: filename };
  }
  const dataCardId = typeof anyValue.sourceDataCardId === 'string' ? anyValue.sourceDataCardId.trim() : '';
  if (!dataCardId) return null;
  return { entityType: 'data_card', entityId: dataCardId };
};

const validateStrictPublicDataCards = async (db: AppDrizzleDb, entities: ArenaEntity[]): Promise<
  { ok: true } | { ok: false; reason: 'strict-not-public' | 'strict-not-approved' | 'strict-not-character' | 'strict-card-missing' }
> => {
  const ids = entities.filter((e) => e.entityType === 'data_card').map((e) => e.entityId).filter(Boolean);
  if (ids.length <= 0) return { ok: true };
  try {
    const rows = await getDataCardMetaCardsByIds(db, ids);
    const byId = new Map<string, (typeof rows)[number]>();
    rows.forEach((row) => {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      if (!id) return;
      byId.set(id, row);
    });

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) return { ok: false, reason: 'strict-card-missing' };
      if (row.type !== 'character') return { ok: false, reason: 'strict-not-character' };
      if (!row.isPublic) return { ok: false, reason: 'strict-not-public' };
      if (row.reviewStatus !== 'approved') return { ok: false, reason: 'strict-not-approved' };
    }

    return { ok: true };
  } catch (error) {
    console.warn('strict-preflight 校验数据卡可用性失败（降级为不计 strict）:', error);
    return { ok: false, reason: 'strict-card-missing' };
  }
};

async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' } satisfies ApiErrorResponse), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as any;
    const db = getDrizzleDbFromRuntime();

    const battleMode = trimString(body?.battleMode ?? body?.mode);
    const language = trimString(body?.language);
    const scenarioEnabled = readBoolean(body?.scenarioEnabled);
    const scenarioFileName = trimString(body?.scenarioFileName);
    const auxScenarioCount = readNonNegativeInt(body?.auxScenarioCount);
    const materialCount = readNonNegativeInt(body?.materialCount);
    const questionnaireLoreEnabled = readBoolean(body?.questionnaireLoreEnabled);
    const questionnaireLoreIds = Array.isArray(body?.questionnaireLoreIds)
      ? (body.questionnaireLoreIds as unknown[])
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => Boolean(value))
          .slice(0, 20)
      : [];

    const origin = getRequestUrl(req).origin;
    const currentSeason = await fetchCurrentSeasonFromOrigin(origin);
    const seasonStrictRules = deriveSeasonStrictRules(currentSeason);

    const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {};
    const userGuidance = readString(settings?.userGuidance);
    const readArenaHistory = readBoolean(settings?.readArenaHistory);
    const readCurrentState = readBoolean(settings?.readCurrentState);
    const readNarrativeHistory = readBoolean(settings?.readNarrativeHistory);

    const combatants = Array.isArray(body?.combatants) ? body.combatants : null;
    const adjudicationEventCount = readNonNegativeInt(body?.adjudicationEventCount);

    const customProvider = body?.customProvider && typeof body.customProvider === 'object' ? body.customProvider : null;
    const customModelId = trimString(customProvider?.modelId);

    const user = await createRequestAuthUserResolver(req).getUser();

    const reasons: string[] = [];
    let range: ApiSuccessResponse['range'] = null;
    let pairUsage: Awaited<ReturnType<typeof getStrictPairUsage>> = null;
    if (!user?.id) reasons.push('need-login');
    if (battleMode !== seasonStrictRules.mode) {
      reasons.push(seasonStrictRules.mode === 'classic' ? 'mode-not-classic' : 'mode-not-season');
    }
    if (!Array.isArray(combatants) || combatants.length !== 2) reasons.push('combatant-count-not-2');
    if (trimString(language) !== 'zh-CN') reasons.push('language-not-zh-cn');

    const actualStoryGuidance = normalizeStrictStoryGuidance(userGuidance);
    if (seasonStrictRules.storyGuidance) {
      if (!actualStoryGuidance) reasons.push('season-user-guidance-missing');
      else if (actualStoryGuidance !== seasonStrictRules.storyGuidance) reasons.push('season-user-guidance-mismatch');
    } else if (actualStoryGuidance) {
      reasons.push('has-user-guidance');
    }

    if (seasonStrictRules.mode === 'scenario') {
      if (!scenarioEnabled) reasons.push('season-scenario-missing');
      if (seasonStrictRules.scenarioPresetFilename) {
        if (scenarioFileName !== seasonStrictRules.scenarioPresetFilename) reasons.push('season-scenario-preset-mismatch');
      }
      if (auxScenarioCount > 0) reasons.push('season-aux-scenarios-not-allowed');
    }

    if (seasonStrictRules.questionnaireLorePresetIds.length > 0) {
      const requiredSet = new Set(seasonStrictRules.questionnaireLorePresetIds);
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
    } else if (questionnaireLoreEnabled && !seasonStrictRules.questionnaireLoreAllowed) {
      reasons.push('season-questionnaire-lore-not-allowed');
    }

    if (readArenaHistory) reasons.push('read-arena-history');
    if (readCurrentState) reasons.push('read-current-state');
    if (readNarrativeHistory) reasons.push('read-narrative-history');
    if (adjudicationEventCount > 0) reasons.push('has-adjudication-events');
    if (materialCount > 0) reasons.push('has-materials');
    if (customModelId && isStrictRankedModelBlacklisted(customModelId)) reasons.push('ai-model-blacklisted');
    if (
      Array.isArray(combatants) &&
      combatants.some((c) => typeof c?.characterGuidance === 'string' && c.characterGuidance.trim())
    ) {
      reasons.push('has-character-guidance');
    }

    if (Array.isArray(combatants) && combatants.length === 2 && combatants.some((c) => !isRankableCombatant(c))) {
      reasons.push('combatants-unrankable');
    }

    if (reasons.length === 0 && Array.isArray(combatants) && combatants.length === 2) {
      const entities = (combatants as unknown[]).map(parseArenaEntityFromCombatant);
      if (entities.some((e) => e == null)) {
        reasons.push('combatants-unrankable');
      } else if (!db) {
        reasons.push('strict-check-failed');
      } else {
        const [a, b] = entities as [ArenaEntity, ArenaEntity];
        const strictCardOk = await validateStrictPublicDataCards(db, [a, b]);
        if (!strictCardOk.ok) {
          reasons.push(strictCardOk.reason);
        } else {
          try {
            const ratingRows = await getStrictArenaRatingsByEntities(db, a, b);
            const aRow = ratingRows.find((r) => r.entityType === a.entityType && r.entityId === a.entityId);
            const bRow = ratingRows.find((r) => r.entityType === b.entityType && r.entityId === b.entityId);
            const aRating = typeof aRow?.rating === 'number' ? aRow.rating : INITIAL_RATING;
            const aGames = typeof aRow?.games === 'number' ? aRow.games : 0;
            const bRating = typeof bRow?.rating === 'number' ? bRow.rating : INITIAL_RATING;
            const bGames = typeof bRow?.games === 'number' ? bRow.games : 0;

            const involvesPreset = a.entityType === 'preset' || b.entityType === 'preset';
            if (!involvesPreset) {
              range = getStrictRangeCheckResult(
                { rating: aRating, games: aGames },
                { rating: bRating, games: bGames },
              );
              if (range && range.exceededBy > 0) {
                reasons.push('strict-out-of-range');
              }
            }

            if (typeof user?.id === 'number') {
              const pairKey = buildPairKey(a, b);
              pairUsage = await getStrictPairUsage(user.id, pairKey);
              if (pairUsage?.recentDeduped) {
                reasons.push('dedup-user-pair');
              } else if (pairUsage?.exceeded) {
                reasons.push('pair-daily-limit');
              }
            }
          } catch (error) {
            console.warn('strict-preflight 检查对手区间/去重失败（降级为不计 strict）:', error);
            reasons.push('strict-check-failed');
          }
        }
      }
    }

    const shouldConsiderDailyLimit = reasons.length === 0 && typeof user?.id === 'number';
    const dailyUsage = shouldConsiderDailyLimit ? await getStrictDailyUsage(user.id) : null;
    if ((dailyUsage?.exceeded ?? false) === true) {
      reasons.push('daily-limit');
    }

    const response: ApiSuccessResponse = {
      success: true,
      willCount: reasons.length === 0,
      reasons,
      range,
      daily: {
        used: dailyUsage?.used ?? null,
        limit: STRICT_DAILY_LIMIT,
        exceeded: dailyUsage?.exceeded ?? null,
        sinceIso: dailyUsage?.sinceIso ?? null,
      },
      pair: {
        used: pairUsage?.usedToday ?? null,
        limit: pairUsage?.limit ?? STRICT_SAME_PAIR_DAILY_LIMIT,
        exceeded: pairUsage?.exceeded ?? null,
        recentDeduped: pairUsage?.recentDeduped ?? null,
        recentAppliedAtIso: pairUsage?.recentAppliedAtIso ?? null,
        nextEligibleAtIso: pairUsage?.nextEligibleAtIso ?? null,
        windowMinutes: Math.floor(STRICT_DEDUP_WINDOW_MS / 60000),
      },
    };

    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('strict-preflight 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '无法检查严格排位计分状态' } satisfies ApiErrorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default withPagesApiResponse(handler);
