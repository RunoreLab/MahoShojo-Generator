import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import { getRequestUrl } from '@/lib/request-url';
import { readDataCardListPage } from '@/lib/data-card-list-page';
import { readDataCardSummaryQuery } from '@/lib/data-card-summary-query';
import { listDataCardSummaries } from '@/lib/db/repositories/data-card-summaries';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  addFavorite,
  removeFavorite,
  getUserFavorites,
  getUserFavoriteIds
} from '@/lib/database/favorites';
import { requireAuthUser } from '@/lib/auth/server';

async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) {
    const authPayload = await auth.response.clone().json().catch(() => null);
    const authError = typeof (authPayload as { error?: unknown } | null)?.error === 'string'
      ? ((authPayload as { error?: string }).error ?? '未授权')
      : '未授权';
    return new Response(JSON.stringify({ success: false, error: authError }), {
      status: auth.response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (req.method === 'GET') {
      const url = getRequestUrl(req);
      const type = url.searchParams.get('type') as OnlineDataCardType | null;
      const idsOnly = url.searchParams.get('idsOnly') === '1';

      if (!idsOnly && url.searchParams.get('view') === 'summary') {
        const query = readDataCardSummaryQuery(url.searchParams);
        if (!query) return Response.json({ success: false, error: '无效的列表查询参数' }, { status: 400 });
        const db = getDrizzleDbFromRuntime();
        if (!db) throw new Error('数据卡存储不可用');
        const started = Date.now();
        const result = await listDataCardSummaries(db, auth.user.id, 'favorites', query);
        console.info('data-card-list', { source: 'favorites', summary: true, limit: query.limit, offset: query.offset, count: result.cards.length, durationMs: Date.now() - started, status: 200 });
        return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
      }

      if (idsOnly) {
        const favorites = await getUserFavoriteIds(auth.user.id, type ?? undefined);
        return new Response(JSON.stringify({ success: true, favorites }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const page = readDataCardListPage(url.searchParams);
      if (!page) return Response.json({ success: false, error: '无效的分页参数' }, { status: 400 });
      const rows = await getUserFavorites(auth.user.id, type ?? undefined, { ...page, limit: page.limit + 1 });
      const favorites = rows.slice(0, page.limit);
      const nextOffset = rows.length > page.limit ? page.offset + page.limit : null;
      return new Response(JSON.stringify({ success: true, favorites, nextOffset }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
      });
    }

    if (req.method === 'POST') {
      const { cardId } = await req.json();
      if (!cardId) {
        return new Response(JSON.stringify({ success: false, error: '缺少卡片ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await addFavorite(auth.user.id, cardId);

      if (result.notFound) {
        return new Response(JSON.stringify({ success: false, error: '卡片不存在或不可收藏' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        alreadyExists: result.alreadyExists === true
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (req.method === 'DELETE') {
      const body = await req.json().catch(() => null);
      const cardId = body?.cardId;

      if (!cardId) {
        return new Response(JSON.stringify({ success: false, error: '缺少卡片ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await removeFavorite(auth.user.id, cardId);

      if (result.notFound) {
        return new Response(JSON.stringify({ success: false, error: '收藏不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('favorites-request-failed', { method: req.method, status: 500, category: error instanceof Error ? error.name : 'unknown' });
    return new Response(JSON.stringify({ success: false, error: '服务器错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
