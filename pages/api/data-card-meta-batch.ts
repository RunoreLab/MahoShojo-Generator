import type { NextRequest } from 'next/server';

import { getUserByAuthKey, queryFromD1 } from '@/lib/d1';
import { getDataCardMetricsByIds, upsertDataCardMetrics } from '@/lib/database/data-card-metrics';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { verifySignature } from '@/lib/signature';
import { applyQueenTier, computeArenaBaseTier, queryArenaPublicQueenEntity } from '@/lib/arena/tier';

export const config = {
  runtime: 'edge',
};

type Queue = 'strict';

type ApiMetrics = {
  techScore: number;
  techLevel: string;
};

type ApiStrictRating = {
  tier: string;
};

type ApiMetaBatchItem = {
  metrics: ApiMetrics | null;
  strict: ApiStrictRating | null;
};

type ApiResponse =
  | { success: true; items: Record<string, ApiMetaBatchItem> }
  | { success: false; error: string };

const uniq = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

const readRows = <T,>(result: any): T[] => {
  const rows = result?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' } satisfies ApiResponse), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const requestedIds = uniq(Array.isArray(payload?.dataCardIds) ? payload.dataCardIds : []);
  if (requestedIds.length === 0) {
    return new Response(JSON.stringify({ success: true, items: {} } satisfies ApiResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (requestedIds.length > 50) {
    return new Response(JSON.stringify({ success: false, error: 'dataCardIds 数量过多（最多 50）' } satisfies ApiResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const authKey = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  const authUser = authKey ? await getUserByAuthKey(authKey) : null;
  const authUserId = typeof (authUser as any)?.id === 'number' ? (authUser as any).id : null;

  const items: Record<string, ApiMetaBatchItem> = Object.fromEntries(
    requestedIds.map((id) => [id, { metrics: null, strict: null }]),
  );

  const placeholders = requestedIds.map(() => '?').join(', ');
  const cardRows = readRows<{
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
       WHERE id IN (${placeholders})
         AND deleted_at IS NULL`,
      requestedIds,
    ),
  );

  const accessible = cardRows.filter((row) => {
    const isPublicReadable = row.is_public === 1 && row.review_status === 'approved';
    if (isPublicReadable) return true;
    return authUserId != null && row.user_id === authUserId;
  });

  if (accessible.length === 0) {
    return new Response(JSON.stringify({ success: true, items } satisfies ApiResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const accessibleIds = accessible.map((row) => row.id);
  const metricsMap = await getDataCardMetricsByIds(accessibleIds);

  const upsertPromises: Promise<unknown>[] = [];
  const hasSignatureKey = Boolean(process.env.SIGNATURE_SECRET_KEY);

  for (const row of accessible) {
    const existing = metricsMap.get(row.id);
    if (existing && existing.data_card_updated_at === row.updated_at) {
      items[row.id] = {
        metrics: {
          techScore: existing.tech_score,
          techLevel: existing.tech_level,
        },
        strict: null,
      };
      continue;
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.data) as unknown;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      continue;
    }

    try {
      const tech = computeTechIndex(parsed);
      const isNative = hasSignatureKey ? await verifySignature(parsed as any) : null;

      items[row.id] = {
        metrics: {
          techScore: tech.techScore,
          techLevel: tech.techLevel,
        },
        strict: null,
      };

      upsertPromises.push(
        upsertDataCardMetrics({
          dataCardId: row.id,
          techScore: tech.techScore,
          techLevel: tech.techLevel,
          isNative,
          dataCardUpdatedAt: row.updated_at,
          detailsJson: {
            raw: tech.raw,
            derived: tech.derived,
            components: tech.components,
            notes: tech.notes,
          },
        }),
      );
    } catch (error) {
      console.warn('批量计算技术值失败（降级为 null）:', { dataCardId: row.id, error });
    }
  }

  const strictPlaceholders = accessibleIds.map(() => '?').join(', ');
  try {
    const strictQueen = await queryArenaPublicQueenEntity(queryFromD1, 'strict').catch((error) => {
      console.warn('读取女王段位失败（降级为无女王）:', error);
      return null;
    });

    const strictRows = readRows<{
      entity_id: string;
      rating: number;
      games: number;
      queue: Queue;
    }>(
      await queryFromD1(
        `SELECT entity_id, rating, games, queue
         FROM arena_ratings
         WHERE entity_type = 'data_card'
           AND queue = 'strict'
           AND entity_id IN (${strictPlaceholders})`,
        accessibleIds,
      ),
    );

    const strictTierById = new Map<string, string>();
    for (const row of strictRows) {
      if (!row?.entity_id) continue;
      const rating = typeof row.rating === 'number' ? row.rating : 0;
      const games = typeof row.games === 'number' ? row.games : 0;
      const baseTier = computeArenaBaseTier(rating, games);
      const isQueen = strictQueen?.entityType === 'data_card' && strictQueen?.entityId === row.entity_id;
      strictTierById.set(row.entity_id, applyQueenTier(baseTier, isQueen));
    }

    for (const row of accessible) {
      const tier = strictTierById.get(row.id) ?? null;
      if (!tier) continue;
      items[row.id] = {
        metrics: items[row.id]?.metrics ?? null,
        strict: { tier },
      };
    }
  } catch (error) {
    console.warn('批量读取严格排位段位失败（降级为 null）:', error);
  }

  const executionContext = (req as any).context;
  if (executionContext?.waitUntil && upsertPromises.length > 0) {
    for (const promise of upsertPromises) {
      executionContext.waitUntil(promise);
    }
  } else if (upsertPromises.length > 0) {
    await Promise.allSettled(upsertPromises);
  }

  return new Response(JSON.stringify({ success: true, items } satisfies ApiResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
