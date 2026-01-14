import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';

import Footer from '@/components/Footer';
import { TavernExportPanel } from '@/components/tavern/TavernExportPanel';
import { TavernImportPanel } from '@/components/tavern/TavernImportPanel';

type TavernTab = 'import' | 'export';

export default function TavernPage() {
  const [tab, setTab] = useState<TavernTab>('import');

  return (
    <>
      <Head>
        <title>酒馆生态联动</title>
        <meta name="description" content="SillyTavern（酒馆）角色卡导入/导出：PNG 内嵌 JSON 解析与写入（本地处理）" />
      </Head>

      <div className="magic-background-white">
        <div className="container !max-w-[980px]">
          <div className="card !max-w-none">
            <div className="flex items-center justify-between">
              <h1 className="title mb-0">酒馆生态</h1>
              <Link href="/" className="text-sm text-pink-700 hover:underline">
                返回首页
              </Link>
            </div>

            <p className="subtitle mt-3 text-center">
              SillyTavern 角色卡（PNG 内嵌 JSON）导入/导出工具
            </p>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <a
                href="https://github.com/SillyTavern/SillyTavern"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-pink-200 bg-white/70 px-4 py-3 text-center text-sm font-semibold text-pink-700 hover:bg-pink-50"
              >
                打开 SillyTavern GitHub（下载/更新）
              </a>
              <a
                href="https://docs.sillytavern.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-pink-200 bg-white/70 px-4 py-3 text-center text-sm font-semibold text-pink-700 hover:bg-pink-50"
              >
                打开 SillyTavern 文档（使用说明）
              </a>
            </div>
            <div className="mt-2 text-center text-xs text-gray-600">
              提示：本页默认只在浏览器本地解析/写入 PNG 元数据；只有选择 AI 相关功能时才会发起网络请求。
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                  tab === 'import'
                    ? 'border-pink-300 bg-pink-100 text-pink-800'
                    : 'border-pink-100 bg-white/70 text-gray-700 hover:bg-pink-50'
                }`}
                onClick={() => setTab('import')}
              >
                导入
              </button>
              <button
                type="button"
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                  tab === 'export'
                    ? 'border-pink-300 bg-pink-100 text-pink-800'
                    : 'border-pink-100 bg-white/70 text-gray-700 hover:bg-pink-50'
                }`}
                onClick={() => setTab('export')}
              >
                导出
              </button>
            </div>

            {tab === 'import' ? <TavernImportPanel /> : <TavernExportPanel />}

            <Footer className="footer mt-8" />
          </div>
        </div>
      </div>
    </>
  );
}
