import type { NextRequest } from 'next/server';

import { getUserByAuthKey, queryFromD1 } from '@/lib/d1';
import { PRESET_LIST } from '@/lib/presets';
import { issueRankedMatchTicket, type RankedMatchEntity } from '@/lib/arena/ranked-match';
import { INITIAL_RATING, STRICT_DEDUP_WINDOW_MS, buildPairKey } from '@/lib/database/arena-ratings';

export const config = {
  runtime: 'edge',
};

type DataCardOpponentCard = {
  id: string;
  name: string;
  description: string | null;
  data: string;
  is_public: number | boolean | null;
  updated_at: string | null;
  created_at: string | null;
  username: string | null;
  like_count: number | null;
  favorite_count: number | null;
  usage_count: number | null;
};

type DataCardOpponent = { entityType: 'data_card'; card: DataCardOpponentCard };
type PresetOpponent = { entityType: 'preset'; preset: { name: string; filename: string; type: 'magical-girl' | 'canshou' } };

type ApiSuccessResponse = {
  success: true;
  ticket: unknown;
  opponent: DataCardOpponent | PresetOpponent;
  note?: string;
};

type ApiErrorResponse = { success: false; error: string };

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeNonNegativeInt = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
};

const readPlayerEntity = (raw: unknown): RankedMatchEntity | null => {
  if (!raw || typeof raw !== 'object') return null;
  const anyRaw = raw as any;
  const entityType = anyRaw.entityType === 'preset' ? 'preset' : anyRaw.entityType === 'data_card' ? 'data_card' : null;
  const entityId = typeof anyRaw.entityId === 'string' ? anyRaw.entityId.trim() : '';
  if (!entityType || !entityId) return null;
  return { entityType, entityId };
};

const buildStrictPreflightErrors = (snapshot: {
  mode: string;
  language: string;
  selectedLevel: string;
  userGuidance: string;
  readArenaHistory: boolean;
  readCurrentState: boolean;
  readNarrativeHistory: boolean;
  adjudicationEventCount: number;
  characterGuidanceCount: number;
  scenarioEnabled: boolean;
  auxScenarioCount: number;
}): string[] => {
  const errors: string[] = [];
  if (snapshot.mode !== 'classic') errors.push('需为「经典模式」');
  if (snapshot.language !== 'zh-CN') errors.push('生成语言需为「简体中文」');
  if (snapshot.selectedLevel.trim()) errors.push('等级需为「默认」');
  if (snapshot.userGuidance.trim()) errors.push('需清空「故事引导」');
  if (snapshot.readArenaHistory) errors.push('需关闭「读取历战」');
  if (snapshot.readCurrentState) errors.push('需关闭「读取当前状态」');
  if (snapshot.readNarrativeHistory) errors.push('需关闭「读取叙事历史」');
  if (snapshot.adjudicationEventCount > 0) errors.push('需清空「随机判定器事件」');
  if (snapshot.characterGuidanceCount > 0) errors.push('需清空「角色行动引导」');
  if (snapshot.scenarioEnabled) errors.push('需关闭「情景模式」');
  if (snapshot.auxScenarioCount > 0) errors.push('需移除「辅助情景」');
  return errors;
};

type Candidate =
  | {
      kind: 'data_card';
      entity: { entityType: 'data_card'; entityId: string };
      rating: number;
      games: number;
      card: DataCardOpponentCard;
    }
  | {
      kind: 'preset';
      entity: { entityType: 'preset'; entityId: string };
      rating: number;
      games: number;
      preset: { name: string; filename: string; type: 'magical-girl' | 'canshou' };
    };

type DataCardCandidate = Extract<Candidate, { kind: 'data_card' }>;
type PresetCandidate = Extract<Candidate, { kind: 'preset' }>;

const pickWeightedCandidate = (candidates: Candidate[], targetRating: number): Candidate => {
  const scored = candidates
    .map((c) => {
      const diff = Math.abs((Number.isFinite(c.rating) ? c.rating : INITIAL_RATING) - targetRating);
      const weight = Math.exp(-diff / 150);
      return { c, weight };
    })
    .sort((a, b) => b.weight - a.weight);

  const top = scored.slice(0, Math.max(1, Math.min(30, scored.length)));
  const sum = top.reduce((acc, item) => acc + item.weight, 0);
  if (!Number.isFinite(sum) || sum <= 0) return top[0]!.c;
  let roll = Math.random() * sum;
  for (const item of top) {
    roll -= item.weight;
    if (roll <= 0) return item.c;
  }
  return top[top.length - 1]!.c;
};

const getEntityRating = async (entity: RankedMatchEntity): Promise<{ rating: number; games: number }> => {
  const result = (await queryFromD1(
    `SELECT rating, games
     FROM arena_ratings
     WHERE queue = 'strict'
       AND entity_type = ?
       AND entity_id = ?
     LIMIT 1`,
    [entity.entityType, entity.entityId]
  )) as any;
  const row = readRows<{ rating: number; games: number }>(result)[0];
  const rating = typeof row?.rating === 'number' ? row.rating : INITIAL_RATING;
  const games = typeof row?.games === 'number' ? row.games : 0;
  return { rating, games };
};

const readRecentPairKeys = async (userId: number, sinceIso: string): Promise<Set<string>> => {
  const result = (await queryFromD1(
    `SELECT pair_key
     FROM arena_rating_events
     WHERE queue = 'strict'
       AND status = 'applied'
       AND user_id = ?
       AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId, sinceIso]
  )) as any;
  const rows = readRows<{ pair_key: string }>(result);
  const set = new Set<string>();
  rows.forEach((row) => {
    const key = typeof row?.pair_key === 'string' ? row.pair_key.trim() : '';
    if (key) set.add(key);
  });
  return set;
};

const loadPresetCandidates = async (): Promise<Map<string, { rating: number; games: number }>> => {
  const ids = PRESET_LIST.map((p) => p.filename);
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const result = (await queryFromD1(
    `SELECT entity_id as entityId, rating, games
     FROM arena_ratings
     WHERE queue = 'strict'
       AND entity_type = 'preset'
       AND entity_id IN (${placeholders})`,
    ids
  )) as any;
  const rows = readRows<{ entityId: string; rating: number; games: number }>(result);
  const map = new Map<string, { rating: number; games: number }>();
  rows.forEach((row) => {
    const id = typeof row?.entityId === 'string' ? row.entityId.trim() : '';
    if (!id) return;
    map.set(id, {
      rating: typeof row.rating === 'number' ? row.rating : INITIAL_RATING,
      games: typeof row.games === 'number' ? row.games : 0,
    });
  });
  return map;
};

const fetchDataCardCandidatesInRange = async (input: {
  playerId: string;
  minRating: number;
  maxRating: number;
  targetRating: number;
  limit: number;
}): Promise<DataCardCandidate[]> => {
  const result = (await queryFromD1(
    `SELECT
      dc.id as id,
      dc.name as name,
      dc.description as description,
      dc.data as data,
      dc.is_public as is_public,
      dc.updated_at as updated_at,
      dc.created_at as created_at,
      dc.like_count as like_count,
      dc.favorite_count as favorite_count,
      dc.usage_count as usage_count,
      u.username as username,
      COALESCE(ar.rating, ${INITIAL_RATING}) as rating,
      COALESCE(ar.games, 0) as games
     FROM data_cards dc
     LEFT JOIN arena_ratings ar
       ON ar.queue = 'strict'
      AND ar.entity_type = 'data_card'
      AND ar.entity_id = dc.id
     LEFT JOIN users u
       ON u.id = dc.user_id
     WHERE dc.type = 'character'
       AND dc.deleted_at IS NULL
       AND dc.is_public = 1
       AND dc.id <> ?
       AND COALESCE(ar.rating, ${INITIAL_RATING}) BETWEEN ? AND ?
     ORDER BY ABS(COALESCE(ar.rating, ${INITIAL_RATING}) - ?) ASC
     LIMIT ?`,
    [input.playerId, input.minRating, input.maxRating, input.targetRating, input.limit]
  )) as any;

  const rows = readRows<{
    id: string;
    name: string;
    description: string | null;
    data: string;
    is_public: number | boolean | null;
    updated_at: string | null;
    created_at: string | null;
    like_count?: number | null;
    favorite_count?: number | null;
    usage_count?: number | null;
    username: string | null;
    rating: number;
    games: number;
  }>(result);

  return rows
    .map((row) => {
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (!id) return null;
      return {
        kind: 'data_card' as const,
        entity: { entityType: 'data_card' as const, entityId: id },
        rating: typeof row.rating === 'number' ? row.rating : INITIAL_RATING,
        games: typeof row.games === 'number' ? row.games : 0,
        card: {
          id,
          name: typeof row.name === 'string' ? row.name : '未命名',
          description: typeof row.description === 'string' ? row.description : null,
          data: row.data,
          is_public: row.is_public ?? null,
          updated_at: row.updated_at ?? null,
          created_at: row.created_at ?? null,
          username: row.username ?? null,
          like_count: typeof row.like_count === 'number' ? row.like_count : null,
          favorite_count: typeof row.favorite_count === 'number' ? row.favorite_count : null,
          usage_count: typeof row.usage_count === 'number' ? row.usage_count : null,
        },
      };
    })
    .filter((item): item is DataCardCandidate => item !== null);
};

const buildPresetCandidatesInRange = (input: {
  player: RankedMatchEntity;
  minRating: number;
  maxRating: number;
  presetRatings: Map<string, { rating: number; games: number }>;
}): PresetCandidate[] => {
  return PRESET_LIST
    .filter((preset) => preset.filename !== input.player.entityId)
    .map((preset) => {
      const stats = input.presetRatings.get(preset.filename) ?? { rating: INITIAL_RATING, games: 0 };
      const rating = stats.rating;
      if (rating < input.minRating || rating > input.maxRating) return null;
      return {
        kind: 'preset' as const,
        entity: { entityType: 'preset' as const, entityId: preset.filename },
        rating,
        games: stats.games,
        preset: { name: preset.name, filename: preset.filename, type: preset.type },
      };
    })
    .filter((item): item is PresetCandidate => item !== null);
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' } satisfies ApiErrorResponse), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('authorization');
    const authKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const user = authKey ? await getUserByAuthKey(authKey) : null;
    if (!user?.id) {
      return new Response(JSON.stringify({ success: false, error: '需要先登录才能进行严格排位匹配' } satisfies ApiErrorResponse), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const player = readPlayerEntity(body?.player);
    if (!player) {
      return new Response(JSON.stringify({ success: false, error: '缺少有效的参战角色（player）' } satisfies ApiErrorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 预检：必须先满足严格排位关键设置（否则签发票据也无意义）
    const snapshot = {
      mode: normalizeString(body?.mode),
      language: normalizeString(body?.language),
      selectedLevel: normalizeString(body?.selectedLevel),
      userGuidance: normalizeString(body?.settings?.userGuidance),
      readArenaHistory: Boolean(body?.settings?.readArenaHistory),
      readCurrentState: Boolean(body?.settings?.readCurrentState),
      readNarrativeHistory: Boolean(body?.settings?.readNarrativeHistory),
      adjudicationEventCount: normalizeNonNegativeInt(body?.adjudicationEventCount),
      characterGuidanceCount: normalizeNonNegativeInt(body?.characterGuidanceCount),
      scenarioEnabled: Boolean(body?.scenarioEnabled),
      auxScenarioCount: normalizeNonNegativeInt(body?.auxScenarioCount),
    };

    const preflightErrors = buildStrictPreflightErrors(snapshot);
    if (preflightErrors.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `当前设置不满足严格排位匹配前置条件：${preflightErrors.join('、')}`,
      } satisfies ApiErrorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 校验 player 实体可用性
    if (player.entityType === 'preset') {
      const exists = PRESET_LIST.some((p) => p.filename === player.entityId);
      if (!exists) {
        return new Response(JSON.stringify({ success: false, error: '预设角色不存在，无法匹配' } satisfies ApiErrorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      const result = (await queryFromD1(
        `SELECT id, type, user_id as userId, is_public as isPublic, deleted_at as deletedAt
         FROM data_cards
         WHERE id = ?
         LIMIT 1`,
        [player.entityId]
      )) as any;
      const row = readRows<{ id: string; type: string; userId: number; isPublic: number | boolean; deletedAt: string | null }>(result)[0];
      if (!row?.id || row.deletedAt) {
        return new Response(JSON.stringify({ success: false, error: '数据卡不存在或已被删除' } satisfies ApiErrorResponse), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (row.type !== 'character') {
        return new Response(JSON.stringify({ success: false, error: '仅支持“角色”类型的数据卡参与排位匹配' } satisfies ApiErrorResponse), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const isPublic = row.isPublic === 1 || row.isPublic === true;
      if (!isPublic && row.userId !== user.id) {
        return new Response(JSON.stringify({ success: false, error: '无权使用该私有数据卡进行排位匹配' } satisfies ApiErrorResponse), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const playerRating = await getEntityRating(player);
    const sinceIso = new Date(Date.now() - STRICT_DEDUP_WINDOW_MS).toISOString();
    const recentPairKeys = await readRecentPairKeys(user.id, sinceIso);
    const presetRatings = await loadPresetCandidates();

    const windowSteps = [50, 100, 150, 200, 300, 400, 600, 800, 1200, 2000, 5000];
    const tryPick = async (allowRepeat: boolean): Promise<{ picked: Candidate | null; note?: string }> => {
      for (const step of windowSteps) {
        const minRating = playerRating.rating - step;
        const maxRating = playerRating.rating + step;
        const dataCardCandidates = await fetchDataCardCandidatesInRange({
          playerId: player.entityType === 'data_card' ? player.entityId : '',
          minRating,
          maxRating,
          targetRating: playerRating.rating,
          limit: 80,
        });
        const presetCandidates = buildPresetCandidatesInRange({ player, minRating, maxRating, presetRatings });
        const merged = [...dataCardCandidates, ...presetCandidates].filter((c) => {
          if (c.entity.entityType === player.entityType && c.entity.entityId === player.entityId) return false;
          if (!allowRepeat) {
            const pairKey = buildPairKey(player as any, c.entity as any);
            if (recentPairKeys.has(pairKey)) return false;
          }
          return true;
        });
        if (merged.length > 0) {
          return { picked: pickWeightedCandidate(merged, playerRating.rating) };
        }
      }
      return { picked: null };
    };

    const primary = await tryPick(false);
    const fallback = primary.picked ? null : await tryPick(true);
    const picked = primary.picked ?? fallback?.picked ?? null;
    const note =
      primary.picked
        ? undefined
        : (picked ? '候选对手较少，已允许在时间窗内重复匹配' : undefined);

    if (!picked) {
      return new Response(JSON.stringify({ success: false, error: '当前没有可匹配的对手（公开角色不足）' } satisfies ApiErrorResponse), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ticketResult = await issueRankedMatchTicket({
      userId: user.id,
      player,
      opponent: picked.entity,
      mode: 'classic',
      selectedLevel: normalizeOptionalString(body?.selectedLevel),
      language: normalizeOptionalString(body?.language),
      storyLength: normalizeOptionalString(body?.storyLength),
      expiresInMs: STRICT_DEDUP_WINDOW_MS,
    });
    if (!ticketResult.ok) {
      return new Response(JSON.stringify({ success: false, error: ticketResult.error } satisfies ApiErrorResponse), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response: ApiSuccessResponse = picked.kind === 'data_card'
      ? { success: true, ticket: ticketResult.ticket, opponent: { entityType: 'data_card', card: picked.card }, ...(note ? { note } : {}) }
      : { success: true, ticket: ticketResult.ticket, opponent: { entityType: 'preset', preset: picked.preset }, ...(note ? { note } : {}) };

    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('严格排位匹配失败:', error);
    return new Response(JSON.stringify({ success: false, error: '匹配失败，服务器内部错误' } satisfies ApiErrorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
