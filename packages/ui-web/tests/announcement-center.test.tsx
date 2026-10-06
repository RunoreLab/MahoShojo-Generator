// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnouncementCenter, sortAnnouncements } from '../src/announcement/AnnouncementCenter';
import type { AnnouncementDismissalStore } from '../src/announcement/index';
import type { Announcement } from '@mahoshojo/contracts/announcements';

let container: HTMLDivElement;
let root: Root;

const makeDismissal = (dismissed = new Set<string>()): AnnouncementDismissalStore => ({
  isDismissed: (id) => dismissed.has(id),
  markDismissed: (id) => dismissed.add(id),
});

const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'old',
    title: '旧公告',
    content: '旧内容',
    date: '2026-01-01',
  },
  {
    id: 'pinned',
    title: '置顶公告',
    content: '置顶内容',
    date: '2026-01-02',
    pinned: true,
  },
  {
    id: 'latest',
    title: '最新公告',
    content: '最新内容 [站内](/details)',
    date: '2026-02-01',
  },
];

const render = (node: Parameters<Root['render']>[0]): void => {
  act(() => {
    root.render(node);
  });
};

const click = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const detailButtons = (): HTMLButtonElement[] =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
    (b.textContent ?? '').includes('查看详情'),
  );

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  document.body.classList.remove('announcement-visible');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.classList.remove('announcement-visible');
});

describe('sortAnnouncements', () => {
  it('orders pinned first, then by date descending', () => {
    expect(sortAnnouncements(ANNOUNCEMENTS).map((a) => a.id)).toEqual(['pinned', 'latest', 'old']);
  });
});

describe('AnnouncementCenter', () => {
  it('renders nothing and skips the body flag when the latest entry is dismissed', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal(new Set(['pinned']))} />);

    expect(container.querySelector('.announcement-ticker')).toBeNull();
    expect(document.body.classList.contains('announcement-visible')).toBe(false);
  });

  it('shows pinned + latest entries in the ticker and marks the body', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);

    const ticker = container.querySelector('.announcement-ticker');
    expect(ticker).not.toBeNull();
    expect(ticker!.textContent).toContain('置顶公告');
    expect(ticker!.textContent).toContain('最新公告');
    expect(ticker!.textContent).not.toContain('旧公告');
    expect(document.body.classList.contains('announcement-visible')).toBe(true);
  });

  it('dismissing the ticker stores the latest id and lifts the body flag', () => {
    const dismissal = makeDismissal();
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={dismissal} />);

    click(container.querySelector('button[aria-label="关闭公告"]')!);

    expect(dismissal.isDismissed('pinned')).toBe(true);
    expect(container.querySelector('.announcement-ticker')).toBeNull();
    expect(document.body.classList.contains('announcement-visible')).toBe(false);
  });

  it('opens the list from the ticker and drills into the detail view', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);

    click(container.querySelector('.announcement-ticker')!);

    // 列表按 pinned 优先 + 日期倒序：置顶、最新、旧。
    const titles = [...container.querySelectorAll('h3')].map((el) => el.textContent);
    expect(titles).toEqual(['📌 置顶公告', '最新公告', '旧公告']);

    click(detailButtons()[2]);

    const markdown = container.querySelector('div.overflow-y-auto');
    expect(markdown?.textContent).toContain('旧内容');
    expect(container.querySelector('h2')?.textContent).toContain('旧公告');
  });

  it('interpolates QQ group placeholders and routes external links through the host', () => {
    const onNavigateExternal = vi.fn();
    const announcements: Announcement[] = [
      {
        id: 'a1',
        title: '加群',
        content: '官方群 {{QQ_GROUPS}} [爱发电](https://afdian.com/a/MahoShojo)',
        date: '2026-02-01',
      },
    ];
    render(
      <AnnouncementCenter
        announcements={announcements}
        dismissal={makeDismissal()}
        onNavigateExternal={onNavigateExternal}
      />,
    );

    click(container.querySelector('.announcement-ticker')!);
    click(detailButtons()[0]);

    const markdown = container.querySelector('div.overflow-y-auto')!;
    expect(markdown.textContent).toContain('1059830952');

    const link = markdown.querySelector<HTMLAnchorElement>('a[href="https://afdian.com/a/MahoShojo"]');
    expect(link).not.toBeNull();
    click(link!);
    expect(onNavigateExternal).toHaveBeenCalledWith('https://afdian.com/a/MahoShojo');
  });

  it('renders unhandled external links as blocked notes instead of dead anchors', () => {
    const announcements: Announcement[] = [
      {
        id: 'a1',
        title: '外链',
        content: '[赞助](https://afdian.com/a/MahoShojo)',
        date: '2026-02-01',
      },
    ];
    render(<AnnouncementCenter announcements={announcements} dismissal={makeDismissal()} />);

    click(container.querySelector('.announcement-ticker')!);
    click(detailButtons()[0]);

    const markdown = container.querySelector('div.overflow-y-auto')!;
    expect(markdown.querySelector('a[href^="https://"]')).toBeNull();
    const blocked = markdown.querySelector('[title]');
    expect(blocked?.textContent).toContain('赞助');
  });
});
