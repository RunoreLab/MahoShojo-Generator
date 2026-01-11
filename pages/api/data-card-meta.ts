import type { NextRequest } from 'next/server';

import { getUserByAuthKey, queryFromD1 } from '@/lib/d1';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { verifySignature } from '@/lib/signature';
import { upsertDataCardMetrics } from '@/lib/database/data-card-metrics';
import { getTagsForDataCard, type TagScope } from '@/lib/database/tags';
import { applyQueenTier, computeArenaBaseTier, queryArenaPublicQueenEntity } from '@/lib/arena/tier';

export const config = {
  runtime: 'edge',
};

type Queue = 'strict' | 'free';

type ApiTag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagScope;
  isActive: boolean;
};

type ApiRating = {
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
};

type ApiMetrics = {
  techScore: number;
  techLevel: string;
  isNative: boolean | null;
  dataCardUpdatedAt: string;
  isStale: boolean;
};

const readSingleRow = <T,>(result: any): T | null => {
  const row = result?.result?.[0]?.results?.[0];
  return row ? (row as T) : null;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const dataCardId = (url.searchParams.get('dataCardId') ?? '').trim();
  if (!dataCardId) {
    return new Response(JSON.stringify({ error: '缺少 dataCardId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const cardRow = readSingleRow<{
      id: string;
      user_id: number;
      type: 'character' | 'scenario' | 'history';
      is_public: number;
      review_status: 'pending' | 'approved' | 'rejected';
      updated_at: string;
      data: string;
    }>(
      await queryFromD1(
        `SELECT id, user_id, type, is_public, review_status, updated_at, data
         FROM data_cards
         WHERE id = ?
           AND deleted_at IS NULL`,
        [dataCardId],
      ),
    );

    if (!cardRow) {
      return new Response(JSON.stringify({ error: '数据卡不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isPublicReadable = cardRow.is_public === 1 && cardRow.review_status === 'approved';
    if (!isPublicReadable) {
      const authHeader = req.headers.get('authorization') ?? '';
      const authKey = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
      if (!authKey) {
        return new Response(JSON.stringify({ error: '未授权' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const user = await getUserByAuthKey(authKey);
      if (!user) {
        return new Response(JSON.stringify({ error: '未授权' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const isAdmin = Number((user as any).is_admin) === 1;
      if (!isAdmin && user.id !== cardRow.user_id) {
        return new Response(JSON.stringify({ error: '无权访问该数据卡' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
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
      const metricsRow = readSingleRow<{
        tech_score: number;
        tech_level: string;
        is_native: number | null;
        data_card_updated_at: string;
      }>(
        await queryFromD1(
          `SELECT tech_score, tech_level, is_native, data_card_updated_at
           FROM data_card_metrics
           WHERE data_card_id = ?`,
          [dataCardId],
        ),
      );

      const isStale = !metricsRow || metricsRow.data_card_updated_at !== cardRow.updated_at;
      if (!isStale && metricsRow) {
        metrics = {
          techScore: metricsRow.tech_score,
          techLevel: metricsRow.tech_level,
          isNative: metricsRow.is_native === 1 ? true : metricsRow.is_native === 0 ? false : null,
          dataCardUpdatedAt: metricsRow.data_card_updated_at,
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
            dataCardUpdatedAt: cardRow.updated_at,
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
            dataCardUpdatedAt: cardRow.updated_at,
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
      const queenByQueue = new Map<Queue, Promise<Awaited<ReturnType<typeof queryArenaPublicQueenEntity>> | null>>();
      const getQueen = (queue: Queue) => {
        const normalized: Queue = queue === 'free' ? 'free' : 'strict';
        const cached = queenByQueue.get(normalized);
        if (cached) return cached;
        const promise = queryArenaPublicQueenEntity(queryFromD1, normalized).catch((error) => {
          console.warn('读取女王段位失败（降级为无女王）:', error);
          return null;
        });
        queenByQueue.set(normalized, promise);
        return promise;
      };

      const publicTotals: Record<Queue, number | null> = { strict: null, free: null };
      if (cardRow.type === 'character') {
        const computePublicTotal = async (queue: Queue): Promise<number | null> => {
          try {
            const strictPublicSinceClause = queue === 'strict'
              ? `AND (
                dc.public_since IS NULL
                OR dc.public_since <= datetime('now', '-3 days')
                OR (
                  dc.created_at IS NOT NULL
                  AND dc.public_since IS NOT NULL
                  AND ABS(strftime('%s', dc.public_since) - strftime('%s', dc.created_at)) <= 600
                )
              )`
              : '';
            const totalResult = (await queryFromD1(
              `SELECT COUNT(*) as total
               FROM arena_ratings ar
               LEFT JOIN data_cards dc
                 ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
               WHERE ar.queue = ?
                 AND (
                   ar.entity_type = 'preset'
                   OR (
                     dc.id IS NOT NULL
                     AND dc.type = 'character'
                     AND dc.is_public = 1
                     AND dc.review_status = 'approved'
                     AND dc.deleted_at IS NULL
                     ${strictPublicSinceClause}
                   )
                 )`,
              [queue],
            )) as any;
            const row = readSingleRow<{ total: unknown }>(totalResult);
            const total =
              typeof row?.total === 'number'
                ? row.total
                : typeof row?.total === 'string'
                  ? Number(row.total)
                  : null;
            return Number.isFinite(total) ? Math.max(0, Math.floor(total as number)) : null;
          } catch (error) {
            console.warn('计算公共榜总人数失败（降级为 null）:', error);
            return null;
          }
        };

        // 单卡接口允许多查一次；但避免在循环里重复查
        publicTotals.strict = await computePublicTotal('strict');
        publicTotals.free = await computePublicTotal('free');
      }

      const lastEventsByQueue = new Map<Queue, { delta: number; appliedAt: string | null }>();
      if (cardRow.type === 'character') {
        try {
          const lastEventsResult = (await queryFromD1(
            `SELECT queue, delta, applied_at as appliedAt
             FROM (
               SELECT
                 queue,
                 applied_at,
                 created_at,
                 CASE
                   WHEN a_entity_type = 'data_card' AND a_entity_id = ? THEN a_delta
                   WHEN b_entity_type = 'data_card' AND b_entity_id = ? THEN b_delta
                   ELSE NULL
                 END AS delta,
                 ROW_NUMBER() OVER (PARTITION BY queue ORDER BY applied_at DESC, created_at DESC) AS rn
               FROM arena_rating_events
               WHERE status = 'applied'
                 AND queue IN ('strict', 'free')
                 AND (
                   (a_entity_type = 'data_card' AND a_entity_id = ?)
                   OR
                   (b_entity_type = 'data_card' AND b_entity_id = ?)
                 )
             )
             WHERE rn = 1`,
            [dataCardId, dataCardId, dataCardId, dataCardId],
          )) as any;

          const rows = (lastEventsResult?.result?.[0]?.results ?? []) as Array<{
            queue: Queue;
            delta: number | null;
            appliedAt: string | null;
          }>;

          for (const row of rows) {
            if (row.queue !== 'strict' && row.queue !== 'free') continue;
            if (typeof row.delta !== 'number') continue;
            lastEventsByQueue.set(row.queue, { delta: row.delta, appliedAt: typeof row.appliedAt === 'string' ? row.appliedAt : null });
          }
        } catch (error) {
          console.warn('读取最近排位变动失败（降级为空）:', error);
        }
      }

      const res = (await queryFromD1(
        `SELECT queue, rating, games, wins, losses, draws, updated_at
         FROM arena_ratings
         WHERE entity_type = 'data_card'
           AND entity_id = ?
           AND queue IN ('strict', 'free')`,
        [dataCardId],
      )) as any;
      const rows = (res?.result?.[0]?.results ?? []) as Array<{
        queue: Queue;
        rating: number;
        games: number;
        wins: number;
        losses: number;
        draws: number;
        updated_at: string;
      }>;
      for (const row of rows) {
        const queue: Queue = row.queue === 'free' ? 'free' : 'strict';
        const rating = typeof row.rating === 'number' ? row.rating : 0;
        const games = typeof row.games === 'number' ? row.games : 0;
        const ratingUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
        const last = lastEventsByQueue.get(queue);
        const baseTier = computeArenaBaseTier(rating, games);
        const queen = baseTier === '权杖' ? await getQueen(queue) : null;
        const isQueen = queen?.entityType === 'data_card' && queen?.entityId === dataCardId;
        const tier = applyQueenTier(baseTier, isQueen);
        const item: ApiRating = {
          queue,
          rating,
          games,
          wins: typeof row.wins === 'number' ? row.wins : 0,
          losses: typeof row.losses === 'number' ? row.losses : 0,
          draws: typeof row.draws === 'number' ? row.draws : 0,
          tier,
          lastDelta: typeof last?.delta === 'number' ? last.delta : null,
          lastAppliedAt: typeof last?.appliedAt === 'string' ? last.appliedAt : null,
          publicRank: null,
          publicTotal: queue === 'free' ? publicTotals.free : publicTotals.strict,
        };
        if (item.queue === 'strict') ratings.strict = item;
        else ratings.free = item;

        // 仅角色卡计算公共榜位置（不影响公共榜展示）
        if (cardRow.type === 'character' && ratingUpdatedAt) {
          try {
            const strictPublicSinceClause = item.queue === 'strict'
              ? `AND (
                dc.public_since IS NULL
                OR dc.public_since <= datetime('now', '-3 days')
                OR (
                  dc.created_at IS NOT NULL
                  AND dc.public_since IS NOT NULL
                  AND ABS(strftime('%s', dc.public_since) - strftime('%s', dc.created_at)) <= 600
                )
              )`
              : '';
            const rankResult = (await queryFromD1(
              `SELECT COUNT(*) as higherCount
               FROM arena_ratings ar
               LEFT JOIN data_cards dc
                 ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
               WHERE ar.queue = ?
                 AND (
                   ar.entity_type = 'preset'
                   OR (
                     dc.id IS NOT NULL
                     AND dc.type = 'character'
                     AND dc.is_public = 1
                     AND dc.review_status = 'approved'
                     AND dc.deleted_at IS NULL
                     ${strictPublicSinceClause}
                   )
                 )
                 AND (
                   ar.rating > ?
                   OR (ar.rating = ? AND ar.games > ?)
                   OR (ar.rating = ? AND ar.games = ? AND ar.updated_at > ?)
                   OR (
                     ar.rating = ? AND ar.games = ? AND ar.updated_at = ?
                     AND (
                       ar.entity_type < 'data_card'
                       OR (ar.entity_type = 'data_card' AND ar.entity_id < ?)
                     )
                   )
                 )`,
              [
                item.queue,
                item.rating,
                item.rating,
                item.games,
                item.rating,
                item.games,
                ratingUpdatedAt,
                item.rating,
                item.games,
                ratingUpdatedAt,
                dataCardId,
              ],
            )) as any;
            const row = readSingleRow<{ higherCount: number }>(rankResult);
            const higherCount = typeof row?.higherCount === 'number' ? row.higherCount : 0;
            item.publicRank = Math.max(1, Math.floor(higherCount) + 1);
          } catch (error) {
            console.warn('计算公共榜位置失败（降级为 null）:', error);
          }
        }
      }
    } catch (error) {
      console.warn('读取排位失败（降级为 null）:', error);
    }

    return new Response(
      JSON.stringify({
        success: true,
        dataCardId,
        tags,
        metrics,
        ratings,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('读取 data-card-meta 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '无法加载数据卡指标' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
