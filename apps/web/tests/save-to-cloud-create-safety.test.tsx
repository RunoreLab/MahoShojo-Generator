// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import SaveToCloudButton from '@/components/SaveToCloudButton';

const mocks = vi.hoisted(() => ({
  auth: { userId: 7, username: 'owner', authKey: 'mock' },
  user: { id: 7 },
  modal: null as any,
  create: vi.fn(), capacity: vi.fn(), check: vi.fn(), push: vi.fn(), getAuth: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: mocks.user, authSource: 'legacy-bearer' }) }));
vi.mock('@/lib/auth', () => ({ authStorage: { getAuth: mocks.getAuth }, dataCardApi: { getUserCapacity: mocks.capacity, createCard: mocks.create } }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: mocks.check }));
vi.mock('@/components/CharManager/SaveCardModal', () => ({ default: (props: any) => { mocks.modal = props; return props.isOpen ? <div data-modal>{props.supplementaryContent}</div> : null; } }));
vi.mock('@/components/CharManager/DataCardsModal', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
let root: Root;
let container: HTMLDivElement;
const render = async (props: any = {}) => act(async () => { root.render(<SaveToCloudButton data={{ name: 'result' }} {...props} />); });
const open = async () => act(async () => { container.querySelector('button')!.click(); });
const submit = async () => act(async () => { await mocks.modal.onSave(); });
beforeEach(() => {
  mocks.user = { id: 7 };
  mocks.getAuth.mockResolvedValue(mocks.auth);
  mocks.capacity.mockResolvedValue({ capacity: 20, usedSlots: 2 });
  mocks.check.mockResolvedValue({ hasSensitiveWords: false });
  mocks.create.mockResolvedValue({ success: true, id: 'new-card' });
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('Web explicit create lifecycle', () => {
  it('guards double open and late getData across source changes', async () => {
    const pending = deferred<any>(); const getData = vi.fn(() => pending.promise);
    await render({ getData });
    await act(async () => { container.querySelector('button')!.click(); container.querySelector('button')!.click(); });
    expect(getData).toHaveBeenCalledTimes(1);
    await render({ data: { name: 'next-result' }, getData });
    await act(async () => pending.resolve({ name: 'old-result' }));
    expect(mocks.modal.isOpen).toBe(false);
    expect(mocks.capacity).not.toHaveBeenCalled();
  });
  it('does not discard drafts because getData callback identity changed', async () => {
    await render({ getData: async () => ({ name: 'prepared' }) }); await open();
    await act(async () => mocks.modal.onNameChange('custom'));
    await render({ getData: async () => ({ name: 'prepared' }) });
    expect(mocks.modal.isOpen).toBe(true); expect(mocks.modal.name).toBe('custom');
  });
  it('freezes form and data, guards double submit and close while saving', async () => {
    const check = deferred<any>(); mocks.check.mockReturnValue(check.promise);
    const data = { name: 'result', nested: { value: 1 } };
    await render({ data }); await open();
    await act(async () => { void mocks.modal.onSave(); void mocks.modal.onSave(); mocks.modal.onClose(); mocks.modal.onNameChange('changed'); });
    expect(mocks.modal.isOpen).toBe(true); expect(mocks.modal.isSaving).toBe(true);
    data.nested.value = 2;
    await act(async () => check.resolve({ hasSensitiveWords: false }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0].slice(0, 5)).toEqual(['character', 'result', '角色数据卡', { name: 'result', nested: { value: 1 } }, 0]);
  });
  it('ignores old capacity and clears prepared data on source change', async () => {
    const capacity = deferred<any>(); mocks.capacity.mockReturnValueOnce(capacity.promise);
    await render(); await open();
    expect(mocks.modal.userCapacity).toBeUndefined();
    await render({ data: { name: 'new' } }); await open();
    await act(async () => capacity.resolve({ capacity: 999, usedSlots: 998 }));
    expect(mocks.modal.data).toEqual({ name: 'new' }); expect(mocks.modal.userCapacity).toBe(20);
  });
  it('keeps unknown capacity unknown and preserves rejected drafts', async () => {
    mocks.capacity.mockResolvedValue(null); mocks.create.mockResolvedValue({ success: false, error: 'denied' });
    await render(); await open();
    await act(async () => { mocks.modal.onNameChange('draft'); mocks.modal.onDescriptionChange('draft description'); });
    await submit();
    expect(mocks.modal.usedSlots).toBeUndefined(); expect(mocks.modal.userCapacity).toBeUndefined();
    expect(mocks.modal.name).toBe('draft'); expect(mocks.modal.description).toBe('draft description');
    await act(async () => mocks.modal.onClose()); await open(); expect(mocks.modal.name).toBe('draft');
  });
  it('requires checking own cards and explicit decision before retrying uncertainty', async () => {
    mocks.create.mockResolvedValue({ success: false, uncertain: true });
    await render(); await open(); await submit(); await submit();
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.modal.submitDisabled).toBe(true);
    await act(async () => mocks.modal.onClose()); await open(); await submit();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await act(async () => { container.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('已检查'))!.click(); });
    await submit(); expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it('account change during sensitive check cannot submit old data', async () => {
    const check = deferred<any>(); mocks.check.mockReturnValue(check.promise);
    await render(); await open(); await act(async () => { void mocks.modal.onSave(); });
    mocks.user = { id: 8 }; await render();
    await act(async () => check.resolve({ hasSensitiveWords: false }));
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.modal.isOpen).toBe(false);
  });
  it('same-owner credential changes cannot show a stale success', async () => {
    const create = deferred<any>(); mocks.create.mockReturnValue(create.promise);
    await render(); await open(); await act(async () => { void mocks.modal.onSave(); });
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, authKey: 'new-mock' });
    await act(async () => create.resolve({ success: true, id: 'old-created' }));
    expect(window.alert).not.toHaveBeenCalled(); expect(mocks.modal.submitDisabled).toBe(true);
  });
  it('retains host sensitive-word navigation and blocks the create', async () => {
    mocks.check.mockResolvedValue({ hasSensitiveWords: true });
    await render(); await open(); await submit();
    expect(mocks.push).toHaveBeenCalledWith('/arrested'); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('source change during POST suppresses stale success', async () => {
    const create = deferred<any>(); mocks.create.mockReturnValue(create.promise);
    await render(); await open(); await act(async () => { void mocks.modal.onSave(); });
    await render({ data: { name: 'new-result' } });
    await act(async () => create.resolve({ success: true, id: 'old-created' }));
    expect(window.alert).not.toHaveBeenCalled(); expect(mocks.modal.isOpen).toBe(false);
  });
});
