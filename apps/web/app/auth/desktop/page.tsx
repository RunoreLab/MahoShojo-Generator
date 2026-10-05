import type { Metadata } from 'next';

import { DesktopAuthorizePage } from '@/components/auth/DesktopAuthorizePage';

export const metadata: Metadata = {
  title: '桌面端授权 - MahoShojo Generator',
  description: '授权 MahoShojo 桌面客户端访问您的账号',
};

type RouteSearchParams = Record<string, string | string[] | undefined>;

interface DesktopAuthorizeRouteProps {
  searchParams?: Promise<RouteSearchParams>;
}

export default async function DesktopAuthorizeRoute({ searchParams }: DesktopAuthorizeRouteProps) {
  const params = searchParams ? await searchParams : {};
  return <DesktopAuthorizePage query={params} />;
}
