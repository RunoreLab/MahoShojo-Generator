// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: {} as any, epoch: 0, busy: (() => false) as () => boolean }));
vi.mock('../src/features/account/use-desktop-cloud-session', () => ({ useDesktopCloudSession: () => ({ state: mocks.state, store: { getSnapshot: () => mocks.state, getCredentialEpoch: () => mocks.epoch } }) }));
vi.mock('../src/app/useLeaveGuard', () => ({ useLeaveGuard: (busy: () => boolean) => { mocks.busy = busy; return { ready: true, message: null }; } }));
vi.mock('../src/platform/card-library-host', () => ({ useDesktopCardLibraryHost: () => ({}) }));
vi.mock('@mahoshojo/ui-web/card-library', () => ({ CardLibraryModal: ({ isOpen, onClose, initialTab, visibleTabs }: any) => isOpen ? <div data-testid="own-cloud-library" data-tab={initialTab} data-tabs={visibleTabs.join(',')}><button onClick={onClose}>关闭卡库</button></div> : null }));
import { PrivateResultSave } from '../src/features/cloud-save/private-result-save';
let root: Root; let container: HTMLDivElement;
const invoke = vi.fn(); const onBusyChange = vi.fn();
const data = { name: '结果A', signature: 'original' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const render = (value: unknown = data) => act(async () => { root.render(<PrivateResultSave data={value} invokeFn={invoke} onBusyChange={onBusyChange} />); await flush(); });
const button = (text: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === text)!;
const click = (text: string) => act(async () => { button(text).click(); await flush(); });
const deferred = () => { let resolve!: (v: unknown) => void; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const writes = () => invoke.mock.calls.filter(([, args]) => args.request.routeId === 'data-cards.create');
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.state = { account: { userId: 7 }, verification: 'verified', authFlow: { kind: 'idle' } }; mocks.epoch = 0; onBusyChange.mockReset();
  invoke.mockReset().mockImplementation(async (_command, args) => args.request.routeId === 'user-capacity.query'
    ? { status: 200, body: { success: true, capacity: 10, usedSlots: 0 } }
    : { status: 201, body: { success: true, id: 'copy' } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
describe('private result cloud-save UI', () => {
  it('opens actual shared private-only fields, sends nothing until explicit save', async () => {
    await render(); await click('保存私有云端副本'); expect(document.querySelector('input[type=checkbox]')).toBeNull(); expect(writes()).toHaveLength(0);
    await click('保存'); expect(writes()).toHaveLength(1); expect(writes()[0][1].request.body).toMatchObject({ name: '结果A', isPublic: false, data });
    expect(container.textContent).toContain('本地结果保持不变');
  });
  it('single-flights repeated clicks, blocks modal dismissal and leaving during create', async () => {
    await render(); await click('保存私有云端副本'); const pending = deferred(); invoke.mockReturnValueOnce(pending.promise);
    await act(async () => { button('保存').click(); button('保存').click(); await flush(); });
    expect(writes()).toHaveLength(1); expect(mocks.busy()).toBe(true); expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush(); });
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await act(async () => { pending.resolve({ status: 400, body: { error: '拒绝' } }); await flush(); });
    expect(mocks.busy()).toBe(false); expect(onBusyChange).toHaveBeenLastCalledWith(false); expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('结果A');
  });
  it('unknown quota remains usable, uncertain POST retains form and requires explicit rearm', async () => {
    invoke.mockRejectedValueOnce(new Error('quota offline')); await render(); await click('保存私有云端副本');
    expect(document.body.textContent).toContain('云端容量未知'); expect(button('保存').disabled).toBe(false);
    invoke.mockResolvedValueOnce({ status: 500, body: { error: 'post insert' } }); await click('保存');
    expect(document.body.textContent).toContain('服务器可能已创建'); expect(button('保存').disabled).toBe(true); expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('结果A');
    await click('取消'); await click('保存私有云端副本'); expect(button('保存').disabled).toBe(true); expect(writes()).toHaveLength(1);
    await click('检查“我的云端卡”'); expect(document.querySelector('[data-testid=own-cloud-library]')?.getAttribute('data-tabs')).toBe('my'); await click('关闭卡库'); vi.spyOn(window, 'confirm').mockReturnValue(true); await click('我已检查，仍要再次新建（可能重复）'); expect(writes()).toHaveLength(1); await click('保存'); expect(writes()).toHaveLength(2);
  });
  it.each(['source', 'account', 'epoch'] as const)('does not surface old write on %s change', async (kind) => {
    await render(); await click('保存私有云端副本'); const pending = deferred(); invoke.mockReturnValueOnce(pending.promise); await click('保存');
    if (kind === 'account') mocks.state = { ...mocks.state, account: { userId: 8 } }; if (kind === 'epoch') mocks.epoch++;
    await render(kind === 'source' ? { name: '结果B' } : data);
    await act(async () => { pending.resolve({ status: 201, body: { success: true, id: 'old' } }); await flush(); });
    expect(container.textContent).not.toContain('已保存私有'); expect(document.querySelector('[role=dialog]')).toBeNull();
    await click('保存私有云端副本'); expect(document.querySelector<HTMLInputElement>('input')?.value).toBe(kind === 'source' ? '结果B' : '结果A');
  });
  it('does not apply late capacity from an old source', async () => {
    const pending = deferred(); invoke.mockReturnValueOnce(pending.promise); await render(); await click('保存私有云端副本'); await render({ name: '结果B' }); await click('保存私有云端副本');
    await act(async () => { pending.resolve({ status: 200, body: { success: true, capacity: 1, usedSlots: 1 } }); await flush(); });
    expect(button('保存').disabled).toBe(false); expect(document.body.textContent).toContain('0/10 槽');
  });
  it('ignores old quota after same-source close and reopen', async () => {
    const first = deferred(); invoke.mockReturnValueOnce(first.promise);
    await render(); await click('保存私有云端副本'); await click('取消');
    await click('保存私有云端副本');
    await act(async () => { first.resolve({ status: 200, body: { success: true, capacity: 1, usedSlots: 1 } }); await flush(); });
    expect(button('保存').disabled).toBe(false); expect(document.body.textContent).toContain('0/10 槽');
  });
  it('requires verified idle auth before starting any private request', async () => {
    mocks.state.verification = 'unreachable'; await render(); await click('保存私有云端副本'); expect(invoke).not.toHaveBeenCalled();
    mocks.state.verification = 'verified'; mocks.state.authFlow = { kind: 'authenticating' }; await render(); await click('保存私有云端副本'); expect(invoke).not.toHaveBeenCalled();
  });
});
