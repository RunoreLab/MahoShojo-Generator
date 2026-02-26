import { requireAuthUser } from '@/lib/auth/server';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { countUserBadgesByBadgeId, insertUserBadgeIgnore } from '@/lib/db/repositories/badges';
import { increaseBusinessUserSlotCountById } from '@/lib/db/repositories/business-users';
import { consumeRedemptionCode } from '@/lib/db/repositories/redemption-codes';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  // 只支持 POST 请求
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 验证用户身份
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  try {
    const { code } = await req.json();

    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: '兑换码不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDrizzleDbFromRuntime();
    if (!db) {
      return new Response(JSON.stringify({ error: '数据库不可用，请稍后重试' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const normalizedCode = code.trim();
    let slotCount = 0;
    let invalidCode = false;

    // 用事务保证：消费兑换码、增加槽位、授予赞助徽章必须原子提交，避免“码已消费但发放失败”
    await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as AppDrizzleDb;
      const consumed = await consumeRedemptionCode(tx, normalizedCode);
      if (!consumed) {
        invalidCode = true;
        return;
      }

      slotCount = Math.max(0, Math.floor(consumed.slot_count));
      const updatedRows = await increaseBusinessUserSlotCountById(tx, auth.user.id, slotCount);
      if (updatedRows <= 0) {
        throw new Error('兑换失败：更新用户槽位时未命中记录');
      }

      const hasSponsorBadge = (await countUserBadgesByBadgeId(tx, auth.user.id, 'sponsor')) > 0;
      if (!hasSponsorBadge) {
        await insertUserBadgeIgnore(tx, auth.user.id, 'sponsor');
      }
    });

    if (invalidCode) {
      return new Response(JSON.stringify({ error: '兑换码无效或已被使用' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
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
