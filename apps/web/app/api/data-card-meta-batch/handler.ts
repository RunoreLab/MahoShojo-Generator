import type { NextRequest } from 'next/server';

import { getAuthUser } from '@/lib/auth/server';
import { applyQueenTier, computeArenaBaseTier } from '@/lib/arena/tier';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  getDataCardMetaCardsByIds,
  getDataCardMetricsByDataCardIds,
  getStrictArenaRatingsByDataCardIds,
  queryArenaPublicQueenEntityByQueue,
} from '@/lib/db/repositories/data-card-meta';
import { upsertDataCardMetrics } from '@/lib/database/data-card-metrics';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { verifySignature } from '@/lib/signature';

type ApiMetrics = {
  techScore: number;
  techLevel: string;
  isNative: boolean | null;
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

const json = (payload: ApiResponse, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method Not Allowed' }, 405);
  }

  const db = getDrizzleDbFromRuntime();
  if (!db) {
    return json({ success: false, error: '数据库绑定不可用，请检查 Cloudflare D1 配置' }, 503);
  }

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const requestedIds = uniq(Array.isArray(payload?.dataCardIds) ? payload.dataCardIds : []);
  if (requestedIds.length === 0) {
    return json({ success: true, items: {} });
  }

  if (requestedIds.length > 50) {
    return json({ success: false, error: 'dataCardIds 数量过多（最多 50）' }, 400);
  }

  const authUserId = (await getAuthUser(req))?.user.id ?? null;
  const items: Record<string, ApiMetaBatchItem> = Object.fromEntries(
    requestedIds.map((id) => [id, { metrics: null, strict: null }]),
  );

  const cardRows = await getDataCardMetaCardsByIds(db, requestedIds);
  const accessible = cardRows.filter((row) => {
    const isPublicReadable = row.isPublic && row.reviewStatus === 'approved';
    if (isPublicReadable) return true;
    return authUserId != null && row.userId === authUserId;
  });

  if (accessible.length === 0) {
    return json({ success: true, items });
  }

  const accessibleIds = accessible.map((row) => row.id);
  const metricsMap = await getDataCardMetricsByDataCardIds(db, accessibleIds);
  const upsertPromises: Promise<unknown>[] = [];
  const hasSignatureKey = Boolean(process.env.SIGNATURE_SECRET_KEY);

  for (const row of accessible) {
    const cardUpdatedAt = row.updatedAt ?? new Date().toISOString();
    const existing = metricsMap.get(row.id);
    if (existing && existing.dataCardUpdatedAt === cardUpdatedAt) {
      items[row.id] = {
        metrics: {
          techScore: existing.techScore,
          techLevel: existing.techLevel,
          isNative: existing.isNative,
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

    if (!parsed) continue;

    try {
      const tech = computeTechIndex(parsed);
      const isNative = hasSignatureKey ? await verifySignature(parsed as any) : null;
      items[row.id] = {
        metrics: {
          techScore: tech.techScore,
          techLevel: tech.techLevel,
          isNative,
        },
        strict: null,
      };

      upsertPromises.push(
        upsertDataCardMetrics({
          dataCardId: row.id,
          techScore: tech.techScore,
          techLevel: tech.techLevel,
          isNative,
          dataCardUpdatedAt: cardUpdatedAt,
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

  try {
    const strictQueen = await queryArenaPublicQueenEntityByQueue(db, 'strict').catch((error) => {
      console.warn('读取女王段位失败（降级为无女王）:', error);
      return null;
    });

    const strictRows = await getStrictArenaRatingsByDataCardIds(db, accessibleIds);
    const strictTierById = new Map<string, string>();
    for (const row of strictRows) {
      const rating = typeof row.rating === 'number' ? row.rating : 0;
      const games = typeof row.games === 'number' ? row.games : 0;
      const baseTier = computeArenaBaseTier(rating, games);
      const isQueen = strictQueen?.entityType === 'data_card' && strictQueen?.entityId === row.dataCardId;
      strictTierById.set(row.dataCardId, applyQueenTier(baseTier, isQueen));
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

  return json({ success: true, items });
}

export const appRouteHandler = handler;
export default appRouteHandler;
