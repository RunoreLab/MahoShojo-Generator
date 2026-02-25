import { getUserDataCardCapacity, getUserUsedSlots } from '@/lib/d1';
import { requireAuthUser } from '@/lib/auth/server';
import { config } from '@/lib/config';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  // 只支持 GET 请求
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 验证用户身份
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  try {
    // 获取用户数据卡容量
    const [capacity, usedSlots] = await Promise.all([
      getUserDataCardCapacity(auth.user.id, config.DEFAULT_DATA_CARD_CAPACITY),
      getUserUsedSlots(auth.user.id)
    ]);
    
    return new Response(JSON.stringify({ 
      success: true, 
      capacity,
      usedSlots
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get user capacity error:', error);
    return new Response(JSON.stringify({ error: '获取用户容量失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
