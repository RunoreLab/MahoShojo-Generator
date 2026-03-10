// 生产分支约束：
// 本文件仅供本地脚本与 GitHub Actions 复用趋势纯函数，
// 不得在生产分支通过线上页面或线上 API 暴露任何 admin 入口。
export type AnalyticsDateKey = `${number}-${number}-${number}`;

export type DailyTrendAccumulator = {
  newUsers?: number;
  generationTotal?: number;
  generationCompleted?: number;
  generationAborted?: number;
  generationFailed?: number;
  generationDistinctUsers?: number;
  authSuccess?: number;
  authFailure?: number;
};

export type AdminUserAnalyticsTrendPoint = {
  date: AnalyticsDateKey;
  newUsers: number;
  newUsers7dAvg: number;
  totalUsers: number;
  generationTotal: number;
  generationCompleted: number;
  generationAborted: number;
  generationFailed: number;
  generationDistinctUsers: number;
  authSuccess: number;
  authFailure: number;
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const formatUtcDateKey = (date: Date): AnalyticsDateKey => {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  return `${year}-${month}-${day}` as AnalyticsDateKey;
};

export const buildUtcDateKeys = (lookbackDays: number, endDate = new Date()): AnalyticsDateKey[] => {
  const safeLookbackDays = Number.isFinite(lookbackDays) ? Math.max(1, Math.floor(lookbackDays)) : 30;
  const endUtc = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  const dates: AnalyticsDateKey[] = [];
  for (let offset = safeLookbackDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(endUtc);
    date.setUTCDate(endUtc.getUTCDate() - offset);
    dates.push(formatUtcDateKey(date));
  }
  return dates;
};

export const computeTrailingAverage = (values: number[], windowSize: number): number[] => {
  const safeWindowSize = Number.isFinite(windowSize) ? Math.max(1, Math.floor(windowSize)) : 7;
  const result: number[] = [];
  let sum = 0;

  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] ?? 0;
    if (index >= safeWindowSize) {
      sum -= values[index - safeWindowSize] ?? 0;
    }
    const divisor = Math.min(index + 1, safeWindowSize);
    result.push(divisor > 0 ? Number((sum / divisor).toFixed(2)) : 0);
  }

  return result;
};

export const buildTrendPoints = (
  dates: AnalyticsDateKey[],
  baseTotalUsers: number,
  byDate: Record<string, DailyTrendAccumulator>,
): AdminUserAnalyticsTrendPoint[] => {
  const newUsersSeries = dates.map((date) => byDate[date]?.newUsers ?? 0);
  const averages = computeTrailingAverage(newUsersSeries, 7);
  let runningTotalUsers = Number.isFinite(baseTotalUsers) ? Math.max(0, Math.floor(baseTotalUsers)) : 0;

  return dates.map((date, index) => {
    const daily = byDate[date] ?? {};
    runningTotalUsers += daily.newUsers ?? 0;

    return {
      date,
      newUsers: daily.newUsers ?? 0,
      newUsers7dAvg: averages[index] ?? 0,
      totalUsers: runningTotalUsers,
      generationTotal: daily.generationTotal ?? 0,
      generationCompleted: daily.generationCompleted ?? 0,
      generationAborted: daily.generationAborted ?? 0,
      generationFailed: daily.generationFailed ?? 0,
      generationDistinctUsers: daily.generationDistinctUsers ?? 0,
      authSuccess: daily.authSuccess ?? 0,
      authFailure: daily.authFailure ?? 0,
    };
  });
};
