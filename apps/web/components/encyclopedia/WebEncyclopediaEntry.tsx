'use client';

import Link from 'next/link';

import { EncyclopediaEntryView } from '@mahoshojo/ui-web/encyclopedia-views';
import type { InternalLinkRenderProps } from '@mahoshojo/ui-web/markdown';

import { useLocationHash } from '@/lib/use-location-hash';

import { TagsLibraryPanel } from './TagsLibraryPanel';
import {
  WEB_ENCYCLOPEDIA_CONTENT_SOURCE,
  useWebEncyclopediaNavigate,
  WebEncyclopediaHeaderLinks,
} from './WebEncyclopediaViews';

/**
 * Web 的百科条目页包装。
 *
 * 页面视图是共享实现；本文件只提供 Web 侧的三样事实：路由、正文服务根，以及站内链接用 `<Link>`
 * 渲染以拿到客户端路由（正文里有大量站内互链，整页加载会让每次跳转都重新拉起整个应用壳）。
 */

const renderInternalLink = ({ href, title, className, children }: InternalLinkRenderProps) => (
  <Link href={href} title={title} className={className} prefetch={false}>
    {children}
  </Link>
);

export function WebEncyclopediaEntry({ slug }: { slug?: string }) {
  const hash = useLocationHash();

  return (
    <EncyclopediaEntryView
      slug={slug}
      contentSource={WEB_ENCYCLOPEDIA_CONTENT_SOURCE}
      onNavigate={useWebEncyclopediaNavigate()}
      hash={hash}
      renderInternalLink={renderInternalLink}
      extraPanel={slug === 'tags' ? <TagsLibraryPanel /> : null}
      headerLinks={<WebEncyclopediaHeaderLinks />}
    />
  );
}