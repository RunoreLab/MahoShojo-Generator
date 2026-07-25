import { queryFromD1, revokeBadgeFromUser } from '@/lib/d1';

export const runtime = 'edge';

/**
 * 管理员撤销徽章 API
 * POST - 从单个用户或多个用户撤销徽章
 *
 * 请求体格式:
 * - 单个用户: { badgeId: string, userId: number }
 * - 多个用户: { badgeId: string, userIds: number[] }
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { badgeId, userId, userIds } = body;

    if (!badgeId) {
      return new Response(
        JSON.stringify({ error: '缺少徽章ID' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let targetUserIds: number[] = [];

    if (userId !== undefined) {
      targetUserIds = [Number(userId)];
    } else if (userIds && Array.isArray(userIds)) {
      targetUserIds = userIds.map(id => Number(id));
    } else {
      return new Response(
        JSON.stringify({ error: '必须提供 userId 或 userIds' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 批量撤销徽章
    const results = {
      success: 0,
      failed: 0,
      notOwned: 0,
      errors: [] as string[]
    };

    for (const uid of targetUserIds) {
      try {
        // 检查用户是否拥有该徽章
        const existingQuery = await queryFromD1(
          'SELECT id FROM user_badges WHERE user_id = ? AND badge_id = ?',
          [uid, badgeId]
        ) as any;

        const existingResults = existingQuery.success ? existingQuery.result[0]?.results || [] : [];
        if (!existingResults || existingResults.length === 0) {
          results.notOwned++;
          continue;
        }

        // 撤销徽章
        const revoked = await revokeBadgeFromUser(uid, badgeId);
        if (revoked) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`用户 ${uid} 撤销失败`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`用户 ${uid}: ${error}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `撤销完成：成功 ${results.success}，未拥有 ${results.notOwned}，失败 ${results.failed}`,
        results
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('撤销徽章失败:', error);
    return new Response(JSON.stringify({ error: '撤销徽章失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
