// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AnnouncementCenter } from '@mahoshojo/ui-web/announcement';
import { ExternalLinksProvider, useExternalLinks } from '../src/features/external-links/external-links-provider';

it('keeps external confirmation/error above the announcement and Escape returns to its link', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const invoke = vi.fn().mockRejectedValue({ code: 'open-failed', message: 'test failure' });
  const announcements = [{ id: 'test', title: '测试公告', content: '[站外帮助](https://example.com/help)', date: '2026-10-09' }];
  const dismissal = { isDismissed: () => false, markDismissed: vi.fn() };
  function Content() {
    const { openContent } = useExternalLinks();
    return <AnnouncementCenter announcements={announcements} dismissal={dismissal} onNavigateExternal={openContent} />;
  }
  const click = async (element: HTMLElement) => { await act(async () => { element.focus(); element.click(); }); };
  const escape = async () => { await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }); };
  const getButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes(text))!;
  try {
    await act(async () => root.render(<ExternalLinksProvider invoke={invoke}><Content /></ExternalLinksProvider>));
    await click(container.querySelector<HTMLButtonElement>('.announcement-trigger')!);
    await click(getButton('查看详情'));
    const link = container.querySelector<HTMLAnchorElement>('a[href="https://example.com/help"]')!;
    await click(link);
    const confirmation = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) => dialog.textContent?.includes('打开外部链接？'))!;
    expect(confirmation.parentElement?.classList.contains('z-[1100]')).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    await escape();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(link);
    await click(link);
    await click(getButton('在系统浏览器打开'));
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_external_url', { url: 'https://example.com/help' });
    const error = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) => dialog.textContent?.includes('无法打开链接'))!;
    expect(error.parentElement?.classList.contains('z-[1100]')).toBe(true);
    await escape();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  } finally {
    act(() => root.unmount()); container.remove();
  }
});
