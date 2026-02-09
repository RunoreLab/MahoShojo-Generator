export type CohortGranularity = 'week' | 'month';

export type CohortDisplayMeta = {
  keyWithDateRange: string;
  periodZh: string;
  dateRange: string;
};

const formatDateToIso = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getCohortGranularityZhLabel = (granularity: CohortGranularity): string => (
  granularity === 'week' ? '注册周 Cohort' : '注册月 Cohort'
);

export const buildCohortDisplayMeta = (granularity: CohortGranularity, cohortKey: string): CohortDisplayMeta => {
  const fallback: CohortDisplayMeta = {
    keyWithDateRange: cohortKey,
    periodZh: cohortKey,
    dateRange: '-',
  };

  if (granularity === 'month') {
    const monthMatch = cohortKey.match(/^(\d{4})-(\d{2})$/);
    if (!monthMatch) return fallback;

    const year = Number.parseInt(monthMatch[1], 10);
    const month = Number.parseInt(monthMatch[2], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return fallback;

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const dateRange = `${formatDateToIso(monthStart)} ~ ${formatDateToIso(monthEnd)}`;

    return {
      keyWithDateRange: `${cohortKey}（${dateRange}）`,
      periodZh: `${year} 年 ${month} 月`,
      dateRange,
    };
  }

  const weekMatch = cohortKey.match(/^(\d{4})-W(\d{2})$/);
  if (!weekMatch) return fallback;

  const year = Number.parseInt(weekMatch[1], 10);
  const weekNumber = Number.parseInt(weekMatch[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(weekNumber) || weekNumber < 0 || weekNumber > 53) return fallback;

  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Weekday = jan1.getUTCDay();
  const firstMondayOffsetDays = (8 - jan1Weekday) % 7;
  const firstMonday = new Date(Date.UTC(year, 0, 1 + firstMondayOffsetDays));

  let weekStart: Date;
  let weekEnd: Date;

  if (weekNumber === 0) {
    weekStart = jan1;
    weekEnd = firstMondayOffsetDays === 0
      ? jan1
      : new Date(firstMonday.getTime() - 24 * 60 * 60 * 1000);
  } else {
    weekStart = new Date(firstMonday.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);
    weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  }

  const dateRange = `${formatDateToIso(weekStart)} ~ ${formatDateToIso(weekEnd)}`;
  const periodZh = weekNumber === 0
    ? `${year} 年第 0 周（年初残周）`
    : `${year} 年第 ${weekNumber} 周`;

  return {
    keyWithDateRange: `${cohortKey}（${dateRange}）`,
    periodZh,
    dateRange,
  };
};
