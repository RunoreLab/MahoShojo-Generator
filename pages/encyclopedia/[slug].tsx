import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { TagsLibraryPanel } from '@/components/encyclopedia/TagsLibraryPanel';
import {
  encyclopediaEntries,
  getEncyclopediaCategory,
  getEncyclopediaEntry,
  groupEncyclopediaEntries,
  matchEncyclopediaEntry,
} from '@/lib/encyclopedia';

export default function EncyclopediaEntryPage() {
  const router = useRouter();
  const slugParam = router.query.slug;
  const slug = typeof slugParam === 'string' ? slugParam : undefined;

  const entry = useMemo(() => getEncyclopediaEntry(slug), [slug]);

  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const displayContent = useMemo(() => {
    if (!entry) return content;
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const firstLine = lines[0]?.trim() ?? '';
    const match = firstLine.match(/^#\s+(.*)$/);
    if (!match) return content;
    const heading = match[1]?.trim() ?? '';
    if (!heading || heading !== entry.title.trim()) return content;
    let startIndex = 1;
    while (startIndex < lines.length && lines[startIndex]?.trim() === '') startIndex += 1;
    return lines.slice(startIndex).join('\n');
  }, [content, entry]);

  const [navQuery, setNavQuery] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(true);

  const filteredNavEntries = useMemo(() => {
    return encyclopediaEntries.filter((item) => matchEncyclopediaEntry(item, navQuery));
  }, [navQuery]);

  const groupedNavEntries = useMemo(() => {
    return groupEncyclopediaEntries(filteredNavEntries);
  }, [filteredNavEntries]);

  const entryCategory = useMemo(() => {
    return entry ? getEncyclopediaCategory(entry.categoryId) : null;
  }, [entry]);

  useEffect(() => {
    if (!entry) {
      setLoading(false);
      setContent('');
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetch(entry.markdownPath)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      })
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entry]);

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-gray-700">条目</div>
        <Link href="/encyclopedia" className="text-xs text-blue-600 hover:underline">
          目录
        </Link>
      </div>

      <div className="mt-2">
        <input
          type="search"
          value={navQuery}
          onChange={(e) => setNavQuery(e.target.value)}
          placeholder="搜索条目…"
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
        />
        {navQuery.trim() ? (
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>匹配 {filteredNavEntries.length} 篇</span>
            <button
              type="button"
              onClick={() => setNavQuery('')}
              className="rounded-md px-2 py-1 text-gray-600 hover:bg-gray-50"
            >
              清除
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {groupedNavEntries.categoriesWithEntries.map(({ category, entries }) => {
          const open = Boolean(navQuery.trim()) || entry?.categoryId === category.id;
          return (
            <details key={category.id} open={open} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 truncate">{category.title}</span>
                <span className="shrink-0 text-xs text-gray-400 group-open:text-gray-500">
                  {entries.length}
                </span>
              </summary>
              <div className="mt-1 space-y-1 pl-1">
                {entries.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/encyclopedia/${item.slug}`}
                    className={`block rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      item.slug === entry?.slug
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.title}
                  </Link>
                ))}
              </div>
            </details>
          );
        })}

        {groupedNavEntries.uncategorized.length > 0 ? (
          <details open={Boolean(navQuery.trim())} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">未分类</span>
              <span className="shrink-0 text-xs text-gray-400 group-open:text-gray-500">
                {groupedNavEntries.uncategorized.length}
              </span>
            </summary>
            <div className="mt-1 space-y-1 pl-1">
              {groupedNavEntries.uncategorized.map((item) => (
                <Link
                  key={item.slug}
                  href={`/encyclopedia/${item.slug}`}
                  className={`block rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    item.slug === entry?.slug
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {item.title}
                </Link>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </>
  );

  const sidebarPanel = (
    <div className="rounded-xl border border-gray-200 bg-white p-3">{sidebarContent}</div>
  );

  return (
    <>
      <Head>
        <title>{entry ? `${entry.title} - 百科` : '百科 - MahoShojo Generator'}</title>
      </Head>

      <div className="magic-background-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="rounded-2xl bg-white/95 shadow-[0_20px_40px_rgba(0,0,0,0.10)] ring-1 ring-white/50 backdrop-blur">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 sm:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="truncate text-xl font-bold text-gray-900">{entry?.title ?? '未找到条目'}</h1>
                  <Link href="/encyclopedia" className="text-sm text-blue-600 hover:underline">返回百科目录</Link>
                </div>
                {entry?.summary ? <div className="mt-1 text-sm text-gray-600">{entry.summary}</div> : null}
                {entryCategory ? (
                  <div className="mt-2">
                    <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-purple-100">
                      分类：{entryCategory.title}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-4 text-sm">
                <Link href="/arena" className="text-blue-600 hover:underline">竞技场</Link>
                <Link href="/ranking" className="text-blue-600 hover:underline">排行榜</Link>
              </div>
            </header>

            <div className="px-6 py-6 sm:px-8 sm:py-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
                <nav className="lg:hidden">
                  <details
                    open={mobileNavOpen}
                    onToggle={(e) => setMobileNavOpen(e.currentTarget.open)}
                    className="rounded-xl border border-gray-200 bg-white p-3"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-gray-800 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 truncate">条目目录</span>
                      <span className="text-xs font-normal text-gray-500">
                        {entry ? '切换条目' : '请选择条目'}
                      </span>
                    </summary>
                    <div className="mt-3">{sidebarContent}</div>
                    <div className="mt-2 text-xs text-gray-500">
                      小技巧：用上方搜索可快速定位；切换条目后会回到页面顶部，方便从头阅读。
                    </div>
                  </details>
                </nav>

                <aside className="hidden shrink-0 lg:block lg:w-72">
                  <div className="sticky top-6">{sidebarPanel}</div>
                </aside>

                <main className="min-w-0 flex-1">
                  <div className="mx-auto w-full max-w-3xl">
                    {loading ? (
                      <div className="text-sm text-gray-500">正在加载内容...</div>
                    ) : error ? (
                      <div className="text-sm text-red-600">加载失败：{error}</div>
                    ) : entry ? (
                      <MarkdownBlock content={displayContent} variant="light" mode="article" />
                    ) : (
                      <div className="text-sm text-gray-600">
                        该百科条目不存在，可能是链接已过期或版本尚未同步。
                      </div>
                    )}

                    {entry?.slug === 'tags' ? <TagsLibraryPanel /> : null}
                  </div>
                </main>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
