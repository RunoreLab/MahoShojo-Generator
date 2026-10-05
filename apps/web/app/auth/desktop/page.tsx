import type { Metadata } from 'next';

import {
  DESKTOP_AUTH_GRANT_PATH,
  DesktopAuthorizeQuerySchema,
} from '@mahoshojo/contracts/desktop-cloud';

import { DesktopAuthorizePage } from '@/components/auth/DesktopAuthorizePage';

export const metadata: Metadata = {
  title: '桌面端授权 - MahoShojo Generator',
  description: '授权 MahoShojo 桌面客户端访问您的账号',
};

type RouteSearchParams = Record<string, string | string[] | undefined>;

interface DesktopAuthorizeRouteProps {
  searchParams?: Promise<RouteSearchParams>;
}

const singleParam = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * `desktop-auth-v1` 授权入口（Server Component）。
 *
 * query 的协议校验在这里完成：loopback schema（含 `127.0.0.1`/`::1` 校验规则）
 * 只进入服务端 bundle——Hosted-DR client-bundle 门禁对浏览器产物 fail-closed，
 * 客户端 chunk 不得携带 loopback 校验实现。Client Component 只接收已规范化的
 * grant 数据与 grant 端点路径这两个普通值。
 */
export default async function DesktopAuthorizeRoute({ searchParams }: DesktopAuthorizeRouteProps) {
  const params = searchParams ? await searchParams : {};
  const flat = {
    state: singleParam(params.state),
    code_challenge: singleParam(params.code_challenge),
    code_challenge_method: singleParam(params.code_challenge_method),
    redirect_uri: singleParam(params.redirect_uri),
  };
  const result = Object.values(flat).some((value) => value === undefined)
    ? null
    : DesktopAuthorizeQuerySchema.safeParse(flat);
  return (
    <DesktopAuthorizePage
      grant={result?.success ? result.data : null}
      grantPath={DESKTOP_AUTH_GRANT_PATH}
    />
  );
}
