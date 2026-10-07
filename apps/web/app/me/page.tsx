import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { MeRouteProviders } from '@/components/me/MeRouteProviders';

export const metadata: Metadata = {
  title: '个人页 - MahoShojo Generator',
  description: '查看战报记录与个人设置',
};

/**
 * `/me` 旧深链兼容（DESK-SET-001 / D5.1-S1-r1）——服务端早截获：
 *
 * - `?token=<t>` → `/password-recovery?token=<t>`：恢复令牌是敏感参数，
 *   必须在 `/me` 文档渲染前跳走；放进客户端 `useEffect` 会让 `/me` 完整
 *   生命周期（TopBar、公告等同源子请求）带着 token 跑一遍，默认
 *   `strict-origin-when-cross-origin` 下同源请求的 Referer 会携带 query。
 *   token 只交给既有密码恢复 handler，优先级高于 tab 兼容。
 * - `?tab=settings` → `/settings?section=account`（设置已迁往 `/settings`）。
 * - `?tab=reports` 已是默认内容，留在原地即可。
 */
type RouteSearchParams = Record<string, string | string[] | undefined>;

const firstParam = (value: string | string[] | undefined): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
};

export default async function MeRoute({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  const params = searchParams ? await searchParams : {};

  const token = firstParam(params.token);
  if (token) {
    redirect(`/password-recovery?token=${encodeURIComponent(token)}`);
  }
  if (firstParam(params.tab) === 'settings') {
    redirect('/settings?section=account');
  }

  return (
    <Suspense fallback={null}>
      <MeRouteProviders />
    </Suspense>
  );
}
