import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { resolveDataCardStatsActor } from '@/lib/data-card-stats/actor';
import { acquireDataCardStatsRateLimit } from '@/lib/data-card-stats/rate-limit';
import { recordDataCardStatInteraction } from '@/lib/data-card-stats/service';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import type { DataCardInteractionEventType } from '@/lib/db/schema';

type DataCardStatsHandlerDeps = {
  getDb?: () => AppDrizzleDb | null;
  resolveActor?: typeof resolveDataCardStatsActor;
  acquireRateLimit?: typeof acquireDataCardStatsRateLimit;
  recordInteraction?: typeof recordDataCardStatInteraction;
  now?: () => Date;
};

const json = (payload: unknown, status = 200, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });

const normalizeEventType = (value: unknown): DataCardInteractionEventType | null =>
  value === 'like' || value === 'usage' ? value : null;

export const createDataCardStatsHandler = (deps: DataCardStatsHandlerDeps = {}) => async (
  req: Request,
): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const db = (deps.getDb ?? getDrizzleDbFromRuntime)();
    if (!db) {
      return json({
        success: false,
        error: '数据库不可用，请稍后重试',
      }, 503);
    }

    const body = await req.json().catch(() => null);
    const cardId = typeof body?.cardId === 'string' ? body.cardId.trim() : '';
    const eventType = normalizeEventType(body?.type);

    if (!cardId || !eventType) {
      return json({
        success: false,
        error: '无效的参数',
      }, 400);
    }

    const actor = await (deps.resolveActor ?? resolveDataCardStatsActor)(req);
    const now = (deps.now ?? (() => new Date()))();
    const rateLimit = (deps.acquireRateLimit ?? acquireDataCardStatsRateLimit)({
      actorScope: actor.actorScope,
      actorKeyHash: actor.actorKeyHash,
      nowMs: now.getTime(),
    });
    if (!rateLimit.allowed) {
      return json({
        success: false,
        error: `请求过于频繁，请在 ${rateLimit.retryAfterSeconds} 秒后重试`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      }, 429, {
        'Retry-After': String(rateLimit.retryAfterSeconds),
      });
    }

    const nowIso = now.toISOString();
    const result = await (deps.recordInteraction ?? recordDataCardStatInteraction)(db, {
      dataCardId: cardId,
      eventType,
      actorScope: actor.actorScope,
      actorKeyHash: actor.actorKeyHash,
      nowIso,
    });

    if (!result.success) {
      return json({
        success: false,
        error: '卡片不存在或不可操作',
      }, 400);
    }

    return json({
      success: true,
      alreadyExists: result.alreadyExists,
    });

  } catch (error) {
    console.error('Increment data card stats error:', error);
    return json({
      success: false,
      error: '操作失败',
    }, 500);
  }
};

export const appRouteHandler = createDataCardStatsHandler();
export default appRouteHandler;
