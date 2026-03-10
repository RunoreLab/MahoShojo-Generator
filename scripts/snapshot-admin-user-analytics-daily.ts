#!/usr/bin/env bun

import { loadEnvConfig } from '@next/env';

import {
  collectAdminUserAnalyticsDailySnapshot,
  recordAdminUserAnalyticsDailySnapshot,
} from '@/lib/database/admin-user-analytics';

const hasD1Config = (): boolean => {
  return Boolean(process.env.D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
};

const hasFlag = (flag: string): boolean => {
  return process.argv.slice(2).includes(flag);
};

async function main() {
  loadEnvConfig(process.cwd(), true);

  if (!hasD1Config()) {
    throw new Error('缺少 Cloudflare D1 配置：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  }

  const dryRun = hasFlag('--dry-run');
  const snapshotAt = new Date();

  if (dryRun) {
    const snapshot = await collectAdminUserAnalyticsDailySnapshot(snapshotAt);
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          metricDate: snapshot.metricDate,
          capturedAtUtc: snapshot.updatedAt,
          trackedUsers: snapshot.trackedUsers,
          activeUsers7d: snapshot.activeUsers7d,
          coverageRate: snapshot.activityCoverageRate,
          frequencyTrendLookbackDays: snapshot.frequencyTrendLookbackDays,
          highPlusShareActive7d: snapshot.highPlusShareActive7d,
        },
        null,
        2,
      ),
    );
    return;
  }

  const snapshot = await recordAdminUserAnalyticsDailySnapshot(snapshotAt);
  console.log(
    JSON.stringify(
      {
        success: true,
        metricDate: snapshot.metricDate,
        capturedAtUtc: snapshot.updatedAt,
        trackedUsers: snapshot.trackedUsers,
        activeUsers24h: snapshot.activeUsers24h,
        activeUsers7d: snapshot.activeUsers7d,
        activeUsers30d: snapshot.activeUsers30d,
        coverageRate: snapshot.activityCoverageRate,
        frequencyTrendLookbackDays: snapshot.frequencyTrendLookbackDays,
        highPlusShareActive7d: snapshot.highPlusShareActive7d,
        highPlusShareTracked: snapshot.highPlusShareTracked,
        highPlusShareAll: snapshot.highPlusShareAll,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[snapshot-admin-user-analytics-daily] 执行失败:', error);
  process.exitCode = 1;
});
