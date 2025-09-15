import { getUserByAuthKey, getUserDataCardCapacity } from '@/lib/d1';
import { config } from '@/lib/config';

export const runtime = 'edge';

// 辅助函数：从请求头获取用户认证信息
async function getUserFromAuth(req: Request): Promise<{ id: number; username: string } | null> {
  const authHeader = req.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const authKey = authHeader.substring(7);
  const user = await getUserByAuthKey(authKey);
  
  return user;
}

export default async function handler(req: Request): Promise<Response> {
  // 只支持 GET 请求
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 验证用户身份
  const user = await getUserFromAuth(req);
  if (!user) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 获取用户数据卡容量
    const capacity = await getUserDataCardCapacity(user.id, config.DEFAULT_DATA_CARD_CAPACITY);
    
    return new Response(JSON.stringify({ 
      success: true, 
      capacity 
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