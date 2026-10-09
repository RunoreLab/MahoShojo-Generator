// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: {} as any, epoch: 0, busy: (() => false) as () => boolean, confirmLeave: (() => false) as () => boolean }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../src/features/account/use-desktop-cloud-session', () => ({ useDesktopCloudSession: () => ({
  state: mocks.state, store: { getSnapshot: () => mocks.state, getCredentialEpoch: () => mocks.epoch },
}) }));
vi.mock('../src/app/useLeaveGuard', () => ({ useLeaveGuard: (busy: () => boolean, _message: string, _failure: string, confirmLeave: () => boolean) => { mocks.busy = busy; mocks.confirmLeave = confirmLeave; return { ready: true, message: null }; } }));
import { ProfileSignaturePanel } from '../src/features/account/ProfileSignaturePanel';
import { getCachedMyProfile, getTopbarAvatar, invalidateTopbarAvatar, resetTopbarAvatarForTests } from '../src/features/account/use-topbar-avatar';
let root: Root; let container: HTMLDivElement;
const avatar = 'data:image/webp;base64,QUJD';
const render = () => act(async () => { root.render(<ProfileSignaturePanel />); await new Promise((resolve) => setTimeout(resolve, 0)); });
const edit = (value: string) => act(() => { const textarea = container.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
const saveButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent === '保存')!;
const clickSave = () => act(async () => { saveButton().click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  resetTopbarAvatarForTests(); mocks.epoch = 0;
  mocks.state = { account: { userId: 1, username: 'A' }, verification: 'verified', authFlow: { kind: 'idle' } };
  mocks.invoke.mockReset(); mocks.invoke.mockImplementation(async (command, args) => command === 'cloud_me_profile'
    ? { userId: mocks.state.account.userId, signature: '线上签名', avatarDataUrl: avatar }
    : { userId: args.request.expectedUserId, signature: args.request.signature });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('Desktop profile signature host', () => {
  it('loads the shared field and updates the same profile/topbar cache only after confirmed PUT', async () => {
    await render(); expect(container.querySelector('textarea')?.value).toBe('线上签名'); expect(mocks.busy()).toBe(false);
    edit('新签名'); expect(mocks.busy()).toBe(true); await clickSave();
    expect(mocks.invoke).toHaveBeenCalledWith('cloud_save_me_profile_signature', { request: { expectedUserId: 1, signature: '新签名' } });
    expect(getCachedMyProfile(1)?.signature).toBe('新签名'); expect(getTopbarAvatar(1)).toBe(avatar);
    expect(container.textContent).toContain('已保存'); expect(mocks.busy()).toBe(false);
  });
  it('does not write from cached/unverified identity; draft stays for explicit save after verification', async () => {
    mocks.state.verification = 'unreachable'; await render(); edit('离线草稿'); expect(saveButton().disabled).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_save_me_profile_signature')).toHaveLength(0);
    mocks.state = { ...mocks.state, verification: 'verified' }; await render();
    expect(container.querySelector('textarea')?.value).toBe('离线草稿'); expect(saveButton().disabled).toBe(false);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_save_me_profile_signature')).toHaveLength(0);
  });
  it('keeps failed writes dirty and retries only when clicked', async () => {
    await render(); edit('草稿'); mocks.invoke.mockRejectedValueOnce({ code: 'network-error', message: '连接中断' }); await clickSave();
    expect(container.querySelector('textarea')?.value).toBe('草稿'); expect(container.querySelector('[role="status"]')?.textContent ?? '').not.toContain('已保存'); expect(mocks.busy()).toBe(true);
    await render(); expect(mocks.invoke).toHaveBeenCalledTimes(2); await clickSave(); expect(mocks.invoke).toHaveBeenCalledTimes(3); expect(container.textContent).toContain('已保存');
  });
  it('reads back after an uncertain write without replay and preserves a different local draft', async () => {
    await render(); edit('本地草稿'); mocks.invoke.mockRejectedValueOnce({ code: 'network-error', message: '连接中断' }); await clickSave();
    mocks.invoke.mockResolvedValueOnce({ userId: 1, signature: '另一端签名', avatarDataUrl: avatar });
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '读取线上签名')!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector('textarea')?.value).toBe('本地草稿'); expect(getCachedMyProfile(1)?.signature).toBe('另一端签名');
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_save_me_profile_signature')).toHaveLength(1);
    expect(container.textContent).toContain('线上签名已变化');
  });
  it.each(['switch', 'relogin', 'logout'] as const)('discards late A write after %s, including old cache', async (kind) => {
    await render(); edit('A草稿'); const pending = deferred<unknown>(); mocks.invoke.mockReturnValueOnce(pending.promise); await clickSave();
    expect(mocks.confirmLeave()).toBe(false);
    act(() => invalidateTopbarAvatar(1)); mocks.epoch += 1;
    mocks.state = { ...mocks.state, account: kind === 'logout' ? null : { userId: kind === 'switch' ? 2 : 1, username: 'new' } };
    await render(); if (kind !== 'logout') edit('新草稿');
    await act(async () => pending.resolve({ userId: 1, signature: '迟到A' }));
    expect(getCachedMyProfile(1)?.signature).not.toBe('迟到A'); expect(getCachedMyProfile(2)?.signature).not.toBe('迟到A');
    expect(container.querySelector('textarea')?.value).toBe(kind === 'logout' ? undefined : '新草稿'); expect(container.querySelector('[role="status"]')?.textContent ?? '').not.toContain('已保存');
  });
});
