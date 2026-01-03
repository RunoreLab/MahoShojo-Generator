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
        <div className="container">
          <div className="card">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-800">百科</h1>
              <Link href="/" className="text-sm text-blue-600 hover:underline">返回首页</Link>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {encyclopediaEntries.map((entry) => (
                <Link
                  key={entry.slug}
                  href={`/encyclopedia/${entry.slug}`}
                  className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="text-base font-semibold text-gray-800">{entry.title}</div>
                  <div className="mt-1 text-sm text-gray-600">{entry.summary}</div>
                </Link>
              ))}
            </div>

            <div className="mt-6 flex gap-4 flex-wrap text-sm">
              <Link href="/arena" className="text-blue-600 hover:underline">去竞技场</Link>
              <Link href="/ranking" className="text-blue-600 hover:underline">看排行榜</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

