import { useMemo } from 'react';
import { useRouter } from '@tanstack/react-router';
import {
  AnnouncementCenter,
  type AnnouncementDismissalStore,
} from '@mahoshojo/ui-web/announcement';
import { DENY_EXTERNAL_MEDIA } from '@mahoshojo/ui-web/markdown';

import { useDesktopAnnouncements } from './use-desktop-announcements';
import { useExternalLinks } from '../external-links/external-links-provider';

const DISMISS_KEY_PREFIX = 'announcement_dismissed_';

/**
 * Desktop 的公告装配（D5.1-P1，`DESK-PARITY-003`）。
 *
 * 共享 `AnnouncementCenter` 只负责视图与置顶/已读语义；这里注入宿主差异：
 *
 * - 数据来自 `DesktopAnnouncementsStore`：内置快照 → native 缓存 → 受控刷新；
 * - 「已读」落在 WebView `localStorage`，与 Web 同一套 key（产品语义不是宿主数据）；
 * - 站外媒体一律拒绝（`DENY_EXTERNAL_MEDIA`），公告里的远端图/视频不自动加载；
 * - 站外链接走 `openContent`：默认展示域名请用户确认后才交给系统浏览器；
 * - 列表顶部工具条给出快照来源/时间与手动刷新；刷新失败保留旧公告并就地标注。
 */
export function DesktopAnnouncementCenter() {
  const router = useRouter();
  const { state, refresh } = useDesktopAnnouncements();
  const { openContent } = useExternalLinks();

  const dismissal = useMemo<AnnouncementDismissalStore>(
    () => ({
      isDismissed: (id) => localStorage.getItem(`${DISMISS_KEY_PREFIX}${id}`) === 'true',
      markDismissed: (id) => localStorage.setItem(`${DISMISS_KEY_PREFIX}${id}`, 'true'),
    }),
    [],
  );

  const sourceLabel =
    state.source === 'remote' || state.source === 'cached-remote'
      ? `远端快照 ${state.fetchedAt ?? ''}`.trim()
      : state.source === 'bundled'
        ? '内置公告快照'
        : null;

  return (
    <AnnouncementCenter
      announcements={state.announcements}
      dismissal={dismissal}
      externalMediaPolicy={DENY_EXTERNAL_MEDIA}
      onNavigateInternal={(href) => {
        void router.navigate({ to: href });
      }}
      onNavigateExternal={openContent}
      toolbar={
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-6 py-3 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            {sourceLabel ? <span className="truncate text-gray-500">{sourceLabel}</span> : null}
            {state.refresh === 'failed' ? (
              <span className="text-amber-600">刷新失败，已保留旧公告{state.lastError ? `：${state.lastError}` : ''}</span>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            disabled={state.refresh === 'refreshing'}
            onClick={() => {
              void refresh();
            }}
          >
            {state.refresh === 'refreshing' ? '刷新中…' : '刷新'}
          </button>
        </div>
      }
    />
  );
}
