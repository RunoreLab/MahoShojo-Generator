import type { NextRequest } from 'next/server';

import { queryFromD1 } from '@/lib/d1';
import { getBattleReportGenerationCombatantsByGenerationId, type BattleReportGenerationCombatantRow } from '@/lib/database/battle-report-generation-combatants';
import {
  buildEntityKey,
  getArenaEligibilitySnapshotByGenerationId,
  isFreeEligible,
  isStrictEligible,
  parseCombatantEntity,
  type ArenaEntity,
  type ArenaEligibilitySnapshot,
} from '@/lib/database/arena-ratings';

export const config = {
  runtime: 'edge',
};

type ApiQueue = 'strict' | 'free';

type ApiQueueResult = {
  eligible: boolean;
  ineligibleReasons: string[];
  eventStatus: 'missing' | 'pending' | 'applied' | 'skipped' | 'failed';
  skipReason: string | null;
  rating: number | null;
  games: number | null;
  tier: string | null;
  delta: number | null;
};

type ApiParticipantResult = {
  displayName: string;
  entityType: 'data_card' | 'preset' | 'unknown';
  entityId: string | null;
  entityKey: string | null;
  dataCardId: string | null;
  presetId: string | null;
  queues: Record<ApiQueue, ApiQueueResult>;
};

type ApiResponse =
  | {
      success: true;
      generationId: string;
      state: 'pending';
      message: string;
    }
  | {
      success: true;
      generationId: string;
      state: 'ready';
      snapshot: ArenaEligibilitySnapshot;
      participants: ApiParticipantResult[];
    }
  | {
      success: false;
      generationId: string;
      error: string;
    };

const computeTier = (rating: number, games: number) => {
  const placementGames = 5;
  if (games < placementGames || rating < 900) return '无牌';
  if (rating < 1100) return '白牌';
  if (rating < 1300) return '字牌';
  if (rating < 1600) return '花牌';
  return '权杖';
};

const buildStrictIneligibleReasons = (snapshot: ArenaEligibilitySnapshot, combatants: BattleReportGenerationCombatantRow[]): string[] => {
  const reasons: string[] = [];
  if (snapshot.status !== 'completed') reasons.push('status-not-completed');
  if (snapshot.combatantCount !== 2) reasons.push('combatant-count-not-2');
  if (snapshot.ipAnonymized == null) reasons.push('ip-missing');
  if (snapshot.mode !== 'classic') reasons.push('mode-not-classic');
  if (snapshot.userId == null) reasons.push('need-login');
  if (snapshot.hasUserGuidance !== 0) reasons.push('has-user-guidance');
  if (snapshot.hasAdjudicationEvents !== 0) reasons.push('has-adjudication-events');
  if (snapshot.readArenaHistory !== 0) reasons.push('read-arena-history');
  if (snapshot.readCurrentState !== 0) reasons.push('read-current-state');
  if (combatants.some((c) => typeof c.character_guidance === 'string' && c.character_guidance.trim())) reasons.push('has-character-guidance');
  return reasons;
};

const buildFreeIneligibleReasons = (snapshot: ArenaEligibilitySnapshot): string[] => {
  const reasons: string[] = [];
  if (snapshot.status !== 'completed') reasons.push('status-not-completed');
  if (snapshot.combatantCount !== 2) reasons.push('combatant-count-not-2');
  if (snapshot.ipAnonymized == null) reasons.push('ip-missing');
  return reasons;
};

const readRows = <T,>(result: any): T[] => {
  const rows = result?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
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
});

export default async function handler(req: NextRequest) {
  const url = new URL(req.url);
  const generationId = (url.searchParams.get('generationId') ?? '').trim();

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!generationId) {
    return new Response(JSON.stringify({ success: false, generationId: '', error: '缺少 generationId' } satisfies ApiResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const snapshot = await getArenaEligibilitySnapshotByGenerationId(generationId);
    if (!snapshot) {
      const res: ApiResponse = {
        success: true,
        generationId,
        state: 'pending',
        message: '战报记录尚未落库，排位结算尚不可用（请稍后重试）',
      };
      return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const combatants = await getBattleReportGenerationCombatantsByGenerationId(generationId);
    if (!Array.isArray(combatants) || combatants.length === 0) {
      const res: ApiResponse = {
        success: true,
        generationId,
        state: 'pending',
        message: '参战者明细尚未落库，排位结算尚不可用（请稍后重试）',
      };
      return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
        queues: {
          strict: buildDefaultQueueResult(strictEligible, strictIneligibleReasons),
          free: buildDefaultQueueResult(freeEligible, freeIneligibleReasons),
        },
      };
    });

    // 读取事件（可能尚未插入）
    const eventRows = readRows<{
      queue: ApiQueue;
      status: 'pending' | 'applied' | 'skipped' | 'failed';
      skip_reason: string | null;
      a_entity_type: 'data_card' | 'preset';
      a_entity_id: string;
      b_entity_type: 'data_card' | 'preset';
      b_entity_id: string;
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
    }>(
      await queryFromD1(
        `SELECT
          queue,
          status,
          skip_reason,
          a_entity_type,
          a_entity_id,
          b_entity_type,
          b_entity_id,
          a_before_rating,
          a_after_rating,
          a_delta,
          a_before_games,
          a_after_games,
          b_before_rating,
          b_after_rating,
          b_delta,
          b_before_games,
          b_after_games
        FROM arena_rating_events
        WHERE generation_id = ?
          AND queue IN ('strict', 'free')`,
        [generationId],
      ),
    );

    const eventByQueue = new Map<ApiQueue, (typeof eventRows)[number]>();
    eventRows.forEach((row) => eventByQueue.set(row.queue === 'free' ? 'free' : 'strict', row));

    const entitiesForRatings: ArenaEntity[] = participantEntities.filter((e): e is ArenaEntity => Boolean(e));

    // 读取当前分数（用于展示当前段位/分数；同时可在 pending/缺事件时作为回退）
    const ratingRows = readRows<{
      queue: ApiQueue;
      entity_type: 'data_card' | 'preset';
      entity_id: string;
      rating: number;
      games: number;
    }>(
      await queryFromD1(
        `SELECT queue, entity_type, entity_id, rating, games
         FROM arena_ratings
         WHERE queue IN ('strict', 'free')
           AND (
             ${entitiesForRatings.map(() => `(entity_type = ? AND entity_id = ?)`).join(' OR ') || '1=0'}
           )`,
        entitiesForRatings.flatMap((e) => [e.entityType, e.entityId]),
      ),
    );

    const ratingByKey = new Map<string, { queue: ApiQueue; rating: number; games: number; tier: string }>();
    ratingRows.forEach((row) => {
      const key = `${row.queue}:${row.entity_type}:${row.entity_id}`;
      const rating = typeof row.rating === 'number' ? row.rating : 0;
      const games = typeof row.games === 'number' ? row.games : 0;
      ratingByKey.set(key, { queue: row.queue, rating, games, tier: computeTier(rating, games) });
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
      const skipReason = typeof event.skip_reason === 'string' ? event.skip_reason : null;
      const aKey = buildEntityKey({ entityType: event.a_entity_type, entityId: event.a_entity_id });
      const bKey = buildEntityKey({ entityType: event.b_entity_type, entityId: event.b_entity_id });

      participants.forEach((p) => {
        const qr = p.queues[queue];
        if (!qr.eligible) return;
        qr.eventStatus = eventStatus;
        qr.skipReason = skipReason;

        const entityKey = p.entityKey;
        if (!entityKey) return;

        const ratingFallback = ratingByKey.get(`${queue}:${entityKey}`);
        if (ratingFallback) {
          qr.rating = ratingFallback.rating;
          qr.games = ratingFallback.games;
          qr.tier = ratingFallback.tier;
        }

        if (eventStatus !== 'applied') {
          return;
        }

        if (entityKey === aKey) {
          if (typeof event.a_after_rating === 'number') qr.rating = event.a_after_rating;
          if (typeof event.a_after_games === 'number') qr.games = event.a_after_games;
          if (typeof qr.rating === 'number' && typeof qr.games === 'number') qr.tier = computeTier(qr.rating, qr.games);
          qr.delta = typeof event.a_delta === 'number' ? event.a_delta : null;
          return;
        }
        if (entityKey === bKey) {
          if (typeof event.b_after_rating === 'number') qr.rating = event.b_after_rating;
          if (typeof event.b_after_games === 'number') qr.games = event.b_after_games;
          if (typeof qr.rating === 'number' && typeof qr.games === 'number') qr.tier = computeTier(qr.rating, qr.games);
          qr.delta = typeof event.b_delta === 'number' ? event.b_delta : null;
        }
      });
    };

    applyEventToParticipants('strict');
    applyEventToParticipants('free');

    const res: ApiResponse = {
      success: true,
      generationId,
      state: 'ready',
      snapshot,
      participants,
    };
    return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('读取 generation-ranking 失败:', error);
    const res: ApiResponse = {
      success: false,
      generationId,
      error: '无法加载本局排位信息',
    };
    return new Response(JSON.stringify(res), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
