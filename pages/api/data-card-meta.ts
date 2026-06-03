import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getRequestUrl } from '@/lib/request-url';
import type { NextRequest } from 'next/server';

import { getAuthUser } from '@/lib/auth/server';
import { applyQueenTier, computeArenaBaseTier } from '@/lib/arena/tier';
import {
  type DataCardArenaRatingRow,
  type DataCardMetaCardRow,
  getArenaRatingsByDataCardId,
  getDataCardMetaCardById,
  getDataCardMetricsByDataCardId,
  queryArenaPublicQueenEntityByQueue,
} from '@/lib/db/repositories/data-card-meta';
import { upsertDataCardMetrics } from '@/lib/database/data-card-metrics';
import { getTagsForDataCard, type TagScope } from '@/lib/database/tags';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { verifySignature } from '@/lib/signature';

type Queue = 'strict' | 'free';

type ApiTag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagScope;
  isActive: boolean;
};

export type ApiRatingSeasonExtreme = {
  rating: number;
  games: number;
  occurredAt: string;
  tier: string;
};

export type ApiRating = {
  queue: Queue;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
  lastDelta: number | null;
  lastAppliedAt: string | null;
  publicRank: number | null;
  publicTotal: number | null;
  seasonPeak: ApiRatingSeasonExtreme | null;
  seasonPeakTier: string | null;
  seasonLow: ApiRatingSeasonExtreme | null;
};

type ApiMetrics = {
  techScore: number;
  techLevel: string;
  isNative: boolean | null;
  dataCardUpdatedAt: string;
  isStale: boolean;
};

type BuildApiRatingFromRowOptions = {
  cardType: DataCardMetaCardRow['type'];
  isQueen: boolean;
};

const ARENA_TIER_WHITELIST = new Set(['无牌', '白牌', '字牌', '花牌', '权杖', '女王']);

const buildSeasonExtreme = (
  rating: number | null,
  games: number | null,
  occurredAt: string | null,
): ApiRatingSeasonExtreme | null => {
  if (typeof rating !== 'number' || typeof games !== 'number' || typeof occurredAt !== 'string') return null;
  return {
    rating,
    games,
    occurredAt,
    tier: computeArenaBaseTier(rating, games),
  };
};

const normalizeSeasonPeakTier = (queue: Queue, seasonPeakTier: unknown): string | null => {
  if (queue !== 'strict') return null;
  if (typeof seasonPeakTier !== 'string') return null;
  const normalized = seasonPeakTier.trim();
  if (!normalized) return null;
  return ARENA_TIER_WHITELIST.has(normalized) ? normalized : null;
};

export function buildApiRatingFromRow(
  row: DataCardArenaRatingRow,
  options: BuildApiRatingFromRowOptions,
): ApiRating {
  const queue: Queue = row.queue === 'free' ? 'free' : 'strict';
  const rating = typeof row.rating === 'number' ? row.rating : 0;
  const games = typeof row.games === 'number' ? row.games : 0;
  const baseTier = computeArenaBaseTier(rating, games);
  const tier = applyQueenTier(baseTier, options.isQueen);
  const lastDelta = options.cardType === 'character' && typeof row.lastDelta === 'number' ? row.lastDelta : null;
  const lastAppliedAt =
    options.cardType === 'character' && typeof row.lastAppliedAt === 'string' ? row.lastAppliedAt : null;

  const seasonPeak = queue === 'strict' ? buildSeasonExtreme(row.seasonPeakRating, row.seasonPeakGames, row.seasonPeakAt) : null;
  const seasonPeakTier = normalizeSeasonPeakTier(queue, row.seasonPeakTier);
  const seasonLow = queue === 'strict' ? buildSeasonExtreme(row.seasonLowRating, row.seasonLowGames, row.seasonLowAt) : null;

  return {
    queue,
    rating,
    games,
    wins: typeof row.wins === 'number' ? row.wins : 0,
    losses: typeof row.losses === 'number' ? row.losses : 0,
    draws: typeof row.draws === 'number' ? row.draws : 0,
    tier,
    lastDelta,
    lastAppliedAt,
    publicRank: null,
    publicTotal: null,
    seasonPeak,
    seasonPeakTier,
    seasonLow,
  };
}

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  const db = getDrizzleDbFromRuntime();
  if (!db) {
    return json({ error: '数据库绑定不可用，请检查 Cloudflare D1 配置' }, 503);
  }

  const url = getRequestUrl(req);
  const dataCardId = (url.searchParams.get('dataCardId') ?? '').trim();
  if (!dataCardId) {
    return json({ error: '缺少 dataCardId' }, 400);
  }

  try {
    const cardRow = await getDataCardMetaCardById(db, dataCardId);
    if (!cardRow) {
      return json({ error: '数据卡不存在' }, 404);
    }

    const isPublicReadable = cardRow.isPublic && cardRow.reviewStatus === 'approved';
    if (!isPublicReadable) {
      const auth = await getAuthUser(req);
      if (!auth) {
        return json({ error: '未授权' }, 401);
      }
      if (auth.user.id !== cardRow.userId) {
        return json({ error: '无权访问该数据卡' }, 403);
      }
    }

    let tags: ApiTag[] = [];
    try {
      const tagRows = await getTagsForDataCard(dataCardId);
      tags = tagRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        category: row.category ?? null,
        scope: row.scope,
        isActive: row.is_active === 1,
      }));
    } catch (error) {
      console.warn('读取标签失败（降级为空）:', error);
    }

    let metrics: ApiMetrics | null = null;
    try {
      const metricsRow = await getDataCardMetricsByDataCardId(db, dataCardId);
      const cardUpdatedAt = cardRow.updatedAt ?? new Date().toISOString();
      const isStale = !metricsRow || metricsRow.dataCardUpdatedAt !== cardUpdatedAt;

      if (!isStale && metricsRow) {
        metrics = {
          techScore: metricsRow.techScore,
          techLevel: metricsRow.techLevel,
          isNative: metricsRow.isNative,
          dataCardUpdatedAt: metricsRow.dataCardUpdatedAt,
          isStale: false,
        };
      } else {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(cardRow.data) as unknown;
        } catch {
          parsed = null;
        }

        if (parsed) {
          const tech = computeTechIndex(parsed);
          const hasSignatureKey = Boolean(process.env.SIGNATURE_SECRET_KEY);
          const isNative = hasSignatureKey ? await verifySignature(parsed as any) : null;

          metrics = {
            techScore: tech.techScore,
            techLevel: tech.techLevel,
            isNative,
            dataCardUpdatedAt: cardUpdatedAt,
            isStale: true,
          };

          const detailsJson = {
            raw: tech.raw,
            derived: tech.derived,
            components: tech.components,
            notes: tech.notes,
          };

          const upsertPromise = upsertDataCardMetrics({
            dataCardId,
            techScore: tech.techScore,
            techLevel: tech.techLevel,
            isNative,
            dataCardUpdatedAt: cardUpdatedAt,
            detailsJson,
          });

          const executionContext = (req as any).context;
          if (executionContext?.waitUntil) {
            executionContext.waitUntil(upsertPromise);
          } else {
            await upsertPromise;
          }
        }
      }
    } catch (error) {
      console.warn('读取/更新技术值失败（降级为 null）:', error);
      metrics = null;
    }

    const ratings: { strict: ApiRating | null; free: ApiRating | null } = { strict: null, free: null };
    try {
      const queenByQueue = new Map<Queue, Promise<Awaited<ReturnType<typeof queryArenaPublicQueenEntityByQueue>>>>();
      const getQueen = (queue: Queue) => {
        const normalized: Queue = queue === 'free' ? 'free' : 'strict';
        const cached = queenByQueue.get(normalized);
        if (cached) return cached;

        const promise = queryArenaPublicQueenEntityByQueue(db, normalized).catch((error) => {
          console.warn('读取女王段位失败（降级为无女王）:', error);
          return null;
        });
        queenByQueue.set(normalized, promise);
        return promise;
      };

      const rows = await getArenaRatingsByDataCardId(db, dataCardId, ['strict', 'free']);
      for (const row of rows) {
        const queue: Queue = row.queue === 'free' ? 'free' : 'strict';
        const rating = typeof row.rating === 'number' ? row.rating : 0;
        const games = typeof row.games === 'number' ? row.games : 0;
        const baseTier = computeArenaBaseTier(rating, games);
        const queen = baseTier === '权杖' ? await getQueen(queue) : null;
        const isQueen = queen?.entityType === 'data_card' && queen?.entityId === dataCardId;
        const item = buildApiRatingFromRow(row, { cardType: cardRow.type, isQueen });

        if (item.queue === 'strict') ratings.strict = item;
        else ratings.free = item;
      }
    } catch (error) {
      console.warn('读取排位失败（降级为 null）:', error);
    }

    return json({
      success: true,
      dataCardId,
      tags,
      metrics,
      ratings,
    });
  } catch (error) {
    console.error('读取 data-card-meta 失败:', error);
    return json({ success: false, error: '无法加载数据卡指标' }, 500);
  }
}

export default withPagesApiResponse(handler);
