#!/usr/bin/env node

import nextEnv from '@next/env';

const SNAPSHOT_TOKEN_HEADER = 'x-admin-user-analytics-snapshot-token';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
const METRIC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toErrorMessage = (error) => {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
};

const parseArgs = (argv) => {
  const args = {
    url: '',
    token: '',
    dryRun: false,
    metricDate: '',
    backfillDays: 0,
    skipCurrent: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: DEFAULT_RETRIES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--url':
        args.url = String(argv[index + 1] ?? '').trim();
        index += 1;
        break;
      case '--token':
        args.token = String(argv[index + 1] ?? '').trim();
        index += 1;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--metric-date':
        args.metricDate = String(argv[index + 1] ?? '').trim();
        index += 1;
        break;
      case '--backfill-days':
        args.backfillDays = parsePositiveInteger(argv[index + 1], 0);
        index += 1;
        break;
      case '--skip-current':
        args.skipCurrent = true;
        break;
      case '--help':
        console.log(`用法：
  node scripts/trigger-admin-user-analytics-snapshot.mjs [--dry-run] [--metric-date <YYYY-MM-DD>] [--backfill-days <n>] [--skip-current] [--url <url>] [--token <token>] [--timeout-ms <ms>] [--retries <n>]

环境变量：
  ADMIN_USER_ANALYTICS_SNAPSHOT_URL
  ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN`);
        process.exit(0);
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInteger(argv[index + 1], DEFAULT_TIMEOUT_MS);
        index += 1;
        break;
      case '--retries':
        args.retries = parsePositiveInteger(argv[index + 1], DEFAULT_RETRIES);
        index += 1;
        break;
      default:
        throw new Error(`未知参数：${token}`);
    }
  }

  if (!args.url) {
    args.url = String(process.env.ADMIN_USER_ANALYTICS_SNAPSHOT_URL ?? '').trim();
  }
  if (!args.token) {
    args.token = String(process.env.ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN ?? '').trim();
  }

  if (!args.url) {
    throw new Error('缺少快照 URL，请提供 --url 或环境变量 ADMIN_USER_ANALYTICS_SNAPSHOT_URL');
  }
  if (!args.token) {
    throw new Error('缺少快照 token，请提供 --token 或环境变量 ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN');
  }
  if (args.metricDate && !METRIC_DATE_PATTERN.test(args.metricDate)) {
    throw new Error(`metricDate 非法：${args.metricDate}`);
  }

  return args;
};

const buildSnapshotUrl = (rawUrl, args) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`快照 URL 非法：${rawUrl}`);
  }

  if (args.dryRun) {
    url.searchParams.set('dryRun', '1');
  } else {
    url.searchParams.delete('dryRun');
  }
  if (args.metricDate) {
    url.searchParams.set('metricDate', args.metricDate);
  } else {
    url.searchParams.delete('metricDate');
  }
  if (args.backfillDays > 0) {
    url.searchParams.set('backfillDays', String(args.backfillDays));
  } else {
    url.searchParams.delete('backfillDays');
  }
  if (args.skipCurrent) {
    url.searchParams.set('includeCurrent', '0');
  } else {
    url.searchParams.delete('includeCurrent');
  }

  return url;
};

const requestSnapshot = async ({ url, token, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        [SNAPSHOT_TOKEN_HEADER]: token,
      },
      signal: controller.signal,
    });

    const rawText = await response.text();
    let payload = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const detail =
        (payload && typeof payload === 'object' && typeof payload.error === 'string' && payload.error) || rawText || response.statusText;
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('响应不是合法 JSON');
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const url = buildSnapshotUrl(args.url, args);

  let lastError = null;
  for (let attempt = 1; attempt <= args.retries; attempt += 1) {
    try {
      const payload = await requestSnapshot({
        url: url.toString(),
        token: args.token,
        timeoutMs: args.timeoutMs,
      });

      console.log(
        JSON.stringify(
          {
            success: true,
            requestedAtUtc: new Date().toISOString(),
            attempt,
            url: url.toString(),
            dryRun: Boolean(payload.dryRun),
            trigger: typeof payload.trigger === 'string' ? payload.trigger : 'token',
            metricDate:
              payload.snapshot && typeof payload.snapshot === 'object' && typeof payload.snapshot.metricDate === 'string'
                ? payload.snapshot.metricDate
                : null,
            updatedAt:
              payload.snapshot && typeof payload.snapshot === 'object' && typeof payload.snapshot.updatedAt === 'string'
                ? payload.snapshot.updatedAt
                : null,
            backfill:
              payload.backfill && typeof payload.backfill === 'object'
                ? {
                    lookbackDays:
                      typeof payload.backfill.lookbackDays === 'number' ? payload.backfill.lookbackDays : null,
                    endMetricDate:
                      typeof payload.backfill.endMetricDate === 'string' ? payload.backfill.endMetricDate : null,
                    missingDates: Array.isArray(payload.backfill.missingDates) ? payload.backfill.missingDates : [],
                    writtenDates: Array.isArray(payload.backfill.writtenDates) ? payload.backfill.writtenDates : [],
                  }
                : null,
          },
          null,
          2,
        ),
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= args.retries) break;
      await sleep(Math.min(5_000, attempt * 1_000));
    }
  }

  throw new Error(`触发用户统计日快照失败：${toErrorMessage(lastError)}`);
};

run().catch((error) => {
  console.error('[trigger-admin-user-analytics-snapshot] 执行失败:', toErrorMessage(error));
  process.exitCode = 1;
});
