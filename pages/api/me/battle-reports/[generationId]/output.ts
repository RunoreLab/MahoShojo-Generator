import {
  getBattleReportGenerationByIdLite,
  getLargeObjectByOwnerRef,
  isUserInPvpMatch,
} from '@/lib/d1';
import { json, requireAuthUser } from '@/lib/pvp/server';
import { getObjectText } from '@/lib/r2';

export const runtime = 'edge';

const getGenerationIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // /api/me/battle-reports/:generationId/output
    const idx = parts.findIndex((p) => p === 'battle-reports');
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  } catch {
    return null;
  }
};

const guessFormatFromKey = (key: string): 'markdown' | 'json' | null => {
  const k = String(key || '').toLowerCase();
  if (k.endsWith('.md') || k.endsWith('.markdown')) return 'markdown';
  if (k.endsWith('.json')) return 'json';
  return null;
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const generationId = getGenerationIdFromUrl(req.url);
  if (!generationId) return json({ error: '缺少 generationId' }, { status: 400 });

  const record = await getBattleReportGenerationByIdLite(generationId);
  if (!record) return json({ error: '记录不存在' }, { status: 404 });

  const isOwner = record.user_id === auth.user.id;
  const canReadByPvp = record.pvp_match_id ? await isUserInPvpMatch(record.pvp_match_id, auth.user.id) : false;
  if (!isOwner && !canReadByPvp) return json({ error: '记录不存在' }, { status: 404 });

  const lo = await getLargeObjectByOwnerRef('battle_report_generation_output', record.id);
  const key = typeof lo?.r2_key === 'string' ? lo.r2_key : '';
  if (!key) return json({ error: '战报正文未外部化或已清理', code: 'OUTPUT_MISSING' }, { status: 404 });

  const r2 = await getObjectText(key);
  if (!r2.success || !r2.data?.text) {
    return json({ error: '战报正文读取失败，请稍后重试', code: 'OUTPUT_READ_FAILED', detail: r2.error || null }, { status: 502 });
  }

  const contentType = typeof lo?.content_type === 'string' && lo.content_type.trim()
    ? lo.content_type.trim()
    : (guessFormatFromKey(key) === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');

  const headers = new Headers();
  headers.set('content-type', contentType);
  headers.set('cache-control', 'no-store');
  const format = guessFormatFromKey(key);
  if (format) headers.set('x-mahoshojo-output-format', format);

  return new Response(r2.data.text, { status: 200, headers });
}

