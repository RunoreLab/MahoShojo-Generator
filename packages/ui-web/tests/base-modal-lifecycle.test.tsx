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
