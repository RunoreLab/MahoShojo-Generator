import Head from 'next/head';
import Link from 'next/link';

import { encyclopediaEntries } from '@/lib/encyclopedia';

export default function EncyclopediaIndex() {
  return (
    <>
      <Head>
        <title>百科 - MahoShojo Generator</title>
      </Head>

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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {encyclopediaEntries.map((entry) => (
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
                        <div className="mt-1 line-clamp-2 text-sm text-gray-600">{entry.summary}</div>
                      </div>
                      <div className="shrink-0 text-gray-300 group-hover:text-gray-400" aria-hidden>
                        →
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
