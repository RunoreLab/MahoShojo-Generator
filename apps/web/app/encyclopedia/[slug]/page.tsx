import type { Metadata } from 'next';

import { WebEncyclopediaEntry } from '@/components/encyclopedia/WebEncyclopediaEntry';
import { encyclopediaEntries, getEncyclopediaEntry } from '@mahoshojo/ui-web/encyclopedia';

/**
 * 百科条目路由。
 *
 * 这里只剩 Next 特有的东西：`metadata` 与 `generateStaticParams`。页面视图是 `@mahoshojo/ui-web/encyclopedia`
 * 的共享实现，Desktop 读同一份——`DESK-PROD-002` 要求两端回用同一实现，而不是共享包留一份、
 * Web 另留一份。
 */

type RouteParams = {
  slug?: string | string[];
};

interface EncyclopediaEntryRouteProps {
  params?: Promise<RouteParams>;
}

const getSlugFromParams = (params: RouteParams): string | undefined => {
  const rawSlug = params.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  return slug?.trim() || undefined;
};

export async function generateMetadata({ params }: EncyclopediaEntryRouteProps): Promise<Metadata> {
  const resolvedParams = params ? await params : {};
  const entry = getEncyclopediaEntry(getSlugFromParams(resolvedParams));

  return {
    title: entry ? `${entry.title} - 百科` : '百科 - MahoShojo Generator',
    description: entry?.summary ?? '查看站内百科条目',
  };
}

export function generateStaticParams() {
  return encyclopediaEntries.map((entry) => ({
    slug: entry.slug,
  }));
}

export default async function EncyclopediaEntryRoute({ params }: EncyclopediaEntryRouteProps) {
  const resolvedParams = params ? await params : {};

  return <WebEncyclopediaEntry slug={getSlugFromParams(resolvedParams)} />;
}