import { NextRequest } from 'next/server';
import { getPendingDataCardUpdates } from '@/lib/database/admin';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const items = await getPendingDataCardUpdates();
    return new Response(JSON.stringify({ success: true, updates: items }), { status: 200 });
  } catch (error) {
    console.error('获取更新记录失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取更新记录失败' }), { status: 500 });
  }
}
