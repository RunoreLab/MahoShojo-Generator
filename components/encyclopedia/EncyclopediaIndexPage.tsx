'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  encyclopediaCategories,
  encyclopediaEntries,
  getEncyclopediaCategory,
  groupEncyclopediaEntries,
  matchEncyclopediaEntry,
  type EncyclopediaCategoryId,
} from '@/lib/encyclopedia';

type EncyclopediaCategoryFilter = EncyclopediaCategoryId | 'all';

interface EncyclopediaIndexPageProps {
  initialQuery?: string;
  initialCategoryId?: EncyclopediaCategoryFilter;
}

const normalizeCategoryId = (value: string | null | undefined): EncyclopediaCategoryFilter => {
  return encyclopediaCategories.some((category) => category.id === value)
    ? (value as EncyclopediaCategoryId)
    : 'all';
};

export function EncyclopediaIndexPage({
  initialQuery = '',
  initialCategoryId = 'all',
}: EncyclopediaIndexPageProps) {
  const router = useRouter();
  const pathname = usePathname() || '/encyclopedia';
  const searchParams = useSearchParams();

  const queryFromUrl = searchParams?.get('q') ?? initialQuery;
  const categoryFromUrl = searchParams
    ? normalizeCategoryId(searchParams.get('c') ?? 'all')
    : initialCategoryId;

  const [query, setQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState<EncyclopediaCategoryFilter>(initialCategoryId);

  useEffect(() => {
    setQuery(queryFromUrl);
    setCategoryId(categoryFromUrl);
  }, [categoryFromUrl, queryFromUrl]);

  useEffect(() => {
    if (queryFromUrl === query && categoryFromUrl === categoryId) return;

    const handle = setTimeout(() => {
      const nextQuery = new URLSearchParams();
      if (categoryId !== 'all') nextQuery.set('c', categoryId);
      if (query.trim()) nextQuery.set('q', query.trim());
      const queryString = nextQuery.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    }, 250);

    return () => clearTimeout(handle);
  }, [categoryFromUrl, categoryId, pathname, query, queryFromUrl, router]);

  const filteredEntries = useMemo(() => {
    return encyclopediaEntries.filter((entry) => {
      if (categoryId !== 'all' && entry.categoryId !== categoryId) return false;
      return matchEncyclopediaEntry(entry, query);
    });
  }, [categoryId, query]);

  const countByCategory = useMemo(() => {
    const counts: Record<string, { total: number; matched: number }> = {
      all: { total: encyclopediaEntries.length, matched: filteredEntries.length },
    };

    for (const category of encyclopediaCategories) {
      counts[category.id] = { total: 0, matched: 0 };
    }

    for (const entry of encyclopediaEntries) {
      counts[entry.categoryId] ??= { total: 0, matched: 0 };
      counts[entry.categoryId].total += 1;
    }

    for (const entry of filteredEntries) {
      counts[entry.categoryId] ??= { total: 0, matched: 0 };
      counts[entry.categoryId].matched += 1;
    }

    return counts;
  }, [filteredEntries]);

  const grouped = useMemo(() => groupEncyclopediaEntries(filteredEntries), [filteredEntries]);

  const selectedCategory = useMemo(() => {
    if (categoryId === 'all') return null;
    return getEncyclopediaCategory(categoryId);
  }, [categoryId]);

  const showClear = categoryId !== 'all' || Boolean(query.trim());

  return (
    <>
      <div className="magic-background-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="rounded-2xl bg-white/95 shadow-[0_20px_40px_rgba(0,0,0,0.10)] ring-1 ring-white/50 backdrop-blur">
            <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-6 py-5 sm:px-8">
              <div>
                <h1 className="text-xl font-bold text-gray-900">百科</h1>
                <div className="mt-1 text-sm text-gray-600">
                  {encyclopediaEntries.length} 篇条目 · 涵盖使用说明 / 规则 / 进阶等内容，助你更好地了解和使用本站功能。如有补充，欢迎提交 PR 或反馈投稿！
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <Link href="/" className="text-blue-600 hover:underline">返回首页</Link>
                <Link href="/arena" className="text-blue-600 hover:underline">竞技场</Link>
                <Link href="/ranking" className="text-blue-600 hover:underline">排行榜</Link>
              </div>
            </header>

            <div className="px-6 py-6 sm:px-8 sm:py-8">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-1 items-center gap-3">
                    <div className="relative w-full max-w-xl">
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="搜索条目：标题 / 简介 / 关键词…"
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
                      />
                      {query.trim() ? (
                        <button
                          type="button"
                          onClick={() => setQuery('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                        >
                          清除
                        </button>
                      ) : null}
                    </div>

                    {showClear ? (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery('');
                          setCategoryId('all');
                        }}
                        className="hidden rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 sm:inline-flex"
                      >
                        重置筛选
                      </button>
                    ) : null}
                  </div>

                  <div className="text-sm text-gray-600">
                    {filteredEntries.length} / {encyclopediaEntries.length} 篇
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
                  <button
                    type="button"
                    onClick={() => setCategoryId('all')}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
                      categoryId === 'all'
                        ? 'bg-purple-600 text-white'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    全部
                    <span className="ml-1 text-xs opacity-80">({countByCategory.all.matched})</span>
                  </button>
                  {encyclopediaCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setCategoryId(category.id)}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
                        categoryId === category.id
                          ? 'bg-purple-600 text-white'
                          : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {category.title}
                      <span className="ml-1 text-xs opacity-80">
                        ({countByCategory[category.id]?.matched ?? 0})
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr]">
                <aside className="hidden lg:block">
                  <div className="sticky top-6 rounded-xl border border-gray-200 bg-white p-3">
                    <div className="text-xs font-semibold text-gray-700">分类</div>
                    <div className="mt-2 space-y-1">
                      <button
                        type="button"
                        onClick={() => setCategoryId('all')}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                          categoryId === 'all'
                            ? 'bg-purple-600 text-white'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span>全部</span>
                        <span className={categoryId === 'all' ? 'text-white/80' : 'text-gray-400'}>
                          {countByCategory.all.matched}
                        </span>
                      </button>
                      {encyclopediaCategories.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => setCategoryId(category.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                            categoryId === category.id
                              ? 'bg-purple-600 text-white'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <span className="min-w-0 truncate">{category.title}</span>
                          <span
                            className={categoryId === category.id ? 'text-white/80' : 'text-gray-400'}
                          >
                            {countByCategory[category.id]?.matched ?? 0}
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
                        onClick={() => {
                          setQuery('');
                          setCategoryId('all');
                        }}
                        className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
                      >
                        重置筛选
                      </button>
                    ) : null}
                  </div>
                </aside>

                <main className="min-w-0">
                  {categoryId !== 'all' ? (
                    <div>
                      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-gray-900">
                              {selectedCategory?.title ?? '分类'}
                            </h2>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                              {filteredEntries.length} 篇
                            </span>
                          </div>
                          {selectedCategory?.description ? (
                            <div className="mt-1 text-sm text-gray-600">{selectedCategory.description}</div>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                        {filteredEntries.map((entry) => {
                          const category = getEncyclopediaCategory(entry.categoryId);
                          return (
                            <Link
                              key={entry.slug}
                              href={`/encyclopedia/${entry.slug}`}
                              className="group rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-base font-semibold text-gray-900 group-hover:text-gray-950">
                                    {entry.title}
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-sm text-gray-600">
                                    {entry.summary}
                                  </div>
                                  {category ? (
                                    <div className="mt-3">
                                      <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-purple-100">
                                        {category.title}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="shrink-0 text-gray-300 group-hover:text-gray-400" aria-hidden>
                                  →
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>

                      {filteredEntries.length === 0 ? (
                        <div className="mt-6 text-sm text-gray-600">
                          没有找到匹配条目。试试调整关键词，或点击“重置筛选”。
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-10">
                      {grouped.categoriesWithEntries.map(({ category, entries }) => (
                        <section key={category.id}>
                          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h2 className="text-lg font-semibold text-gray-900">{category.title}</h2>
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                  {entries.length} 篇
                                </span>
                              </div>
                              <div className="mt-1 text-sm text-gray-600">{category.description}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCategoryId(category.id)}
                              className="text-sm text-blue-600 hover:underline"
                            >
                              只看此分类 →
                            </button>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {entries.map((entry) => (
                              <Link
                                key={entry.slug}
                                href={`/encyclopedia/${entry.slug}`}
                                className="group rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-base font-semibold text-gray-900 group-hover:text-gray-950">
                                      {entry.title}
                                    </div>
                                    <div className="mt-1 line-clamp-2 text-sm text-gray-600">
                                      {entry.summary}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-gray-300 group-hover:text-gray-400" aria-hidden>
                                    →
                                  </div>
                                </div>
                              </Link>
                            ))}
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
                            {grouped.uncategorized.map((entry) => (
                              <Link
                                key={entry.slug}
                                href={`/encyclopedia/${entry.slug}`}
                                className="group rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-base font-semibold text-gray-900 group-hover:text-gray-950">
                                      {entry.title}
                                    </div>
                                    <div className="mt-1 line-clamp-2 text-sm text-gray-600">
                                      {entry.summary}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-gray-300 group-hover:text-gray-400" aria-hidden>
                                    →
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      {filteredEntries.length === 0 ? (
                        <div className="text-sm text-gray-600">
                          没有找到匹配条目。试试调整关键词，或点击“重置筛选”。
                        </div>
                      ) : null}
                    </div>
                  )}
                </main>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
