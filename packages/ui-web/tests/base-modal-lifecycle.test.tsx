// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnnouncementCenter } from '../src/announcement/AnnouncementCenter';
import { BaseModal } from '../src/modal/BaseModal';

let container: HTMLDivElement;
let root: Root;
const announcements = [{ id: 'test', title: '测试公告', content: '正文', date: '2026-10-09' }];

const dismissal = { isDismissed: () => false, markDismissed: vi.fn() };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  document.body.style.overflow = 'auto';
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = '';
});
const render = (node: Parameters<Root['render']>[0]) => act(() => root.render(node));
const click = (node: HTMLElement) => act(() => {
  node.focus();
  node.click();
});

it('keeps the top modal scroll lock when a lower announcement disappears after refresh', () => {
  const mount = (source: typeof announcements, top: boolean) => (
    <>
      <AnnouncementCenter announcements={source} dismissal={dismissal} />
      <BaseModal isOpen={top} title="外链确认" onClose={() => {}}>等待确认</BaseModal>
    </>
  );
  render(mount(announcements, false));
  click(container.querySelector<HTMLButtonElement>('.announcement-trigger')!);
  render(mount(announcements, true));
  const topDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(node => node.textContent?.includes('外链确认'))!;
  expect(topDialog.contains(document.activeElement)).toBe(true);
  render(mount([], true));
  expect(document.body.style.overflow).toBe('hidden');
  expect(topDialog.contains(document.activeElement)).toBe(true);
  render(mount([], false));
  expect(document.body.style.overflow).toBe('auto');
});

it('restores original body scrolling after nested modals unmount together', () => {
  render(<AnnouncementCenter announcements={announcements} dismissal={dismissal} />);
  click(container.querySelector<HTMLButtonElement>('.announcement-trigger')!);
  render(<><AnnouncementCenter announcements={announcements} dismissal={dismissal} /><BaseModal isOpen title="外链确认" onClose={() => {}}>确认</BaseModal></>);
  render(null);
  expect(document.body.style.overflow).toBe('auto');
});

it('keeps focus in a newer modal when a lower modal closes first', () => {
  const mount = (lower: boolean, upper: boolean) => (
    <>
      <button data-opener>页面入口</button>
      <BaseModal isOpen={lower} title="下层" onClose={() => {}}>下层内容</BaseModal>
      <BaseModal isOpen={upper} title="上层" onClose={() => {}}>上层内容</BaseModal>
    </>
  );
  render(mount(false, false));
  container.querySelector<HTMLButtonElement>('[data-opener]')!.focus();
  render(mount(true, false));
  render(mount(true, true));
  const topDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(node => node.textContent?.includes('上层'))!;
  expect(topDialog.contains(document.activeElement)).toBe(true);
  render(mount(false, true));
  expect(topDialog.contains(document.activeElement)).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  render(mount(false, false));
  expect(document.body.style.overflow).toBe('auto');
  expect(document.activeElement).toBe(container.querySelector('[data-opener]'));
});

it('retains the lower modal lock and focus until normal top-down closing completes', () => {
  const mount = (lower: boolean, upper: boolean) => (
    <>
      <button data-opener>页面入口</button>
      <BaseModal isOpen={lower} title="下层" onClose={() => {}}>下层内容</BaseModal>
      <BaseModal isOpen={upper} title="上层" onClose={() => {}}>上层内容</BaseModal>
    </>
  );
  render(mount(false, false));
  const opener = container.querySelector<HTMLButtonElement>('[data-opener]')!;
  opener.focus();
  render(mount(true, false));
  const lowerFocus = document.activeElement;
  render(mount(true, true));
  render(mount(true, false));
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement).toBe(lowerFocus);
  render(mount(false, false));
  expect(document.body.style.overflow).toBe('auto');
  expect(document.activeElement).toBe(opener);
});

it('balances StrictMode subscriptions and preserves an existing host scroll lock', () => {
  document.body.style.overflow = 'hidden';
  render(<StrictMode><BaseModal isOpen title="测试" onClose={() => {}}>内容</BaseModal></StrictMode>);
  render(null);
  expect(document.body.style.overflow).toBe('hidden');
  document.body.style.overflow = 'scroll';
  render(<StrictMode><BaseModal isOpen title="再开" onClose={() => {}}>内容</BaseModal></StrictMode>);
  render(null);
  expect(document.body.style.overflow).toBe('scroll');
});


it('falls back to a surviving lower layer after the middle layer closes first', () => {
  const mount = (lower: boolean, middle: boolean, upper: boolean) => (
    <>
      <button data-opener>页面入口</button>
      <BaseModal isOpen={lower} title="下层" onClose={() => {}}>下层内容</BaseModal>
      <BaseModal isOpen={middle} title="中层" onClose={() => {}}>中层内容</BaseModal>
      <BaseModal isOpen={upper} title="上层" onClose={() => {}}>上层内容</BaseModal>
    </>
  );
  render(mount(false, false, false));
  const opener = container.querySelector<HTMLButtonElement>('[data-opener]')!;
  opener.focus();
  render(mount(true, false, false));
  const lowerFocus = document.activeElement;
  render(mount(true, true, false));
  render(mount(true, true, true));
  const upperFocus = document.activeElement;
  render(mount(true, false, true));
  expect(document.activeElement).toBe(upperFocus);
  render(mount(true, false, false));
  expect(document.activeElement).toBe(lowerFocus);
  expect(document.body.style.overflow).toBe('hidden');
  render(mount(false, false, false));
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).toBe('auto');
});

it('locks the viewport root as well as the body when the host has explicit root overflow', () => {
  const originalRoot = document.documentElement.style.cssText;
  document.documentElement.style.overflowX = 'hidden';
  try {
    render(<BaseModal isOpen title="根滚动容器" onClose={() => {}}>正文</BaseModal>);
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overscrollBehavior).toBe('none');
    render(null);
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.documentElement.style.overflowX).toBe('hidden');
    expect(document.documentElement.style.overscrollBehavior).toBe('');
  } finally {
    render(null);
    document.documentElement.style.cssText = originalRoot;
  }
});

it('preserves inline scroll longhands and priorities without reverting unrelated host changes', () => {
  const originalRoot = document.documentElement.style.cssText;
  const originalBody = document.body.style.cssText;
  const declarations = (element: HTMLElement) => Array.from(element.style)
    .filter(property => property.startsWith('overflow') || property.startsWith('overscroll'))
    .map(property => [property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
  document.documentElement.style.setProperty('overflow-x', 'hidden', 'important');
  document.documentElement.style.setProperty('overflow-y', 'scroll');
  document.documentElement.style.setProperty('overscroll-behavior-y', 'contain', 'important');
  document.body.style.setProperty('overflow', 'scroll', 'important');
  document.body.style.setProperty('overscroll-behavior', 'contain');
  const rootDeclarations = declarations(document.documentElement);
  const bodyDeclarations = declarations(document.body);
  try {
    const mount = (lower: boolean, upper: boolean) => <>
      <BaseModal isOpen={lower} title="下层" onClose={() => {}}>正文</BaseModal>
      <BaseModal isOpen={upper} title="上层" onClose={() => {}}>正文</BaseModal>
    </>;
    render(mount(true, false));
    render(mount(true, true));
    render(mount(false, true));
    expect(document.documentElement.style.overflow).toBe('hidden');
    document.documentElement.style.color = 'red';
    document.body.style.color = 'blue';
    render(null);
    expect(declarations(document.documentElement)).toEqual(rootDeclarations);
    expect(declarations(document.body)).toEqual(bodyDeclarations);
    expect(document.documentElement.style.color).toBe('red');
    expect(document.body.style.color).toBe('blue');
    render(<StrictMode><BaseModal isOpen title="快速重开" onClose={() => {}}>正文</BaseModal></StrictMode>);
    expect(document.documentElement.style.overflow).toBe('hidden');
    render(null);
    expect(declarations(document.documentElement)).toEqual(rootDeclarations);
    expect(declarations(document.body)).toEqual(bodyDeclarations);
  } finally {
    render(null);
    document.documentElement.style.cssText = originalRoot;
    document.body.style.cssText = originalBody;
  }
});

it('does not reposition the page and returns focus without scrolling the opener into view', () => {
  const previousTop = document.documentElement.scrollTop;
  const previousLeft = document.documentElement.scrollLeft;
  const scrollTo = vi.spyOn(window, 'scrollTo');
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  render(<button data-opener>页面入口</button>);
  const opener = container.querySelector<HTMLButtonElement>('[data-opener]')!;
  opener.focus();
  document.documentElement.scrollTop = 840;
  document.documentElement.scrollLeft = 12;
  try {
    render(<><button data-opener>页面入口</button><BaseModal isOpen title="保持位置" onClose={() => {}}>正文</BaseModal></>);
    expect(document.body.style.position).toBe('');
    expect(document.documentElement.scrollTop).toBe(840);
    expect(document.documentElement.scrollLeft).toBe(12);
    render(<button data-opener>页面入口</button>);
    expect(document.activeElement).toBe(opener);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.documentElement.scrollTop).toBe(840);
  } finally {
    document.documentElement.scrollTop = previousTop;
    document.documentElement.scrollLeft = previousLeft;
  }
});

it('exposes the native content scroller as a keyboard stop without swallowing scroll input', () => {
  render(<BaseModal isOpen title="键盘正文" onClose={() => {}}><p>正文</p></BaseModal>);
  const region = document.querySelector<HTMLElement>('[role="dialog"] [role="region"]')!;
  expect(region.tabIndex).toBe(0);
  expect(region.classList.contains('overflow-auto')).toBe(true);
  expect(region.classList.contains('overscroll-contain')).toBe(true);
  region.focus();
  for (const key of ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    region.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  for (const type of ['wheel', 'touchmove']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    region.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
});
