import type { Metadata } from 'next';

import ReportAppealsPage from '@/components/report-appeals/ReportAppealsPage';

type RouteSearchParams = Record<string, string | string[] | undefined>;

interface ReportAppealsRouteProps {
  searchParams?: Promise<RouteSearchParams>;
}

export const metadata: Metadata = {
  title: '申诉中心 - MahoShojo Generator',
  description: '查看举报申诉历史并提交申诉',
};

const getSearchParamValue = (params: RouteSearchParams, key: string): string | null => {
  const rawValue = params[key];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
};

export default async function ReportAppealsRoute({ searchParams }: ReportAppealsRouteProps) {
  const params = searchParams ? await searchParams : {};

  return (
    <ReportAppealsPage
      query={{
        reportCaseId: getSearchParamValue(params, 'reportCaseId'),
        appealId: getSearchParamValue(params, 'appealId'),
      }}
    />
  );
}
