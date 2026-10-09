'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import Footer from '@/components/Footer';
import { TavernExportPanel } from '@/components/tavern/TavernExportPanel';
import { TavernHeroBanner } from '@/components/tavern/TavernHeroBanner';
import { TavernImportPanel } from '@/components/tavern/TavernImportPanel';

import { TavernTabs, TavernTabPanels, type TavernTab } from '@mahoshojo/ui-web/tavern';

export function TavernPage() {
  const idPrefix = useId();
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [tab, setTab] = useState<TavernTab>('import');

  return (
    <div className="magic-background-white">
        <div className="container !max-w-[980px]">
          <div className="card !max-w-none !p-0">
            <TavernHeroBanner
              title="酒馆生态"
              subtitle="SillyTavern 角色卡（PNG 内嵌 JSON）导入/导出工具"
              right={(
                <Link href="/" className="text-sm text-pink-700 hover:underline">
                  返回首页
                </Link>
              )}
              actions={(
                <div className="grid gap-3">
                  <div className="grid gap-2 sm:grid-cols-2">
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
                  <TavernTabs idPrefix={idPrefix} tab={tab} onChange={setTab} disabled={importBusy || exportBusy} />
                </div>
              )}
            />

            <div className="p-6">
              <div className="text-center text-xs text-gray-600">
                提示：本地 PNG 解析/写入无需上传；在线档案馆、来源验证、AI/立绘等功能会联网。
              </div>

              <TavernTabPanels idPrefix={idPrefix} tab={tab} importPanel={<TavernImportPanel onBusyChange={setImportBusy} />} exportPanel={<TavernExportPanel onBusyChange={setExportBusy} />} />

              <Footer className="footer mt-8" />
            </div>
          </div>
        </div>
    </div>
  );
}
