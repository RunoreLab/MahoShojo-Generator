import type { NextRequest } from 'next/server';

import { getAdminPvpOverview, listAdminPvpActiveRooms, listAdminPvpRecentMatches } from '@/lib/database/admin-pvp';

export const runtime = 'edge';

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const [overview, activeRooms, recentMatches] = await Promise.all([
      getAdminPvpOverview(),
      listAdminPvpActiveRooms(12),
      listAdminPvpRecentMatches(12),
    ]);

    return new Response(JSON.stringify({ success: true, overview, activeRooms, recentMatches }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Admin API] 获取 PVP 后台数据失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取 PVP 后台数据失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
