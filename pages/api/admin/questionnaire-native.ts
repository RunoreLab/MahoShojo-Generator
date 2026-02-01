import type { NextRequest } from 'next/server';
import { queryFromD1 } from '@/lib/database/core';
import { getDataCardById } from '@/lib/database/data-cards';

export const runtime = 'experimental-edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const payload = await req.json();
    const dataCardId = typeof payload?.dataCardId === 'string' ? payload.dataCardId.trim() : '';
    const nativeAllowed = Boolean(payload?.nativeAllowed);

    if (!dataCardId) {
      return new Response(JSON.stringify({ success: false, error: '缺少 dataCardId' }), { status: 400 });
    }

    const card = await getDataCardById(dataCardId, false);
    if (!card) {
      return new Response(JSON.stringify({ success: false, error: '数据卡不存在' }), { status: 404 });
    }
    if (card.type !== 'questionnaire') {
      return new Response(JSON.stringify({ success: false, error: '仅支持问卷数据卡' }), { status: 400 });
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = typeof card.data === 'string' ? (JSON.parse(card.data) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') {
      return new Response(JSON.stringify({ success: false, error: '问卷数据格式异常' }), { status: 400 });
    }

    const nextData = { ...parsed, nativeAllowed };
    const dataString = JSON.stringify(nextData);
    const result = await queryFromD1(
      'UPDATE data_cards SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [dataString, dataCardId]
    ) as any;

    const changes = result?.result?.[0]?.meta?.changes ?? 0;
    if (!changes) {
      return new Response(JSON.stringify({ success: false, error: '更新失败' }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, data: dataString }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('更新问卷原生许可失败:', error);
    return new Response(JSON.stringify({ success: false, error: '更新失败' }), { status: 500 });
  }
}
