import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { parseAnnouncementList, type Announcement } from '@mahoshojo/contracts/announcements';
import { AnnouncementCenter, type AnnouncementDismissalStore } from '@mahoshojo/ui-web/announcement';
import { webExternalMediaPolicy } from '@/lib/markdown/externalMedia';

const DISMISS_KEY_PREFIX = 'announcement_dismissed_';

/**
 * Web 的公告装配：滚动条/弹窗/排序与已读语义都在共享 `AnnouncementCenter` 里，
 * 本文件只注入宿主差异——
 *
 * - 公告源是同源 `/announcements.json`（Web 在线 bootstrap 的一部分，挂载即拉取）；
 * - 「已读」落在 `localStorage`；
 * - 站外媒体走 Web 白名单策略，站外链接原生新标签打开；
 * - 站内链接交给 App Router。
 *
 * 结构与文案不再由本文件描述——共享层是唯一定义处（D5.1-P1 / DESK-PARITY-003）。
 */
const AnnouncementTicker: React.FC = () => {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const dismissal = useMemo<AnnouncementDismissalStore>(
    () => ({
      isDismissed: (id) => localStorage.getItem(`${DISMISS_KEY_PREFIX}${id}`) === 'true',
      markDismissed: (id) => localStorage.setItem(`${DISMISS_KEY_PREFIX}${id}`, 'true'),
    }),
    [],
  );

  useEffect(() => {
    fetch('/announcements.json')
      .then((res) => res.json())
      .then((data: unknown) => {
        // fail-closed：公告源结构不合法时整体不展示，而不是截断出半截列表。
        const parsed = parseAnnouncementList(data);
        if (parsed && parsed.length > 0) setAnnouncements(parsed);
      })
      .catch((err) => console.error('加载公告失败:', err));
  }, []);

  if (announcements.length === 0) return null;

  return (
    <AnnouncementCenter
      announcements={announcements}
      dismissal={dismissal}
      externalMediaPolicy={webExternalMediaPolicy}
      onNavigateInternal={(href) => {
        void router.push(href);
      }}
      renderExternalLink={({ href, title, className, children }) => (
        <a href={href} title={title} target="_blank" rel="noopener noreferrer" className={className}>
          {children}
        </a>
      )}
    />
  );
};

export default AnnouncementTicker;
