import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getRequestUrl } from '@/lib/request-url';
import type { NextRequest } from 'next/server';

import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  listArenaEntityRatingHistory,
  type ArenaEntityRatingHistoryRow,
  type ArenaReadEntityType,
  type ArenaReadQueue,
} from '@/lib/db/repositories/arena-read';

type ApiSuccessResponse = {
  success: true;
  entityType: ArenaReadEntityType;
  entityId: string;
  queue: 'strict';
  items: ArenaEntityRatingHistoryRow[];
};

type ApiErrorResponse = {
  success: false;
  error: string;
};

type HandlerDeps = {
  getDb: () => unknown;
  listArenaEntityRatingHistory: (
    db: unknown,
    input: {
      entityType: ArenaReadEntityType;
      entityId: string;
      queue: ArenaReadQueue;
      limit: number;
    },
  ) => Promise<ArenaEntityRatingHistoryRow[]>;
};

const jsonResponse = (body: ApiSuccessResponse | ApiErrorResponse, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const parseEntityType = (value: string | null): ArenaReadEntityType | null => {
  if (value === 'data_card' || value === 'preset') return value;
  return null;
};

export const createEntityRatingHistoryHandler = (deps: HandlerDeps) => async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') {
    return jsonResponse({ success: false, error: 'Method Not Allowed' }, 405);
  }

  try {
    const url = getRequestUrl(req);
    const entityType = parseEntityType(url.searchParams.get('entityType'));
    const entityId = (url.searchParams.get('entityId') ?? '').trim();
    const queue = url.searchParams.get('queue') === 'free' ? 'free' : 'strict';

    if (!entityType || !entityId) {
      return jsonResponse({ success: false, error: '缺少参数：entityType/entityId' }, 400);
    }

    if (queue !== 'strict') {
      return jsonResponse({ success: false, error: '第一版仅支持 strict 队列' }, 400);
    }

    const db = deps.getDb();
    if (!db) {
      return jsonResponse({ success: false, error: '数据库绑定不可用，请检查 Cloudflare D1 配置' }, 503);
    }

    const items = await deps.listArenaEntityRatingHistory(db, {
      entityType,
      entityId,
      queue: 'strict',
      limit: 10,
    });

    return jsonResponse({
      success: true,
      entityType,
      entityId,
      queue: 'strict',
      items,
    });
  } catch (error) {
    console.error('读取实体严格排位历史失败:', error);
    return jsonResponse({ success: false, error: '无法加载最近严格排位记录' }, 500);
  }
};

const handler = createEntityRatingHistoryHandler({
  getDb: getDrizzleDbFromRuntime,
  listArenaEntityRatingHistory: listArenaEntityRatingHistory as HandlerDeps['listArenaEntityRatingHistory'],
});

async function entityRatingHistoryHandler(req: NextRequest): Promise<Response> {
  return handler(req);
}

export default withPagesApiResponse(entityRatingHistoryHandler);
