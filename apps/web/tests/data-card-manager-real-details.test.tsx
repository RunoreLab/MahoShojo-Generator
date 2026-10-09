// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DataCardsModal from '@/components/CharManager/DataCardsModal';
import { authStorage } from '@/lib/auth';
vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
let root: Root; let container: HTMLDivElement;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;
const focusable = (dialog: Element) => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(authStorage, 'getAuthHeader').mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: '测试离线' })));
  document.body.style.overflow = 'auto'; container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('真实 Web 管理→详情嵌套：Tab留在最上层，Escape逐层关闭，滚动与焦点最终恢复', async () => {
  const row = { id: 'owned-real', name: '真实详情卡', description: '', type: 'character', data: '{"name":"真实内容","content":"保留正文"}', is_public: 0, review_status: 'approved' };
  function Harness() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>打开管理</button><DataCardsModal isOpen={open} onClose={() => setOpen(false)} dataCards={[row]} currentPage={1} onPageChange={() => {}} cardsPerPage={12} /></>; }
  await act(async () => { root.render(<Harness />); }); button('打开管理').focus(); await act(async () => { button('打开管理').click(); });
  const detailsButton = button('详情'); detailsButton.focus(); await act(async () => { detailsButton.click(); });
  const dialogs = document.querySelectorAll<HTMLElement>('[role=dialog]'); expect(dialogs).toHaveLength(2);
  const detail = dialogs[1]; expect(detail.textContent).toContain('保留正文'); expect(detail.contains(document.activeElement)).toBe(true);
  const stops = focusable(detail); stops.at(-1)!.focus();
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
  expect(detail.contains(document.activeElement)).toBe(true); expect(document.activeElement).toBe(stops[0]);
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); });
  expect(document.activeElement).toBe(stops.at(-1));
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1); expect(document.body.style.overflow).toBe('hidden'); expect(document.activeElement).toBe(detailsButton);
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(document.body.style.overflow).toBe('auto'); expect(document.activeElement).toBe(button('打开管理'));
});
