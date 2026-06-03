import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { incrementPublicDeckLikeCountById } from '@/lib/db/repositories/decks';

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) {
      return new Response(JSON.stringify({ success: false, error: '数据库不可用，请稍后重试' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { deckId, type } = await req.json();

    if (!deckId || type !== 'like') {
      return new Response(JSON.stringify({ success: false, error: '无效的参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const changed = await incrementPublicDeckLikeCountById(db, deckId);
    if (changed <= 0) {
      return new Response(JSON.stringify({ success: false, error: '点赞失败（卡组不存在或不可点赞）' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Increment deck stats error:', error);
    return new Response(JSON.stringify({ success: false, error: '操作失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export default withPagesApiResponse(handler);
