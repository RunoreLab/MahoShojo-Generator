// pages/api/admin/export-data-cards.ts

import { getDataForExport } from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  // 根据您的要求，此阶段暂不进行管理员身份验证

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { cardIds } = await req.json();

    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      return new Response(JSON.stringify({ success: false, error: '缺少必要参数: cardIds' }), { status: 400 });
    }

    const dataToExport = await getDataForExport(cardIds);

    return new Response(JSON.stringify({ success: true, data: dataToExport }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin API - 导出数据失败:', error);
    return new Response(JSON.stringify({ success: false, error: '导出数据失败' }), { status: 500 });
  }
}