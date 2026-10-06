'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  encyclopediaEntries,
  parseEncyclopediaFilter,
  type EncyclopediaContentSource,
} from '@mahoshojo/ui-web/encyclopedia';
import {
  EncyclopediaIndexView,
  type EncyclopediaNavigate,
} from '@mahoshojo/ui-web/encyclopedia-views';

/**
 * Web 的百科正文服务根。
 *
 * 宿主事实，不是产品事实（`D3.0-1`）：Web 由 `public/` 提供正文，因此是 origin 根；Desktop 的同一个
 * 值由 Tauri 自定义协议提供，两者不共享这一处的常量。
 */
export const WEB_ENCYCLOPEDIA_CONTENT_SOURCE: EncyclopediaContentSource = { baseUrl: '/' };

/** Web 百科的目录简介：站内事实（条目数与投稿入口），由共享视图的 `subtitle` 注入。 */
const WEB_INDEX_SUBTITLE = `${encyclopediaEntries.length} 篇条目 · 涵盖使用说明 / 规则 / 进阶等内容，助你更好地了解和使用本站功能。如有补充，欢迎提交 PR 或反馈投稿！`;

/**
 * 目录页把筛选状态写回 URL，从而让 `?q=&c=` 可分享。
 *
 * 滚动语义按用途拆开：`preserveScroll` 只用于筛选写回——用户输入搜索词时当然不应滚回顶部；
 * 其余调用是「进入另一页」（条目、目录往返），保持默认 scroll 行为回到页面顶部，恢复共源前
 * `<Link>` 的语义。
 */
export const useWebEncyclopediaNavigate = (): EncyclopediaNavigate => {
  const router = useRouter();
  return (href, options) => {
    if (options?.replace === true) {
      if (options?.preserveScroll === true) void router.replace(href, { scroll: false });
      else void router.replace(href);
      return;
    }
    if (options?.preserveScroll === true) void router.push(href, { scroll: false });
    else void router.push(href);
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
      subtitle={WEB_INDEX_SUBTITLE}
      headerLinks={<WebEncyclopediaHeaderLinks />}
    />
  );
}
