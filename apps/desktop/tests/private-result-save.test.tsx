// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: {} as any, epoch: 0, busy: (() => false) as () => boolean }));
vi.mock('../src/features/account/use-desktop-cloud-session', () => ({ useDesktopCloudSession: () => ({ state: mocks.state, store: { getSnapshot: () => mocks.state, getCredentialEpoch: () => mocks.epoch } }) }));
vi.mock('../src/app/useLeaveGuard', () => ({ useLeaveGuard: (busy: () => boolean) => { mocks.busy = busy; return { ready: true, message: null }; } }));
vi.mock('../src/platform/card-library-host', () => ({ useDesktopCardLibraryHost: () => ({}) }));
vi.mock('../src/features/cloud-save/owned-cards-modal', () => ({ DesktopOwnedCardsModal: ({ isOpen, onClose, selectedType, onReplaceCard }: any) => isOpen ? <div data-testid="own-cloud-library" data-type={selectedType} data-tab="my" data-tabs="my"><button onClick={onClose}>关闭卡库</button>{onReplaceCard && <button onClick={() => void onReplaceCard({ id: 'target', type: selectedType, name: '目标' }).catch(() => {} )}>选择目标</button>}</div> : null }));
import { PrivateResultSave } from '../src/features/cloud-save/private-result-save';
let root: Root; let container: HTMLDivElement;
const invoke = vi.fn(); const onBusyChange = vi.fn();
const data = { name: '结果A', signature: 'original' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const render = (value: unknown = data, cardType: 'character' | 'scenario' = 'character') => act(async () => { root.render(<PrivateResultSave data={value} cardType={cardType} invokeFn={invoke} onBusyChange={onBusyChange} />); await flush(); });
const button = (text: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === text)!;
const click = (text: string) => act(async () => { button(text).click(); await flush(); });
const deferred = () => { let resolve!: (v: unknown) => void; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const writes = () => invoke.mock.calls.filter(([, args]) => args.request.routeId === 'data-cards.create');
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.state = { account: { userId: 7 }, verification: 'verified', authFlow: { kind: 'idle' } }; mocks.epoch = 0; onBusyChange.mockReset();
  invoke.mockReset().mockImplementation(async (_command, args) => args.request.routeId === 'user-capacity.query'
    ? { status: 200, body: { success: true, capacity: 10, usedSlots: 0 } }
    : { status: 201, body: { success: true, id: 'copy', ownerUserId: 7, accountFenceVersion: 1 } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
describe('private result cloud-save UI', () => {
  it('opens actual shared private-only fields, sends nothing until explicit save', async () => {
    await render(); await click('保存到云端'); expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false); expect(writes()).toHaveLength(0);
    await click('保存'); expect(writes()).toHaveLength(1); expect(writes()[0][1].request.body).toMatchObject({ name: '结果A', isPublic: 0, data });
    expect(container.textContent).toContain('本地结果保持不变');
  });
  it('uses scenario title, description, fixed type and matching own-library filter', async () => {
    const scenario = { title: '雨中相会', name: '不应选择角色名', extension: { future: true } };
    await render(scenario, 'scenario'); await click('保存到云端');
    expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('雨中相会');
    invoke.mockResolvedValueOnce({ status: 500, body: {} }); await click('保存');
    expect(writes()[0][1].request.body).toEqual({ type: 'scenario', name: '雨中相会', description: '情景数据卡', data: scenario, isPublic: 0 });
    await click('检查“我的云端卡”'); expect(document.querySelector('[data-testid=own-cloud-library]')?.getAttribute('data-type')).toBe('scenario');
  });
  it.each(['saved', 'pending', 'uncertain'] as const)('resets %s on type-only change without replay or late state', async (ending) => {
    const value = { title: '情景标题', name: '角色标题' };
    await render(value); await click('保存到云端'); const pending = deferred();
    invoke.mockReturnValueOnce(ending === 'pending' ? pending.promise : Promise.resolve({ status: ending === 'saved' ? 201 : 500, body: { success: true, id: 'old', ownerUserId: 7, accountFenceVersion: 1 } }));
    await click('保存'); await render(value, 'scenario');
    if (ending === 'pending') await act(async () => { pending.resolve({ status: 201, body: { success: true, id: 'old', ownerUserId: 7, accountFenceVersion: 1 } }); await flush(); });
    expect(writes()).toHaveLength(1); expect(container.textContent).not.toContain('已保存私有');
    await click('保存到云端'); expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('情景标题'); expect(button('保存').disabled).toBe(false);
  });
  it('ignores late capacity on type-only scope change', async () => {
    const pending = deferred(); invoke.mockReturnValueOnce(pending.promise);
    await render(); await click('保存到云端'); await render(data, 'scenario'); await click('保存到云端');
    await act(async () => { pending.resolve({ status: 200, body: { success: true, capacity: 1, usedSlots: 1 } }); await flush(); });
    expect(button('保存').disabled).toBe(false); expect(document.body.textContent).toContain('0/10 槽');
  });
  it('checks host busy synchronously again at submit instead of trusting rendered disabled', async () => {
    let blocked = false;
    await act(async () => { root.render(<PrivateResultSave data={data} invokeFn={invoke} isBlocked={() => blocked} />); await flush(); });
    await click('保存到云端'); blocked = true; await click('保存'); expect(writes()).toHaveLength(0);
    blocked = false; await click('保存'); expect(writes()).toHaveLength(1);
  });
  it('single-flights repeated clicks, blocks modal dismissal and leaving during create', async () => {
    await render(); await click('保存到云端'); const pending = deferred(); invoke.mockReturnValueOnce(pending.promise);
    await act(async () => { button('保存').click(); button('保存').click(); await flush(); });
    expect(writes()).toHaveLength(1); expect(mocks.busy()).toBe(true); expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush(); });
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await act(async () => { pending.resolve({ status: 400, body: { error: '拒绝' } }); await flush(); });
    expect(mocks.busy()).toBe(false); expect(onBusyChange).toHaveBeenLastCalledWith(false); expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('结果A');
  });
  it('unknown quota remains usable, uncertain POST retains form and requires explicit rearm', async () => {
    invoke.mockRejectedValueOnce(new Error('quota offline')); await render(); await click('保存到云端');
    expect(document.body.textContent).toContain('云端容量未知'); expect(button('保存').disabled).toBe(false);
    invoke.mockResolvedValueOnce({ status: 500, body: { error: 'post insert' } }); await click('保存');
    expect(document.body.textContent).toContain('服务器可能已创建'); expect(button('保存').disabled).toBe(true); expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('结果A');
    await click('取消'); await click('保存到云端'); expect(button('保存').disabled).toBe(true); expect(writes()).toHaveLength(1);
    await click('检查“我的云端卡”'); expect(document.querySelector('[data-testid=own-cloud-library]')?.getAttribute('data-tabs')).toBe('my'); await click('关闭卡库'); vi.spyOn(window, 'confirm').mockReturnValue(true); await click('我已检查，仍要再次新建（可能重复）'); expect(writes()).toHaveLength(1); await click('保存'); expect(writes()).toHaveLength(2);
  });
  it.each(['source', 'account', 'epoch'] as const)('does not surface old write on %s change', async (kind) => {
    await render(); await click('保存到云端'); const pending = deferred(); invoke.mockReturnValueOnce(pending.promise); await click('保存');
    if (kind === 'account') mocks.state = { ...mocks.state, account: { userId: 8 } }; if (kind === 'epoch') mocks.epoch++;
    await render(kind === 'source' ? { name: '结果B' } : data);
    await act(async () => { pending.resolve({ status: 201, body: { success: true, id: 'old', ownerUserId: 7, accountFenceVersion: 1 } }); await flush(); });
    expect(container.textContent).not.toContain('已保存私有'); expect(document.querySelector('[role=dialog]')).toBeNull();
    await click('保存到云端'); expect(document.querySelector<HTMLInputElement>('input')?.value).toBe(kind === 'source' ? '结果B' : '结果A');
  });
  it('does not apply late capacity from an old source', async () => {
    const pending = deferred(); invoke.mockReturnValueOnce(pending.promise); await render(); await click('保存到云端'); await render({ name: '结果B' }); await click('保存到云端');
    await act(async () => { pending.resolve({ status: 200, body: { success: true, capacity: 1, usedSlots: 1 } }); await flush(); });
    expect(button('保存').disabled).toBe(false); expect(document.body.textContent).toContain('0/10 槽');
  });
  it('ignores old quota after same-source close and reopen', async () => {
    const first = deferred(); invoke.mockReturnValueOnce(first.promise);
    await render(); await click('保存到云端'); await click('取消');
    await click('保存到云端');
    await act(async () => { first.resolve({ status: 200, body: { success: true, capacity: 1, usedSlots: 1 } }); await flush(); });
    expect(button('保存').disabled).toBe(false); expect(document.body.textContent).toContain('0/10 槽');
  });
  it('requires verified idle auth before starting any private request', async () => {
    mocks.state.verification = 'unreachable'; await render(); await click('保存到云端'); expect(invoke).not.toHaveBeenCalled();
    mocks.state.verification = 'verified'; mocks.state.authFlow = { kind: 'authenticating' }; await render(); await click('保存到云端'); expect(invoke).not.toHaveBeenCalled();
  });
  it('public creation uses the actual shared visibility field', async () => {
    await render(); await click('保存到云端');
    await act(async () => { document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); await flush(); });
    await click('保存'); expect(writes()[0][1].request.body.isPublic).toBe(1); expect(container.textContent).toContain('公开云端副本已保存');
  });
  const target = { id: 'target', type: 'character', name: '本账号目标', description: '保留描述', isPublic: 1, reviewStatus: 'approved', hasPendingUpdate: true, version: 'a'.repeat(64) };
  const ready = () => ({ status: 200, body: { success: true, ownerUserId: 7, accountFenceVersion: 1, target } });
  const replacements = () => invoke.mock.calls.filter(([, args]) => args.request.routeId === 'data-cards.replace');
  const choose = async () => { await click('替换已有'); invoke.mockResolvedValueOnce(ready()); await click('选择目标'); };
  it('reads target then requires explicit shared confirmation with pending notice', async () => {
    await render(); await choose(); expect(document.body.textContent).toContain('已有待审核版本'); expect(replacements()).toHaveLength(0);
    invoke.mockResolvedValueOnce({ status: 200, body: { success: true, id: 'target', ownerUserId: 7, accountFenceVersion: 1, replacementVersion: 1, pendingReview: true } });
    await click('确认替换'); expect(replacements()).toHaveLength(1);
    expect(replacements()[0][1].request).toEqual({ routeId: 'data-cards.replace', expectedUserId: 7, body: { id: 'target', type: 'character', expectedVersion: target.version, data } });
    expect(document.body.textContent).toContain('更新已提交审核'); expect(data.signature).toBe('original');
  });
  it('duplicate confirm is single-flight and cannot close an in-flight replacement', async () => {
    await render(); await choose(); const pending = deferred(); invoke.mockReturnValueOnce(pending.promise);
    await act(async () => { button('确认替换').click(); button('确认替换').click(); await flush(); });
    expect(replacements()).toHaveLength(1); expect(mocks.busy()).toBe(true);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush(); });
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await act(async () => { pending.resolve({ status: 400, body: { error: '拒绝' } }); await flush(); });
    expect(document.body.textContent).toContain('拒绝'); expect(mocks.busy()).toBe(false); expect(button('确认替换').disabled).toBe(false);
  });
  it('target conflict retains result and requires a fresh preview before another confirm', async () => {
    await render(); await choose(); invoke.mockResolvedValueOnce({ status: 409, body: { error: 'TARGET_CHANGED' } }); await click('确认替换');
    expect(button('确认替换').disabled).toBe(true); expect(replacements()).toHaveLength(1);
    await click('重新选择替换目标'); invoke.mockResolvedValueOnce({ ...ready(), body: { ...ready().body, target: { ...target, version: 'b'.repeat(64) } } }); await click('选择目标');
    expect(replacements()).toHaveLength(1); expect(button('确认替换').disabled).toBe(false);
    invoke.mockResolvedValueOnce({ status: 400, body: {} }); await click('确认替换'); expect(replacements()[1][1].request.body.expectedVersion).toBe('b'.repeat(64));
  });
  it('uncertain replacement stays blocked after cancellation until check and fresh target', async () => {
    await render(); await choose(); invoke.mockResolvedValueOnce({ status: 500, body: {} }); await click('确认替换');
    await click('取消'); await click('替换已有'); expect(button('确认替换').disabled).toBe(true); expect(replacements()).toHaveLength(1);
    await click('检查“我的云端卡”'); expect(button('选择目标')).toBeUndefined(); await click('关闭卡库');
    vi.spyOn(window, 'confirm').mockReturnValue(true); await click('我已检查，重新选择替换目标'); expect(replacements()).toHaveLength(1);
    invoke.mockResolvedValueOnce(ready()); await click('选择目标'); expect(button('确认替换').disabled).toBe(false);
  });
  it('cancel during target read invalidates the late preview without writing', async () => {
    await render(); await click('替换已有'); const pending = deferred(); invoke.mockReturnValueOnce(pending.promise); await click('选择目标'); await click('关闭卡库');
    await act(async () => { pending.resolve(ready()); await flush(); });
    expect(button('确认替换')).toBeUndefined(); expect(replacements()).toHaveLength(0);
  });
  it.each(['source', 'account', 'epoch'] as const)('late replacement cannot claim newer %s scope', async (kind) => {
    await render(); await choose(); const pending = deferred(); invoke.mockReturnValueOnce(pending.promise); await click('确认替换');
    if (kind === 'account') mocks.state = { ...mocks.state, account: { userId: 8 } }; if (kind === 'epoch') mocks.epoch++;
    await render(kind === 'source' ? { name: '另一个结果' } : data);
    await act(async () => { pending.resolve({ status: 200, body: { success: true, id: 'target', ownerUserId: 7, accountFenceVersion: 1, replacementVersion: 1, pendingReview: false } }); await flush(); });
    expect(document.body.textContent).not.toContain('云端数据卡已替换'); expect(document.querySelector('[role=dialog]')).toBeNull(); expect(replacements()).toHaveLength(1);
  });

});
