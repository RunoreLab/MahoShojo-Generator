'use client';

import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import { use } from 'react';

const COMPONENT_MAP: Record<string, React.ComponentType> = {
  'users': dynamic(() => import('@/components/creation/admin/users'), { ssr: false }),
  'user-dashboard': dynamic(() => import('@/components/creation/admin/users'), { ssr: false }),
  'user-management': dynamic(() => import('@/components/creation/admin/users'), { ssr: false }),
  'user-analytics': dynamic(() => import('@/components/creation/admin/user-analytics'), { ssr: false }),
  'redemption-codes': dynamic(() => import('@/components/creation/admin/redemption-codes'), { ssr: false }),
  'badge-management': dynamic(() => import('@/components/creation/admin/badge-management'), { ssr: false }),
  'content-management': dynamic(() => import('@/components/creation/admin/content-management'), { ssr: false }),
  'character-management': dynamic(() => import('@/components/creation/admin/character-management'), { ssr: false }),
  'tag-management': dynamic(() => import('@/components/creation/admin/tag-management'), { ssr: false }),
  'messages': dynamic(() => import('@/components/creation/admin/messages'), { ssr: false }),
  'report-cases': dynamic(() => import('@/components/creation/admin/report-cases'), { ssr: false }),
  'report-appeals': dynamic(() => import('@/components/creation/admin/report-appeals'), { ssr: false }),
  'crowd-review/inspectors': dynamic(() => import('@/components/creation/admin/crowd-review/inspectors'), { ssr: false }),
  'crowd-review/cases': dynamic(() => import('@/components/creation/admin/crowd-review/cases'), { ssr: false }),
  'arena-ratings': dynamic(() => import('@/components/creation/admin/arena-ratings'), { ssr: false }),
  'arena-rating-events': dynamic(() => import('@/components/creation/admin/arena-rating-events'), { ssr: false }),
  'arena-risk-audit': dynamic(() => import('@/components/creation/admin/arena-risk-audit'), { ssr: false }),
  'battle-report-generations': dynamic(() => import('@/components/creation/admin/battle-report-generations'), { ssr: false }),
  'pvp': dynamic(() => import('@/components/creation/admin/pvp'), { ssr: false }),
  'large-objects': dynamic(() => import('@/components/creation/admin/large-objects'), { ssr: false }),
  'data-maintenance': dynamic(() => import('@/components/creation/admin/data-maintenance'), { ssr: false }),
  'ai-channel-availability': dynamic(() => import('@/components/creation/admin/ai-channel-availability'), { ssr: false }),
};

function AdminSlugContent({ slug }: { slug: string }) {
  const Component = COMPONENT_MAP[slug];
  if (!Component) {
    notFound();
  }
  return <Component />;
}

export default function AdminSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = use(params);
  const slugPath = slug.join('/');
  return <AdminSlugContent key={slugPath} slug={slugPath} />;
}
