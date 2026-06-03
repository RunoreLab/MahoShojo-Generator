import type { Metadata } from 'next';

import { PasswordRecoveryPage } from '@/components/auth/PasswordRecoveryPage';

type RouteSearchParams = Record<string, string | string[] | undefined>;

interface PasswordRecoveryRouteProps {
  searchParams?: Promise<RouteSearchParams>;
}

const getTokenFromSearchParams = (params: RouteSearchParams): string => {
  const rawToken = params.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  return token?.trim() ?? '';
};

export async function generateMetadata({ searchParams }: PasswordRecoveryRouteProps): Promise<Metadata> {
  const params = searchParams ? await searchParams : {};
  const isResetMode = getTokenFromSearchParams(params).length > 0;

  return {
    title: `${isResetMode ? '设置新密码' : '找回密码'} - MahoShojo Generator`,
    description: '通过注册邮箱找回账号密码或设置新密码',
  };
}

export default async function PasswordRecoveryRoute({ searchParams }: PasswordRecoveryRouteProps) {
  const params = searchParams ? await searchParams : {};

  return <PasswordRecoveryPage resetToken={getTokenFromSearchParams(params)} />;
}
