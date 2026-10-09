import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { Announcement } from '@mahoshojo/contracts/announcements';
import { interpolateWithQQGroups } from '../community/index';
import { MarkdownBlock } from '../markdown/MarkdownBlock';
import type { ExternalMediaPolicy } from '../markdown/text/index';
import { DENY_EXTERNAL_MEDIA } from '../markdown/text/index';
import type { ExternalLinkRenderProps } from '../markdown/MarkdownBlock';
import { useBaseModalAccessibility } from '../modal/BaseModal';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * 公告「已读」的宿主存储。
 *
 * 它只是装饰性 UI 状态（关掉滚动条后不再自动弹出），不是产品数据：放进宿主给的任意
 * 同步 KV 即可——Web 用 `localStorage`，Desktop 同样用 WebView 的 `localStorage`，
 * 不占用 native 状态目录，也不需要 IPC。
 */
export interface AnnouncementDismissalStore {
  readonly isDismissed: (announcementId: string) => boolean;
  readonly markDismissed: (announcementId: string) => void;
}

export interface AnnouncementCenterProps {
  /** 公告源。共享层负责排序与置顶语义；谁读、读到的是快照还是远端，是宿主的事。 */
  readonly announcements: readonly Announcement[];
  readonly dismissal: AnnouncementDismissalStore;
  /** 站外媒体策略。缺省拒绝一切站外媒体——公告里的图片/视频地址不自动加载。 */
  readonly externalMediaPolicy?: ExternalMediaPolicy;
  readonly onNavigateInternal?: (href: string) => void;
  /** 渲染内部 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  readonly resolveInternalHref?: (href: string) => string;
  readonly onNavigateExternal?: (href: string) => void;
  readonly renderExternalLink?: (link: ExternalLinkRenderProps) => ReactNode;
  /**
   * 公告列表视图顶部的宿主工具槽。
   *
   * Desktop 在这里放「手动刷新 + 快照时间」；Web 不给——它的公告永远来自同源
   * `/announcements.json`，没有「本地快照可能过期」这回事。
   */
  readonly toolbar?: ReactNode;
}

/**
 * 排序是产品语义而不是宿主决定：置顶在前，其余按日期降序。
 * 它决定滚动条内容与「最新一条是否已读」的判定锚点。
 */
export const sortAnnouncements = (list: readonly Announcement[]): Announcement[] =>
  [...list].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

/**
 * 共源公告栏（D5.1-P1 自 `apps/web/components/Announcement/AnnouncementTicker.tsx` 上移）。
 *
 * 滚动条与详情弹窗沿用 Web 形态，公告固定定位与底部占位由共享层一并维护。
 * 宿主差异通过以下边界注入：
 *
 * 1. 数据注入——Web 自己在 effect 里 `fetch('/announcements.json')`，那是宿主决定，
 *    共享层不内置任何请求；宿主的获取节奏按 `DESK-PARITY-003` 策略注入
 *    （Desktop 默认 `on-launch` 每次启动检查一次）；
 * 2. styled-jsx 动画换成 `product-shell.css` 里的 `announcement-*` 类（Next 私有机制
 *    不能出现在共享包）；
 * 3. 正文渲染换成共源 `MarkdownBlock`，站外媒体与外链策略由宿主注入——Desktop 注入
 *    `DENY_EXTERNAL_MEDIA` 与受控外链确认，公告里的远端图不自动加载、链接经确认后
 *    才由系统浏览器打开。
 */
export function AnnouncementCenter({
  announcements,
  dismissal,
  externalMediaPolicy = DENY_EXTERNAL_MEDIA,
  onNavigateInternal,
  resolveInternalHref,
  onNavigateExternal,
  renderExternalLink,
  toolbar,
}: AnnouncementCenterProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const tickerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tickerContentRef = useRef<HTMLSpanElement | null>(null);
  const [tickerHeight, setTickerHeight] = useState(0);
  const [scrollDurationSeconds, setScrollDurationSeconds] = useState(15);

  const sortedAnnouncements = useMemo(() => sortAnnouncements(announcements), [announcements]);

  const tickerAnnouncements = useMemo(() => {
    const pinned = sortedAnnouncements.filter((announcement) => announcement.pinned);
    const firstNonPinned = sortedAnnouncements.find((announcement) => !announcement.pinned);
    return [...pinned, ...(firstNonPinned ? [firstNonPinned] : [])];
  }, [sortedAnnouncements]);

  // 排序后第一条即「最新公告」；它的 id 已读则整个滚动条不自动出现，
  // 直到有一条 id 不同的新公告进来（与 Web 既有语义一致）。
  useEffect(() => {
    if (sortedAnnouncements.length === 0) {
      setIsVisible(false);
      return;
    }

    const latestId = sortedAnnouncements[0].id;
    if (dismissal.isDismissed(latestId)) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
  }, [sortedAnnouncements, dismissal]);

  useIsomorphicLayoutEffect(() => {
    if (!isVisible || tickerAnnouncements.length === 0) return;

    const ticker = tickerRef.current;
    const tickerContent = tickerContentRef.current;
    if (!ticker || !tickerContent) return;

    let active = true;
    const measure = () => {
      if (!active) return;

      // border-box 已包含边框、缩放后的文本与移动端安全区；向上取整避免不足 1px 的遮挡。
      setTickerHeight(Math.ceil(ticker.getBoundingClientRect().height));

      const contentWidth = tickerContent.scrollWidth;
      const viewportWidth = window.innerWidth;
      const travelDistance = viewportWidth + contentWidth;
      const pixelsPerSecond = 60;
      const duration = Math.max(18, Math.min(75, travelDistance / pixelsPerSecond));
      setScrollDurationSeconds(duration);
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(ticker, { box: 'border-box' });
    observer?.observe(tickerContent);
    window.addEventListener('resize', measure);

    const fonts = document.fonts;
    void fonts?.ready.then(measure);
    fonts?.addEventListener('loadingdone', measure);

    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      fonts?.removeEventListener('loadingdone', measure);
    };
  }, [isVisible, tickerAnnouncements]);

  const handleDismiss = () => {
    setIsVisible(false);
    if (sortedAnnouncements.length > 0) {
      dismissal.markDismissed(sortedAnnouncements[0].id);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedAnnouncement(null);
  };

  const { dialogRef, initialFocusRef: closeButtonRef, titleId } = useBaseModalAccessibility({
    isOpen: isVisible && isModalOpen && sortedAnnouncements.length > 0,
    onClose: handleCloseModal,
    fallbackFocusRef: triggerRef,
  });

  if (!isVisible || sortedAnnouncements.length === 0) {
    return null;
  }

  return (
    <>
      {/* Desktop 在页面内容之前挂载公告，因此占位必须位于文档末尾，不能挤到页面顶部。
          只管理自有节点，不覆盖宿主原有 body padding，也无需全局 class 的清理/恢复。 */}
      {createPortal(
        <div className="announcement-spacer" aria-hidden="true" style={{ height: tickerHeight }} />,
        document.body,
      )}
      {/* 公告栏主体 */}
      <div
        ref={tickerRef}
        className="announcement-ticker announcement-pause-on-hover fixed bottom-0 left-0 right-0 w-full bg-gray-900/90 backdrop-blur-lg text-gray-200 flex items-center justify-between border-t border-white/10 shadow-lg z-[1000]"
      >
        <button
          ref={triggerRef}
          type="button"
          className="announcement-trigger flex min-w-0 flex-1 items-center overflow-hidden rounded-md text-left"
          aria-label={`查看公告：${tickerAnnouncements.map((announcement) => announcement.title).join('；')}`}
          aria-haspopup="dialog"
          aria-expanded={isModalOpen}
          onClick={() => {
            // 点击按钮不一定在所有 WebView 中移焦点，显式记住可返回的公告入口。
            triggerRef.current?.focus();
            setIsModalOpen(true);
            setSelectedAnnouncement(null);
          }}
        >
          <span className="bg-pink-500 text-white px-2 py-1 rounded text-xs font-semibold tracking-wider mr-3 flex-shrink-0">
            公告
          </span>
          <span className="min-w-0 flex-grow whitespace-nowrap overflow-hidden">
            <span
              ref={tickerContentRef}
              className="inline-block announcement-scroll"
              style={{ animationDuration: `${scrollDurationSeconds}s` }}
            >
              {tickerAnnouncements.map((announcement, index) => (
                <span key={announcement.id} className="inline-flex items-center">
                  {announcement.pinned && <span className="mr-1">📌</span>}
                  {announcement.title}
                  {index < tickerAnnouncements.length - 1 && (
                    <span className="mx-6 text-gray-500">·</span>
                  )}
                </span>
              ))}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="announcement-dismiss ml-2 shrink-0 rounded-md text-gray-400 hover:text-white text-2xl leading-none transition-colors duration-200"
          aria-label="关闭公告"
        >
          ×
        </button>
      </div>

      {/* 详情弹窗 */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1001] announcement-fade"
          onClick={handleCloseModal}
        >
          <div
            ref={dialogRef}
            className="bg-white rounded-xl max-w-2xl w-[90%] max-h-[80vh] flex flex-col shadow-2xl announcement-rise"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            {selectedAnnouncement ? (
              <>
                <div className="flex justify-between items-center p-6 border-b border-gray-200">
                  <h2 id={titleId} className="text-xl font-semibold text-gray-900">
                    {selectedAnnouncement.pinned && '📌 '}
                    {selectedAnnouncement.title}
                  </h2>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={handleCloseModal}
                    className="text-gray-400 hover:text-gray-900 text-3xl leading-none transition-colors"
                    aria-label="关闭详情"
                  >
                    ×
                  </button>
                </div>
                <div className="flex gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                  <span>发布于: {selectedAnnouncement.date}</span>
                  {selectedAnnouncement.publisher && <span>发布者: {selectedAnnouncement.publisher}</span>}
                </div>
                <div className="px-6 py-4 overflow-y-auto flex-grow">
                  <MarkdownBlock
                    content={interpolateWithQQGroups(selectedAnnouncement.content)}
                    variant="light"
                    mode="article"
                    externalMediaPolicy={externalMediaPolicy}
                    onNavigateInternal={onNavigateInternal}
                    resolveInternalHref={resolveInternalHref}
                    onNavigateExternal={onNavigateExternal}
                    renderExternalLink={renderExternalLink}
                  />
                </div>
                <div className="px-6 py-4 border-t border-gray-200 flex justify-start">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAnnouncement(null);
                      closeButtonRef.current?.focus();
                    }}
                    className="bg-pink-500 hover:bg-pink-600 cursor-pointer text-white px-5 py-2 rounded-md text-sm font-medium transition-all duration-200 hover:-translate-x-0.5"
                  >
                    ← 返回列表
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center p-6 border-b border-gray-200">
                  <h2 id={titleId} className="text-xl font-semibold text-gray-900">公告</h2>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={handleCloseModal}
                    className="text-gray-400 hover:text-gray-900 text-3xl leading-none transition-colors"
                    aria-label="关闭详情"
                  >
                    ×
                  </button>
                </div>
                {toolbar}
                <div className="px-6 py-4 overflow-y-auto flex flex-col gap-4">
                  {sortedAnnouncements.map((announcement) => (
                    <div
                      key={announcement.id}
                      className="bg-gray-50 border border-gray-200 rounded-lg p-4 transition-all duration-200 hover:bg-gray-100 hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <h3 className="text-base font-semibold text-gray-900 mb-2">
                        {announcement.pinned && '📌 '}
                        {announcement.title}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <span>{announcement.date}</span>
                        {announcement.publisher && <span>· {announcement.publisher}</span>}
                      </div>
                      <p className="text-gray-700 text-sm leading-relaxed mb-3">
                        {interpolateWithQQGroups(announcement.content)
                          .substring(0, 100)
                          .replace(/[#*\n]/g, '')}
                        ...
                      </p>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="bg-pink-500 hover:bg-pink-600 cursor-pointer text-white px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 hover:translate-x-0.5 hover:shadow-md"
                          onClick={() => {
                            setSelectedAnnouncement(announcement);
                            closeButtonRef.current?.focus();
                          }}
                        >
                          查看详情 →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
