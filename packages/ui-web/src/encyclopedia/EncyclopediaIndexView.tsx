import type { ReactNode } from 'react';

import { encyclopediaCategories } from './catalog';
import {
  ALL_CATEGORY,
  useEncyclopediaFilter,
  useFilteredEncyclopediaEntries,
  type EncyclopediaCategoryFilter,
} from './filter';

export interface EncyclopediaIndexViewProps {
  /** 条目链接的目标。Web 交给 Next router，Desktop 交给 hash router。 */
  readonly onNavigate: (href: string) => void;
  /** 当前页面的基础路径，用于把筛选状态写回 URL。缺省时筛选只改本地状态。 */
  readonly path?: string;
  readonly initialQuery?: string;
  readonly initialCategoryId?: EncyclopediaCategoryFilter;
  /** 渲染在顶部导航区的返回链接。缺省时不渲染。 */
  readonly headerLinks?: ReactNode;
}

const entryHref = (slug: string) => `/encyclopedia/${slug}`;

/**
 * 共源百科目录页。
 *
 * 它只做**产品**：分类分组、检索、计数与条目卡片。URL 同步是可选的（`path` 存在才写回），因为
 * 目录页需要可分享的 `?q=&c=` 链接，而条目页侧栏只需要本地筛选。
 *
 * 布局沿用 Web 既有形态（左侧分类栏 + 右侧分组网格，窄屏收成横向滚动的分类条），因为两端呈现同一
 * 份信息架构是 `ADR-desktop-shared-product` §2 的要求，而视觉差异必须**有真实原因**才允许存在。
 */
export function EncyclopediaIndexView({
  onNavigate,
  path,
  initialQuery = '',
  initialCategoryId = ALL_CATEGORY,
  headerLinks,
}: EncyclopediaIndexViewProps) {
  const filter = useEncyclopediaFilter({
    initial: { query: initialQuery, categoryId: initialCategoryId },
    ready: path !== undefined,
    onChange: ({ query, categoryId }) => {
      if (path === undefined) return;
      const params = new URLSearchParams();
      if (categoryId !== ALL_CATEGORY) params.set('c', categoryId);
      if (query.trim()) params.set('q', query.trim());
      const search = params.toString();
      onNavigate(search ? `${path}?${search}` : path);
    },
  });

  const { entries, counts, grouped, showClear } = useFilteredEncyclopediaEntries(filter);

  const categoryButton = (id: EncyclopediaCategoryFilter, title: string, active: boolean) => (
    <button
      key={id}
      type="button"
      onClick={() => filter.setCategoryId(id)}
      aria-pressed={active}
      className={[
        'shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors',
        active ? 'bg-purple-600 text-white' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
      ].join(' ')}
    >
      {title}
      <span className="ml-1 text-xs opacity-80">({counts[id]?.matched ?? 0})</span>
    </button>
  );

  const entryCard = (slug: string, title: string, summary: string) => (
    <a
      key={slug}
      href={entryHref(slug)}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(entryHref(slug));
      }}
      className="group rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-gray-900 group-hover:text-gray-950">
            {title}
          </div>
          <div className="mt-1 line-clamp-2 text-sm text-gray-600">{summary}</div>
        </div>
        <div className="shrink-0 text-gray-300 group-hover:text-gray-400" aria-hidden>
          →
        </div>
      </div>
    </a>
  );

  return (
    <section data-testid="encyclopedia-index" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">百科</h1>
          <div className="mt-1 text-sm text-gray-600">
            涵盖使用说明、规则、故障排查与进阶内容，随应用离线可用。
          </div>
        </div>
        {headerLinks ? <div className="flex items-center gap-4 text-sm">{headerLinks}</div> : null}
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-xl">
          <input
            type="search"
            value={filter.query}
            onChange={(event) => filter.setQuery(event.target.value)}
            placeholder="搜索条目：标题 / 简介 / 关键词…"
            aria-label="搜索百科条目"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
          />
          {filter.query.trim() ? (
            <button
              type="button"
              onClick={() => filter.setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
            >
              清除
            </button>
          ) : null}
        </div>
        <div className="text-sm text-gray-600">
          {entries.length} / {counts[ALL_CATEGORY]?.total ?? 0} 篇
        </div>
      </div>

      {/* 窄屏用横向滚动的分类条，宽屏用左侧栏：同一份数据、两种承载，与既有 Web 形态一致。 */}
      <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
        {categoryButton(ALL_CATEGORY, '全部', filter.categoryId === ALL_CATEGORY)}
        {encyclopediaCategories.map((category) =>
          categoryButton(category.id, category.title, filter.categoryId === category.id),
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-6 rounded-xl border border-gray-200 bg-white p-3">
            <div className="text-xs font-semibold text-gray-700">分类</div>
            <div className="mt-2 space-y-1">
              <button
                type="button"
                onClick={() => filter.setCategoryId(ALL_CATEGORY)}
                aria-pressed={filter.categoryId === ALL_CATEGORY}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                  filter.categoryId === ALL_CATEGORY
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>全部</span>
                <span className={filter.categoryId === ALL_CATEGORY ? 'text-white/80' : 'text-gray-400'}>
                  {counts[ALL_CATEGORY]?.matched ?? 0}
                </span>
              </button>
              {encyclopediaCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => filter.setCategoryId(category.id)}
                  aria-pressed={filter.categoryId === category.id}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                    filter.categoryId === category.id
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="min-w-0 truncate">{category.title}</span>
                  <span className={filter.categoryId === category.id ? 'text-white/80' : 'text-gray-400'}>
                    {counts[category.id]?.matched ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              小技巧：先选分类再搜索，能更快定位需要的条目。
            </div>
            {showClear ? (
              <button
                type="button"
                onClick={filter.reset}
                className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
              >
                重置筛选
              </button>
            ) : null}
          </div>
        </aside>

        <main className="min-w-0">
          {filter.categoryId === ALL_CATEGORY ? (
            <div className="space-y-10">
              {grouped.categoriesWithEntries.map(({ category, entries: categoryEntries }) => (
                <section key={category.id}>
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">{category.title}</h2>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {categoryEntries.length} 篇
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-gray-600">{category.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => filter.setCategoryId(category.id)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      只看此分类 →
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {categoryEntries.map((entry) => entryCard(entry.slug, entry.title, entry.summary))}
                  </div>
                </section>
              ))}

              {grouped.uncategorized.length > 0 ? (
                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">未分类</h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {grouped.uncategorized.length} 篇
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {grouped.uncategorized.map((entry) => entryCard(entry.slug, entry.title, entry.summary))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {entries.map((entry) => entryCard(entry.slug, entry.title, entry.summary))}
            </div>
          )}

          {entries.length === 0 ? (
            <div className="text-sm text-gray-600">没有找到匹配条目。试试调整关键词，或点击「重置筛选」。</div>
          ) : null}
        </main>
      </div>
    </section>
  );
}