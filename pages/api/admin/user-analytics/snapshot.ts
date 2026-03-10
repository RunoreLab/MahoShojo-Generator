import type { NextRequest } from 'next/server';

import { createRequestAuthUserResolver } from '@/lib/auth/request-auth-user';
import {
  collectAdminUserAnalyticsDailySnapshot,
  recordAdminUserAnalyticsDailySnapshot,
} from '@/lib/database/admin-user-analytics';

export const runtime = 'edge';

const SNAPSHOT_TOKEN_HEADER = 'x-admin-user-analytics-snapshot-token';

const getSnapshotTokenFromEnv = (): string => {
  const token = process.env.ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN;
  return typeof token === 'string' ? token.trim() : '';
};

const isAdminUser = async (req: Request): Promise<boolean> => {
  const user = await createRequestAuthUserResolver(req).getUser();
  return Boolean(user && user.is_admin === 1);
};

const isValidSnapshotToken = (req: Request): boolean => {
  const expected = getSnapshotTokenFromEnv();
  if (!expected) return false;
  const provided = req.headers.get(SNAPSHOT_TOKEN_HEADER)?.trim() ?? '';
  return provided.length > 0 && provided === expected;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), { status: 405 });
  }

  const allowedByToken = isValidSnapshotToken(req);
  const allowedByAdmin = allowedByToken ? false : await isAdminUser(req);
  if (!allowedByToken && !allowedByAdmin) {
    return new Response(JSON.stringify({ success: false, error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  try {
    const snapshot = dryRun
      ? await collectAdminUserAnalyticsDailySnapshot(new Date())
      : await recordAdminUserAnalyticsDailySnapshot(new Date());

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        trigger: allowedByToken ? 'token' : 'admin-session',
        snapshot,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('[Admin API] 用户统计日快照执行失败:', error);
    return new Response(
      JSON.stringify({ success: false, error: '用户统计日快照执行失败' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
