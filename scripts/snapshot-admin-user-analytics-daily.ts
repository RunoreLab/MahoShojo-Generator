#!/usr/bin/env bun

// 生产分支约束：
// 本脚本仅允许本地运维或 GitHub Actions 调用，
// 不得被包装成线上页面、线上 API 或其他公网可访问入口。
import { loadEnvConfig } from '@next/env';

import {
  backfillAdminUserAnalyticsDailySnapshots,
  collectAdminUserAnalyticsDailySnapshot,
  recordAdminUserAnalyticsDailySnapshot,
} from '@/lib/database/admin-user-analytics';
import { normalizeAdminUserAnalyticsMetricDate } from '@/lib/admin/user-analytics-daily';

const hasD1Config = (): boolean => {
  return Boolean(process.env.D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
};

const hasFlag = (flag: string): boolean => {
  return process.argv.slice(2).includes(flag);
};

const readArgValue = (flag: string): string => {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  if (index < 0) return '';
  return String(args[index + 1] ?? '').trim();
};

const parsePositiveIntegerArg = (flag: string): number | undefined => {
  const raw = readArgValue(flag);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} 需要正整数`);
  }
  return parsed;
};

async function main() {
  loadEnvConfig(process.cwd(), true);

  if (!hasD1Config()) {
    throw new Error('缺少 Cloudflare D1 配置：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  }

  const dryRun = hasFlag('--dry-run');
  const backfillDays = parsePositiveIntegerArg('--backfill-days');
  const metricDateArg = readArgValue('--metric-date');
  if (metricDateArg && !normalizeAdminUserAnalyticsMetricDate(metricDateArg)) {
    throw new Error(`--metric-date 非法：${metricDateArg}`);
  }
  if (metricDateArg) {
    throw new Error('生产分支禁止通过 --metric-date 回放或补写历史 admin 快照');
  }
  const skipCurrent = hasFlag('--skip-current');
  const snapshotAt = new Date();

  const backfill = backfillDays
    ? await backfillAdminUserAnalyticsDailySnapshots({
        lookbackDays: backfillDays,
        dryRun,
      })
    : null;

  if (skipCurrent) {
    console.log(
      JSON.stringify(
        {
          success: true,
          dryRun,
          currentSnapshotSkipped: true,
          backfill,
        },
        null,
        2,
      ),
    );
    return;
  }

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
          backfill,
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
        backfill,
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
