import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { TagsLibraryPanel } from '@/components/encyclopedia/TagsLibraryPanel';
import { encyclopediaEntries, getEncyclopediaEntry } from '@/lib/encyclopedia';

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
              </div>

              <div className="flex items-center gap-4 text-sm">
                <Link href="/arena" className="text-blue-600 hover:underline">竞技场</Link>
                <Link href="/ranking" className="text-blue-600 hover:underline">排行榜</Link>
              </div>
            </header>

            <div className="px-6 py-6 sm:px-8 sm:py-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
                <nav className="lg:hidden">
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <label className="text-xs font-semibold text-gray-700">条目</label>
                    <select
                      value={entry?.slug ?? ''}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (!next) return;
                        void router.push(`/encyclopedia/${next}`);
                      }}
                      className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
                    >
                      {entry ? null : <option value="">请选择条目…</option>}
                      {encyclopediaEntries.map((item) => (
                        <option key={item.slug} value={item.slug}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 text-xs text-gray-500">切换条目后会回到页面顶部，方便从头阅读。</div>
                  </div>
                </nav>

                <aside className="hidden shrink-0 lg:block lg:w-72">
                  <div className="sticky top-6 rounded-xl border border-gray-200 bg-white p-3">
                    <div className="text-xs font-semibold text-gray-700">条目</div>
                    <div className="mt-2 space-y-1">
                      {encyclopediaEntries.map((item) => (
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
                  </div>
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
