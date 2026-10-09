// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnouncementCenter, sortAnnouncements } from '../src/announcement/AnnouncementCenter';
import type { AnnouncementDismissalStore } from '../src/announcement/index';
import type { Announcement } from '@mahoshojo/contracts/announcements';
import { ShellEscapeMenu } from '../src/shell/EscapeMenu';

let container: HTMLDivElement;
let root: Root;
let tickerHeight: number;
let contentWidth: number;
let observers: ResizeObserverMock[];
let fonts: EventTarget & { ready: Promise<unknown> };
let resolveFontsReady: () => void;
let originalFonts: PropertyDescriptor | undefined;
let originalBodyStyle: string | null;

class ResizeObserverMock {
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }

  resize(): void {
    this.callback([], this);
  }
}

const spacer = (): HTMLDivElement | null => document.body.querySelector('.announcement-spacer');
const trigger = (): HTMLButtonElement => container.querySelector('.announcement-trigger')!;

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

const pressKey = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    document.activeElement?.dispatchEvent(event);
  });
  return event;
};

const detailButtons = (): HTMLButtonElement[] =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
    (b.textContent ?? '').includes('查看详情'),
  );

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  originalBodyStyle = document.body.getAttribute('style');
  tickerHeight = 52.25;
  contentWidth = 900;
  observers = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, 375, this.classList.contains('announcement-ticker') ? tickerHeight : 0);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('announcement-scroll') ? contentWidth : 0;
  });
  originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>((resolve) => { resolveFontsReady = resolve; }),
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (originalBodyStyle === null) document.body.removeAttribute('style');
  else document.body.setAttribute('style', originalBodyStyle);
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  vi.unstubAllGlobals();
});

describe('sortAnnouncements', () => {
  it('orders pinned first, then by date descending', () => {
    expect(sortAnnouncements(ANNOUNCEMENTS).map((a) => a.id)).toEqual(['pinned', 'latest', 'old']);
  });
});

describe('AnnouncementCenter', () => {
  it('renders nothing and reserves no space when the latest entry is dismissed', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal(new Set(['pinned']))} />);

    expect(container.querySelector('.announcement-ticker')).toBeNull();
    expect(spacer()).toBeNull();
  });

  it('shows pinned + latest entries and reserves the rounded-up measured height at the document end', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);

    const ticker = container.querySelector('.announcement-ticker');
    expect(ticker).not.toBeNull();
    expect(ticker!.textContent).toContain('置顶公告');
    expect(ticker!.textContent).toContain('最新公告');
    expect(ticker!.textContent).not.toContain('旧公告');
    expect(spacer()?.style.height).toBe('53px');
    expect(spacer()?.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.lastElementChild).toBe(spacer());
    expect(container.querySelector('.announcement-spacer')).toBeNull();
    expect(observers[0].observe).toHaveBeenCalledWith(ticker, { box: 'border-box' });
  });

  it('dismissing the ticker stores the latest id and removes its spacer without opening the list', () => {
    const dismissal = makeDismissal();
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={dismissal} />);

    click(container.querySelector('button[aria-label="关闭公告"]')!);

    expect(dismissal.isDismissed('pinned')).toBe(true);
    expect(container.querySelector('h2')).toBeNull();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(container.querySelector('.announcement-ticker')).toBeNull();
    expect(spacer()).toBeNull();
  });

  it('uses separate, focusable native buttons for opening and dismissing announcements', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);

    const openButton = trigger();
    const dismissButton = container.querySelector<HTMLButtonElement>('button[aria-label="关闭公告"]')!;
    expect(openButton.tagName).toBe('BUTTON');
    expect(openButton.type).toBe('button');
    expect(openButton.tabIndex).toBe(0);
    expect(openButton.getAttribute('aria-haspopup')).toBe('dialog');
    expect(openButton.getAttribute('aria-expanded')).toBe('false');
    expect(openButton.getAttribute('aria-label')).toContain('查看公告：置顶公告；最新公告');
    expect(openButton.contains(dismissButton)).toBe(false);
    expect(dismissButton.type).toBe('button');
    openButton.focus();
    expect(document.activeElement).toBe(openButton);
    click(openButton);
    expect(openButton.getAttribute('aria-expanded')).toBe('true');
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('公告');
    expect(document.activeElement).toBe(dialog.querySelector('button[aria-label="关闭详情"]'));
  });

  it('traps Tab in the announcement list and returns focus to its trigger after closing', () => {
    document.body.style.overflow = 'auto';
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);
    const openButton = trigger();
    click(openButton);
    const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')!;
    const lastButton = detailButtons().at(-1)!;
    expect(document.body.style.overflow).toBe('hidden');

    expect(pressKey('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastButton);
    expect(pressKey('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton);

    click(closeButton);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(openButton);
    expect(document.body.style.overflow).toBe('auto');
    expect(spacer()).not.toBeNull();
  });

  it('keeps focus inside the dialog across detail/list changes and closes with Escape', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);
    const openButton = trigger();
    click(openButton);
    const detailButton = detailButtons()[0];
    detailButton.focus();
    click(detailButton);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭详情');

    const backButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('返回列表'))!;
    backButton.focus();
    click(backButton);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭详情');
    expect(detailButtons()).toHaveLength(3);

    expect(pressKey('Escape').defaultPrevented).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(openButton);
  });

  it('consumes Escape before the Desktop shell menu and releases its layer after closing', () => {
    render(
      <>
        <AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />
        <ShellEscapeMenu enabled entries={[]} pathname="/" onNavigate={vi.fn()} />
      </>,
    );
    const openButton = trigger();
    click(openButton);
    pressKey('Escape');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[data-testid="escape-menu-root"]')).toBeNull();
    expect(document.activeElement).toBe(openButton);

    pressKey('Escape');
    expect(document.querySelector('[data-testid="escape-menu-root"]')).not.toBeNull();
  });

  it('restores host scrolling and releases focus trapping if an open announcement unmounts', () => {
    document.body.style.overflow = 'auto';
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);
    click(trigger());
    expect(document.body.style.overflow).toBe('hidden');
    render(null);

    expect(document.body.style.overflow).toBe('auto');
    expect(pressKey('Escape').defaultPrevented).toBe(false);
    expect(pressKey('Tab').defaultPrevented).toBe(false);
    expect(spacer()).toBeNull();
  });

  it('updates its spacer and scrolling duration when actual geometry changes', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);
    const content = container.querySelector<HTMLElement>('.announcement-scroll')!;
    const initialDuration = content.style.animationDuration;

    act(() => {
      tickerHeight = 89.5;
      contentWidth = 2400;
      observers[0].resize();
    });

    expect(spacer()?.style.height).toBe('90px');
    expect(content.style.animationDuration).not.toBe(initialDuration);
  });

  it('remeasures on window resize even when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);

    act(() => {
      tickerHeight = 75;
      window.dispatchEvent(new Event('resize'));
    });

    expect(spacer()?.style.height).toBe('75px');
    expect(observers).toHaveLength(0);
  });

  it('remeasures after initial and later font loads', async () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);

    await act(async () => {
      tickerHeight = 64;
      resolveFontsReady();
      await fonts.ready;
    });
    expect(spacer()?.style.height).toBe('64px');

    act(() => {
      tickerHeight = 82;
      fonts.dispatchEvent(new Event('loadingdone'));
    });
    expect(spacer()?.style.height).toBe('82px');
  });

  it('preserves host body padding and classes across dismissal, remount and unmount', () => {
    document.body.style.paddingBottom = '37px';
    const originalClasses = document.body.className;
    const dismissal = makeDismissal();
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={dismissal} />);
    expect(document.body.style.paddingBottom).toBe('37px');
    expect(document.body.className).toBe(originalClasses);

    click(container.querySelector('button[aria-label="关闭公告"]')!);
    expect(spacer()).toBeNull();
    expect(document.body.style.paddingBottom).toBe('37px');
    render(null);
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={dismissal} />);
    expect(spacer()).toBeNull();

    render(null);
    expect(document.body.style.paddingBottom).toBe('37px');
    expect(document.body.className).toBe(originalClasses);
  });

  it('removes only its own spacer and disconnects every measurement source on unmount', async () => {
    const removeResizeListener = vi.spyOn(window, 'removeEventListener');
    const removeFontListener = vi.spyOn(fonts, 'removeEventListener');
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);
    const observer = observers[0];
    render(null);

    expect(spacer()).toBeNull();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(removeResizeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeFontListener).toHaveBeenCalledWith('loadingdone', expect.any(Function));

    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const previousMeasurements = measure.mock.calls.length;
    await act(async () => {
      observer.resize();
      window.dispatchEvent(new Event('resize'));
      fonts.dispatchEvent(new Event('loadingdone'));
      resolveFontsReady();
      await fonts.ready;
    });
    expect(measure).toHaveBeenCalledTimes(previousMeasurements);
    expect(document.body.contains(container)).toBe(true);
  });

  it('removes spacing for an empty source and restores it for a new announcement', () => {
    const dismissal = makeDismissal();
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={dismissal} />);
    render(<AnnouncementCenter announcements={[]} dismissal={dismissal} />);
    expect(spacer()).toBeNull();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();

    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={dismissal} />);
    expect(spacer()?.style.height).toBe('53px');
    click(container.querySelector('button[aria-label="关闭公告"]')!);
    render(<AnnouncementCenter announcements={[{ ...ANNOUNCEMENTS[1], id: 'new' }]} dismissal={dismissal} />);
    expect(container.querySelector('.announcement-ticker')).not.toBeNull();
    expect(spacer()?.style.height).toBe('53px');
    expect(dismissal.isDismissed('pinned')).toBe(true);
    expect(dismissal.isDismissed('new')).toBe(false);
  });

  it('keeps only one spacer through StrictMode setup and cleans it on unmount', () => {
    render(<StrictMode><AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} /></StrictMode>);
    expect(document.body.querySelectorAll('.announcement-spacer')).toHaveLength(1);

    render(null);
    expect(spacer()).toBeNull();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('opens the list from the ticker and drills into the detail view', () => {
    render(<AnnouncementCenter announcements={ANNOUNCEMENTS} dismissal={makeDismissal()} />);

    click(trigger());

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

    click(trigger());
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

    click(trigger());
    click(detailButtons()[0]);

    const markdown = container.querySelector('div.overflow-y-auto')!;
    expect(markdown.querySelector('a[href^="https://"]')).toBeNull();
    const blocked = markdown.querySelector('[title]');
    expect(blocked?.textContent).toContain('赞助');
  });
});
