'use client';

import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';

import { parseEncyclopediaFilter, type EncyclopediaContentSource } from '@mahoshojo/ui-web/encyclopedia';
import { EncyclopediaIndexView } from '@mahoshojo/ui-web/encyclopedia-views';
import Link from 'next/link';

/**
 * Web 的百科正文服务根。
 *
 * 宿主事实，不是产品事实（`D3.0-1`）：Web 由 `public/` 提供正文，因此是 origin 根；Desktop 的同一个
 * 值由 Tauri 自定义协议提供，两者不共享这一处的常量。
 */
export const WEB_ENCYCLOPEDIA_CONTENT_SOURCE: EncyclopediaContentSource = { baseUrl: '/' };

/** 目录页把筛选状态写回 URL，从而让 `?q=&c=` 可分享。 */
export const useWebEncyclopediaNavigate = () => {
  const router = useRouter();
  return (href: string) => {
    // `scroll: false` 是既有行为：切换筛选不应该把页面滚回顶部，用户往往正在比对结果。
    void router.push(href, { scroll: false });
  };
};

export function WebEncyclopediaHeaderLinks() {
  return (
    <>
      <Link href="/" className="text-blue-600 hover:underline">
        返回首页
      </Link>
      <Link href="/arena" className="text-blue-600 hover:underline">
        竞技场
      </Link>
      <Link href="/ranking" className="text-blue-600 hover:underline">
        排行榜
      </Link>
    </>
  );
}

export function WebEncyclopediaIndex() {
  const searchParams = useSearchParams();
  const initial = parseEncyclopediaFilter(searchParams?.toString() ?? null);

  return (
    <EncyclopediaIndexView
      onNavigate={useWebEncyclopediaNavigate()}
      path="/encyclopedia"
      initialQuery={initial.query}
      initialCategoryId={initial.categoryId}
      headerLinks={<WebEncyclopediaHeaderLinks />}
    />
  );
}