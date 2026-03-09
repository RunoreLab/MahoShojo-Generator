import type { NextRequest } from 'next/server';

import { getAdminArenaRiskAudit } from '@/lib/database/admin-arena-risk-audit';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await getAdminArenaRiskAudit();
    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin arena-risk-audit 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '无法加载 strict 风控审计数据' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
