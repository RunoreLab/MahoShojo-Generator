import { useState, type ReactNode } from 'react';

import { encyclopediaCategories, getEncyclopediaCategory } from '../catalog';
import type { EncyclopediaContentSource } from '../content-source';
import { ALL_CATEGORY } from '../filter';
import { EncyclopediaPageFrame } from './EncyclopediaPageFrame';
import { shouldInterceptInternalLinkClick } from './internal-link-click';
import {
  useEncyclopediaFilter,
  useFilteredEncyclopediaEntries,
  type EncyclopediaNavigate,
} from './use-encyclopedia-filter';
import {
  MarkdownBlock,
  slugifyHeading,
  stripLeadingMatchingTitle,
  useHashScrollTarget,
  type InternalLinkRenderProps,
  type ExternalLinkRenderProps,
} from '../../markdown/index';
import { useEncyclopediaContent } from './use-encyclopedia-content';

export interface EncyclopediaEntryViewProps {
  readonly slug: string | undefined;
  readonly contentSource: EncyclopediaContentSource;
  readonly onNavigate: EncyclopediaNavigate;
  /** 渲染 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  readonly resolveInternalHref?: ((href: string) => string) | undefined;
  /**
   * 当前 URL 的 fragment，由宿主注入。
   *
   * 不能由共享层读 `window.location.hash`：Desktop 用 hash history，那个值等于整个 `#/route#anchor`。
   */
  readonly hash?: string | undefined;
  /** 站外链接的打开方式。缺省时站外链接不可执行并说明原因。 */
  readonly onNavigateExternal?: ((href: string) => void) | undefined;
  readonly renderExternalLink?: ((link: ExternalLinkRenderProps) => ReactNode) | undefined;
  /** 站内产品链接的自定义渲染（例如 Next 的 `<Link>`）。 */
  readonly renderInternalLink?: ((link: InternalLinkRenderProps) => ReactNode) | undefined;
  /** 追加在正文之后的宿主面板（例如 Web 的标签库）。 */
  readonly extraPanel?: ReactNode;
  readonly headerLinks?: ReactNode;
}

const entryHref = (slug: string) => `/encyclopedia/${slug}`;

/**
 * 共源百科条目页。
 *
 * ## 外层标题的 slug 必须与被剥离的正文 H1 一致
 *
 * `stripLeadingMatchingTitle` 会把与页面标题相同的首个 H1 剥掉。那条标题的锚点因此**只存在于外层
 * `<h1>` 上**——如果不给它同样的 slug，指向文章标题本身的 deep link 就会凭空消失。所以这里的 slug
 * 来自**目录标题**（产品事实），而不是从正文里现算。
 *
 * 当正文 H1 与目录标题不同时（当前 7 篇），它不会被剥离，于是正文里那个 H1 有自己的 slug，两者共存。
 */
export function EncyclopediaEntryView({
  slug,
  contentSource,
  onNavigate,
  resolveInternalHref,
  hash,
  onNavigateExternal,
  renderExternalLink,
  renderInternalLink,
  extraPanel,
  headerLinks,
}: EncyclopediaEntryViewProps) {
  const { entry, content, loading, error } = useEncyclopediaContent(slug, contentSource);
  const category = entry ? getEncyclopediaCategory(entry.categoryId) : null;

  const titleSlug = entry ? slugifyHeading(entry.title) : '';
  const displayContent = entry ? stripLeadingMatchingTitle({ content, title: entry.title }) : content;

  useHashScrollTarget({ ready: !loading && entry !== null, hash });

  const [mobileNavOpen, setMobileNavOpen] = useState(true);
  const sidebarFilter = useEncyclopediaFilter({ initial: { query: '', categoryId: ALL_CATEGORY } });
  const { entries: navEntries, grouped: groupedNavEntries } = useFilteredEncyclopediaEntries(sidebarFilter);

  const sidebar = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-gray-700">条目</div>
        <a
          href={resolveInternalHref?.('/encyclopedia') ?? '/encyclopedia'}
          onClick={(event) => {
            if (!shouldInterceptInternalLinkClick(event)) return;
            event.preventDefault();
            onNavigate('/encyclopedia');
          }}
          className="text-xs text-blue-600 hover:underline"
        >
          目录
        </a>
      </div>

      <div className="mt-2">
        <input
          type="search"
          value={sidebarFilter.query}
          onChange={(event) => sidebarFilter.setQuery(event.target.value)}
          placeholder="搜索条目…"
          aria-label="在百科条目间搜索"
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
        />
        {sidebarFilter.query.trim() ? (
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>匹配 {navEntries.length} 篇</span>
            <button
              type="button"
              onClick={() => sidebarFilter.setQuery('')}
              className="rounded-md px-2 py-1 text-gray-600 hover:bg-gray-50"
            >
              清除
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {groupedNavEntries.categoriesWithEntries.map(({ category: navCategory, entries }) => {
          const open = Boolean(sidebarFilter.query.trim()) || entry?.categoryId === navCategory.id;
          return (
            <details key={navCategory.id} open={open} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 truncate">{navCategory.title}</span>
                <span className="shrink-0 text-xs text-gray-400 group-open:text-gray-500">{entries.length}</span>
              </summary>
              <div className="mt-1 space-y-1 pl-1">
                {entries.map((item) => (
                  <a
                    key={item.slug}
                    href={resolveInternalHref?.(entryHref(item.slug)) ?? entryHref(item.slug)}
                    onClick={(event) => {
                      if (!shouldInterceptInternalLinkClick(event)) return;
                      event.preventDefault();
                      onNavigate(entryHref(item.slug));
                    }}
                    aria-current={item.slug === entry?.slug ? 'page' : undefined}
                    className={`block rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      item.slug === entry?.slug
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.title}
                  </a>
                ))}
              </div>
            </details>
          );
        })}

        {groupedNavEntries.uncategorized.length > 0 ? (
          <details open={Boolean(sidebarFilter.query.trim())} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">未分类</span>
              <span className="shrink-0 text-xs text-gray-400">{groupedNavEntries.uncategorized.length}</span>
            </summary>
            <div className="mt-1 space-y-1 pl-1">
              {groupedNavEntries.uncategorized.map((item) => (
                <a
                  key={item.slug}
                  href={resolveInternalHref?.(entryHref(item.slug)) ?? entryHref(item.slug)}
                  onClick={(event) => {
                    if (!shouldInterceptInternalLinkClick(event)) return;
                    event.preventDefault();
                    onNavigate(entryHref(item.slug));
                  }}
                  className={`block rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    item.slug === entry?.slug ? 'bg-purple-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {item.title}
                </a>
              ))}
            </div>
          </details>
        ) : null}

        {navEntries.length === 0 ? (
          <div className="text-xs text-gray-500">没有匹配条目。</div>
        ) : null}
      </div>
    </>
  );

  return (
    <EncyclopediaPageFrame
      header={
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {/* 这个 id 让「指向文章标题本身」的 deep link 在正文 H1 被剥离后仍然有效。 */}
              <h1 id={titleSlug || undefined} className="truncate text-xl font-bold text-gray-900">
                {entry?.title ?? '未找到条目'}
              </h1>
              <a
                href={resolveInternalHref?.('/encyclopedia') ?? '/encyclopedia'}
                onClick={(event) => {
                  if (!shouldInterceptInternalLinkClick(event)) return;
                  event.preventDefault();
                  onNavigate('/encyclopedia');
                }}
                className="text-sm text-blue-600 hover:underline"
              >
                返回百科目录
              </a>
            </div>
            {entry?.summary ? <div className="mt-1 text-sm text-gray-600">{entry.summary}</div> : null}
            {category ? (
              <div className="mt-2">
                <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-purple-100">
                  分类：{category.title}
                </span>
              </div>
            ) : null}
          </div>
          {headerLinks ? <div className="flex items-center gap-4 text-sm">{headerLinks}</div> : null}
        </div>
      }
    >
      <section data-testid="encyclopedia-entry">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          <nav className="lg:hidden">
            {/* `open` 必须由状态控制：非受控写法里用户收起后任意重渲染都会把它重新展开。 */}
            <details
              open={mobileNavOpen}
              onToggle={(event) => setMobileNavOpen(event.currentTarget.open)}
              className="rounded-xl border border-gray-200 bg-white p-3"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-gray-800 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 truncate">条目目录</span>
                <span className="text-xs font-normal text-gray-500">{entry ? '切换条目' : '请选择条目'}</span>
              </summary>
              <div className="mt-3">{sidebar}</div>
              <div className="mt-2 text-xs text-gray-500">
                小技巧：用上方搜索可快速定位；切换条目后会回到页面顶部，方便从头阅读。
              </div>
            </details>
          </nav>

          <aside className="hidden shrink-0 lg:block lg:w-72">
            <div className="sticky top-6 rounded-xl border border-gray-200 bg-white p-3">{sidebar}</div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-3xl">
              {loading ? (
                <div role="status" className="text-sm text-gray-500">
                  正在加载内容…
                </div>
              ) : error ? (
                <div role="alert" className="text-sm text-red-600">
                  加载失败：{error}
                </div>
              ) : entry ? (
                <>
                  <MarkdownBlock
                    content={displayContent}
                    variant="light"
                    mode="article"
                    headingIds="github"
                    reservedHeadingIds={[titleSlug]}
                    onNavigateInternal={onNavigate}
                    {...(resolveInternalHref ? { resolveInternalHref } : {})}
                    {...(onNavigateExternal ? { onNavigateExternal } : {})}
                    {...(renderExternalLink ? { renderExternalLink } : {})}
                    {...(renderInternalLink ? { renderInternalLink } : {})}
                  />
                  {extraPanel}
                </>
              ) : (
                <div className="text-sm text-gray-600">该百科条目不存在，可能是链接已过期或版本尚未同步。</div>
              )}
            </div>
          </main>
        </div>
      </section>
    </EncyclopediaPageFrame>
  );
}

/** 目录页里按 slug 过滤的推荐位所需的全部分类，供宿主复用同一份筛选语义。 */
export const encyclopediaCategoryList = encyclopediaCategories;
