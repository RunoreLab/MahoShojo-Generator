import type { Metadata } from 'next';

import { BetaAccessPage } from '@/components/beta-access/BetaAccessPage';

type RouteSearchParams = Record<string, string | string[] | undefined>;

interface BetaAccessRouteProps {
  searchParams?: Promise<RouteSearchParams>;
}

export const metadata: Metadata = {
  title: '权限拦截 - 魔法国度',
  description: '内测功能权限拦截页',
};

const getSearchParamValue = (params: RouteSearchParams, key: string): string | null => {
  const rawValue = params[key];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
};

export default async function BetaAccessRoute({ searchParams }: BetaAccessRouteProps) {
  const params = searchParams ? await searchParams : {};

  return <BetaAccessPage rawFeature={getSearchParamValue(params, 'feature')} />;
}
