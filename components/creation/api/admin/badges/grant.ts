import { queryFromD1, grantBadgeToUser } from '@/lib/d1';

export const runtime = 'edge';

/**
 * 管理员授予徽章 API
 * POST - 授予徽章给单个用户或多个用户
 *
 * 请求体格式:
 * - 单个用户: { badgeId: string, userId: number }
 * - 多个用户: { badgeId: string, userIds: number[] }
 * - 用户名查询: { badgeId: string, usernames: string[] }
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
    const { badgeId, userId, userIds, usernames } = body;

    if (!badgeId) {
      return new Response(
        JSON.stringify({ error: '缺少徽章ID' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 检查徽章是否存在
    const badgeQuery = await queryFromD1('SELECT id FROM badges WHERE id = ?', [badgeId]) as any;
    const badgeResults = badgeQuery.success ? badgeQuery.result[0]?.results || [] : [];
    if (!badgeResults || badgeResults.length === 0) {
      return new Response(
        JSON.stringify({ error: '徽章不存在' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let targetUserIds: number[] = [];

    // 单个用户ID
    if (userId !== undefined) {
      targetUserIds = [Number(userId)];
    }
    // 多个用户ID
    else if (userIds && Array.isArray(userIds)) {
      targetUserIds = userIds.map(id => Number(id));
    }
    // 用户名列表
    else if (usernames && Array.isArray(usernames)) {
      const placeholders = usernames.map(() => '?').join(',');
      const query = await queryFromD1(
        `SELECT id FROM users WHERE username IN (${placeholders})`,
        usernames
      ) as any;

      const results = query.success ? query.result[0]?.results || [] : [];
      targetUserIds = results.map((row: any) => row.id);

      if (targetUserIds.length === 0) {
        return new Response(
          JSON.stringify({ error: '未找到匹配的用户' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    else {
      return new Response(
        JSON.stringify({ error: '必须提供 userId、userIds 或 usernames' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 批量授予徽章
    const results = {
      success: 0,
      failed: 0,
      alreadyOwned: 0,
      errors: [] as string[]
    };

    for (const uid of targetUserIds) {
      try {
        // 检查用户是否已拥有该徽章
        const existingQuery = await queryFromD1(
          'SELECT id FROM user_badges WHERE user_id = ? AND badge_id = ?',
          [uid, badgeId]
        ) as any;

        const existingResults = existingQuery.success ? existingQuery.result[0]?.results || [] : [];
        if (existingResults && existingResults.length > 0) {
          results.alreadyOwned++;
          continue;
        }

        // 授予徽章
        const granted = await grantBadgeToUser(uid, badgeId);
        if (granted) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`用户 ${uid} 授予失败`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`用户 ${uid}: ${error}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `授予完成：成功 ${results.success}，已拥有 ${results.alreadyOwned}，失败 ${results.failed}`,
        results
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('授予徽章失败:', error);
    return new Response(JSON.stringify({ error: '授予徽章失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
