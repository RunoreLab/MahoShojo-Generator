'use client';

import { useEffect, useMemo } from 'react';
import { LocalArchivePanel, useLocalArchiveView } from '@mahoshojo/ui-web/local-archive';
import { LocalLibraryPageLayout, LocalCardsPanel, useLocalCardsController, type LocalCardsHost } from '@mahoshojo/ui-web/local-cards';

import { LocalLibraryStatusNote } from '@/components/shared/LocalLibraryStatusNote';
import { createWebArchiveHost, WEB_LIBRARY_ARCHIVE_LIMITS } from '@/lib/local-library/archive-host';
import { getLocalCardRepository } from '@/lib/local-library/card-repository';

/**
 * 设备级本地库页面。
 *
 * ## 为什么它是独立路由而不是 `/me` 的一个 tab
 *
 * `DESK-059` 明确要求 portable archive 的承载页 MUST 是设备级而非账号级页面：本地库不要求登录，
 * 挂在个人页会让产品语义变成「本地数据属于账号」。这个页面因此不读任何账号状态，未登录也能完整使用。
 *
 * ## 共源范围
 *
 * 归档区块与本地数据卡列表/回收站都是共享实现（`@mahoshojo/ui-web/local-archive`、`/local-cards`），
 * 本文件只提供 Web 侧的 adapter（IndexedDB 仓储 + 浏览器文件能力）。存储状态提示仍用 Web 既有的组件——
 * 它报告的是配额与持久化，与归档区块里「数据库能不能打开」是两条不同的信息，两者都要出现而不是二选一。
 */
export function LocalLibraryPage() {
  // host 必须在渲染之间保持稳定：控制器用它做 useMemo 的依赖，重建会让已预检的字节与 plan 丢失。
  const host = useMemo(() => createWebArchiveHost(), []);
  const archive = useLocalArchiveView(host, { maxArchiveBytes: WEB_LIBRARY_ARCHIVE_LIMITS.fileBytes });
  const cardsHost = useMemo<LocalCardsHost>(() => ({
    store: getLocalCardRepository(),
    describeError: (cause) => (cause instanceof Error ? cause.message : '本地库操作失败，请重试。'),
  }), []);
  const cards = useLocalCardsController(cardsHost);
  const archiveBusy = archive.model.exporting || archive.model.inspecting || archive.model.applying;
  const { reload } = cards.controller.actions;

  // 归档导入写入的是同一个库：结果一出来就重读，避免列表停在导入前的快照。
  useEffect(() => {
    if (archive.model.report !== null) reload();
  }, [archive.model.report, reload]);

  return (
    <LocalLibraryPageLayout>
      <LocalLibraryStatusNote />

      <LocalCardsPanel model={cards.model} actions={cards.controller.actions} disabled={archiveBusy} />

      <LocalArchivePanel {...archive} />

      <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
        <h2 className="mb-1 text-sm font-medium text-(--app-text-muted)">还没有的</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-(--app-text-muted)">
          <li>
            <strong className="font-medium">整库备份与灾难恢复</strong>：上面的导出是 portable archive，
            用于换设备与跨浏览器搬运；它不是「把整台设备的状态快照下来」的备份。恢复流程尚未交付。
          </li>
          <li>
            <strong className="font-medium">Web 包回收站</strong>：从本机删除 Web 包是彻底移除，没有回收站。
            数据卡的回收站见上方。
          </li>
          <li>
            <strong className="font-medium">单张数据卡导出与编辑</strong>：本页尚未提供；选卡弹窗的本地库页签可下载单张数据卡。
          </li>
        </ul>
      </section>
    </LocalLibraryPageLayout>
  );
}
