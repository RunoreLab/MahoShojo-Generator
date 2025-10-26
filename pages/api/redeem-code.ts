import { getUserByAuthKey, increaseUserSlotCount, grantBadgeToUser, userHasBadge } from '@/lib/d1';
import { validateAndConsumeRedemptionCode } from '@/lib/database/redemption-codes';

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
  // 只支持 POST 请求
  if (req.method !== 'POST') {
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
    const { code } = await req.json();

    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: '兑换码不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 验证并消费兑换码
    const { valid, slotCount } = await validateAndConsumeRedemptionCode(code.trim());

    if (!valid) {
      return new Response(JSON.stringify({ error: '兑换码无效或已被使用' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 增加用户槽位
    const success = await increaseUserSlotCount(user.id, slotCount);

    if (!success) {
      return new Response(JSON.stringify({ error: '兑换失败，请稍后重试' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!(await userHasBadge(user.id, 'sponsor'))) {
      const badgeGranted = await grantBadgeToUser(user.id, 'sponsor');
      if (!badgeGranted) {
        return new Response(JSON.stringify({ error: '兑换成功但徽章发放失败，请联系管理员处理' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `兑换成功！获得 ${slotCount} 个槽位`,
      slotCount
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Redeem code error:', error);
    return new Response(JSON.stringify({ error: '兑换失败，请稍后重试' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
