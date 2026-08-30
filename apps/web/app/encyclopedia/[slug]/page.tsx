import type { Metadata } from 'next';

import { EncyclopediaEntryPage } from '@/components/encyclopedia/EncyclopediaEntryPage';
import { encyclopediaEntries, getEncyclopediaEntry } from '@/lib/encyclopedia';

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

  return <EncyclopediaEntryPage slug={getSlugFromParams(resolvedParams)} />;
}
