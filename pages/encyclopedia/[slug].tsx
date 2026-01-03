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
        <div className="container">
          <div className="card">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-gray-800">{entry?.title ?? '未找到条目'}</h1>
                <Link href="/encyclopedia" className="text-sm text-blue-600 hover:underline">返回百科目录</Link>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Link href="/arena" className="text-blue-600 hover:underline">竞技场</Link>
                <Link href="/ranking" className="text-blue-600 hover:underline">排行榜</Link>
              </div>
            </div>

            <div className="mt-4 grid gap-6 lg:grid-cols-[220px_1fr]">
              <aside className="rounded-lg border border-gray-200 bg-white p-3 h-fit">
                <div className="text-xs font-semibold text-gray-700">条目</div>
                <div className="mt-2 space-y-1">
                  {encyclopediaEntries.map((item) => (
                    <Link
                      key={item.slug}
                      href={`/encyclopedia/${item.slug}`}
                      className={`block rounded px-2 py-1 text-sm ${
                        item.slug === entry?.slug
                          ? 'bg-purple-600 text-white'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {item.title}
                    </Link>
                  ))}
                </div>
              </aside>

              <main>
                {loading ? (
                  <div className="text-sm text-gray-500">正在加载内容...</div>
                ) : error ? (
                  <div className="text-sm text-red-600">加载失败：{error}</div>
                ) : entry ? (
                  <MarkdownBlock content={content} variant="light" className="prose-max-w-none" />
                ) : (
                  <div className="text-sm text-gray-600">
                    该百科条目不存在，可能是链接已过期或版本尚未同步。
                  </div>
                )}

                {entry?.slug === 'tags' ? <TagsLibraryPanel /> : null}
              </main>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

