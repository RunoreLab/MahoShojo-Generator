import type { NextRequest } from 'next/server';

import {
  ADMIN_USER_ANALYTICS_SNAPSHOT_BACKFILL_MAX_DAYS,
  normalizeAdminUserAnalyticsMetricDate,
} from '@/lib/admin/user-analytics-daily';
import {
  backfillAdminUserAnalyticsDailySnapshots,
  collectAdminUserAnalyticsDailySnapshot,
  recordAdminUserAnalyticsDailySnapshot,
} from '@/lib/database/admin-user-analytics';

export const runtime = 'edge';

const SNAPSHOT_TOKEN_HEADER = 'x-admin-user-analytics-snapshot-token';

const getSnapshotTokenFromEnv = (): string => {
  const token = process.env.ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN;
  return typeof token === 'string' ? token.trim() : '';
};

const isValidSnapshotToken = (req: Request): boolean => {
  const expected = getSnapshotTokenFromEnv();
  if (!expected) return false;
  const provided = req.headers.get(SNAPSHOT_TOKEN_HEADER)?.trim() ?? '';
  return provided.length > 0 && provided === expected;
};

const parseBackfillDays = (value: string | null): number => {
  const parsed = Number.parseInt((value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(1, Math.min(ADMIN_USER_ANALYTICS_SNAPSHOT_BACKFILL_MAX_DAYS, parsed));
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), { status: 405 });
  }

  // feat/admin 分支当前仅在管理员本地部署，管理接口默认不做鉴权。
  // 保留 token 检测仅用于标记触发来源，避免影响现有外部调度调用。
  const allowedByToken = isValidSnapshotToken(req);

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const rawMetricDate = url.searchParams.get('metricDate');
  const metricDate = rawMetricDate ? normalizeAdminUserAnalyticsMetricDate(rawMetricDate) : null;
  if (rawMetricDate && !metricDate) {
    return new Response(JSON.stringify({ success: false, error: 'metricDate 非法，必须为 YYYY-MM-DD' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const includeCurrent = metricDate ? true : url.searchParams.get('includeCurrent') !== '0';
  const backfillDays = parseBackfillDays(url.searchParams.get('backfillDays'));
  if (!includeCurrent && backfillDays <= 0) {
    return new Response(JSON.stringify({ success: false, error: '未指定任何快照操作' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const backfill = backfillDays > 0
      ? await backfillAdminUserAnalyticsDailySnapshots({
          lookbackDays: backfillDays,
          dryRun,
        })
      : null;
    const snapshot = includeCurrent
      ? dryRun
        ? await collectAdminUserAnalyticsDailySnapshot(new Date(), metricDate ? { metricDate } : undefined)
        : await recordAdminUserAnalyticsDailySnapshot(new Date(), metricDate ? { metricDate } : undefined)
      : null;

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        trigger: allowedByToken ? 'token' : 'open-admin',
        snapshot,
        backfill,
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
