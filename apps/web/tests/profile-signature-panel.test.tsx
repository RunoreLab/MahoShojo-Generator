// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/components/me/useMeProfile', () => ({ useMeProfile: () => mocked.value }));
import { ProfileSettingsPanel } from '@/components/me/ProfileSettingsPanel';
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  mocked.value = { profile: { signature: '', avatarDataUrl: null }, loaded: false, isLoading: true,
    saveSignature: vi.fn(), isSavingSignature: false, uploadAvatar: vi.fn(), clearAvatar: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = () => act(async () => root.render(<ProfileSettingsPanel userId={1} />));
it('fills a nonempty signature on first asynchronous profile load', async () => {
  await render(); mocked.value = { ...mocked.value, profile: { signature: '服务端签名', avatarDataUrl: null }, loaded: true, isLoading: false };
  await render(); expect(container.querySelector('textarea')?.value).toBe('服务端签名');
});
it('never reports saved merely because a failed request finished', async () => {
  mocked.value = { ...mocked.value, loaded: true, isLoading: false }; await render();
  const textarea = container.querySelector('textarea')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '保留草稿'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  mocked.value = { ...mocked.value, isSavingSignature: true }; await render();
  mocked.value = { ...mocked.value, isSavingSignature: false, error: '保存失败' }; await render();
  expect(container.querySelector('textarea')?.value).toBe('保留草稿');
  expect(container.textContent).not.toContain('已保存');
});

it('blocks link navigation while PUT is pending and keeps dirty leave confirmation after failure', async () => {
  let reject!: (cause: Error) => void;
  mocked.value = { ...mocked.value, loaded: true, isLoading: false, saveSignature: () => new Promise((_resolve, fail) => { reject = fail; }) };
  await render(); const textarea = container.querySelector('textarea')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '草稿'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '保存')!.click());
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const link = document.createElement('a'); link.href = '/other'; document.body.append(link);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true }); act(() => link.dispatchEvent(click));
  expect(click.defaultPrevented).toBe(true); expect(confirm).not.toHaveBeenCalled();
  await act(async () => reject(new Error('连接中断')));
  const failedClick = new MouseEvent('click', { bubbles: true, cancelable: true }); act(() => link.dispatchEvent(failedClick));
  expect(failedClick.defaultPrevented).toBe(true); expect(confirm).toHaveBeenCalledTimes(1); link.remove();
});
