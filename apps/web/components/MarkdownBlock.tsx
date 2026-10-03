'use client';

import Link from 'next/link';

import {
  MarkdownBlock as SharedMarkdownBlock,
  type ExternalMediaPolicy,
  type InternalLinkRenderProps,
  type MarkdownBlockProps,
  type MarkdownPlugin,
} from '@mahoshojo/ui-web/markdown';

import remarkBattleTable from '@/lib/markdown/remarkBattleTable';
import { webExternalMediaPolicy } from '@/lib/markdown/externalMedia';

/**
 * Web 的 Markdown 包装。
 *
 * 它是 `DESK-PROD-002` 要求的「Web 回用同一实现」的具体形态：本文件**不再持有任何渲染逻辑**，
 * 只提供三样宿主事实——竞技场领域插件、外部媒体策略（白名单 + 网易云等地址知识），以及站内/站外
 * 链接的接法。删掉这个包装里的任何一行，剩下的仍然是 Desktop 也在跑的那份共享实现。
 *
 * ## 领域插件为什么留在这里
 *
 * `remarkBattleTable` 把战报里的对局表格语法翻译成 mdast 表格。它是竞技场领域知识：百科不需要它，
 * 而让 Desktop 的百科页依赖它会让 `ui-web` 变成倾倒包（`packages/README.md`）。因此共享层把它留成
 * 注入点，由本文件按既有顺序插在 GFM 与数学公式之间。
 *
 * ## 站内链接走 `next/link`
 *
 * 共享实现默认渲染普通 `<a>`，正文里的站内链接因此是整页加载。这里换成 `<Link>`：百科正文与战报正文
 * 里有大量站内互链，整页加载会让每次跳转都重新拉起整个应用壳。用 `renderInternalLink` 而不是
 * `onNavigateInternal` + `useRouter()`，是因为后者会让本组件在 App Router 之外无法渲染——
 * 而 `/encyclopedia/[slug]` 是 SSG 预渲染的，测试里也直接 `renderToStaticMarkup`，两者都不在
 * Router 上下文里。
 */

const WEB_REMARK_PLUGINS: readonly MarkdownPlugin[] = [remarkBattleTable];

const renderInternalLink = ({ href, title, className, children }: InternalLinkRenderProps) => (
  <Link href={href} title={title} className={className} prefetch={false}>
    {children}
  </Link>
);

export type {
  MarkdownBlockMode,
  MarkdownBlockProps,
  MarkdownBlockVariant,
} from '@mahoshojo/ui-web/markdown';

export function MarkdownBlock(props: MarkdownBlockProps) {
  return (
    <SharedMarkdownBlock
      {...props}
      renderInternalLink={renderInternalLink}
      externalMediaPolicy={webExternalMediaPolicy satisfies ExternalMediaPolicy}
      remarkPlugins={WEB_REMARK_PLUGINS}
    />
  );
}