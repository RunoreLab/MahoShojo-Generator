// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import { authStorage, dataCardApi } from '@/lib/auth';
const mocks = vi.hoisted(() => ({ user: { id: 7 }, check: vi.fn(), push: vi.fn(), picker: null as any }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: mocks.user, authSource: 'legacy-bearer' }) }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: mocks.check }));
vi.mock('@/components/CharManager/DataCardsModal', () => ({ default: (props: any) => { mocks.picker = props; return props.isOpen ? <div><button onClick={() => void props.onReplaceCard({ id: 'target', type: 'character' })}>选择目标</button><button onClick={props.onClose}>关闭列表</button></div> : null; } }));
const auth = { userId: 7, username: 'owner', authKey: 'mock-only' };
const target = { id: 'target', type: 'character', name: '本账号目标', description: '保留描述', isPublic: 1, reviewStatus: 'approved', hasPendingUpdate: true, version: 'a'.repeat(64) };
const ready = { success: true, accountFenceVersion: 1, ownerUserId: 7, target };
const ack = { success: true, id: 'target', accountFenceVersion: 1, ownerUserId: 7, replacementVersion: 1, pendingReview: true };
let root: Root; let container: HTMLDivElement;
const data = { name: '当前结果', extra: { full: true } };
const fetcher = vi.fn();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const render = (value: unknown = data) => act(async () => { root.render(<SaveToCloudButton data={value} />); await flush(); });
const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === label)!;
const click = (label: string) => act(async () => { expect(button(label), label).toBeTruthy(); button(label).click(); await flush(); });
const choose = async () => { await click('替换已有'); await click('选择目标'); };
const writes = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
const deferred = () => { let resolve!: (response: Response) => void; const promise = new Promise<Response>((yes) => { resolve = yes; }); return { promise, resolve }; };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.user = { id: 7 }; mocks.check.mockReset().mockResolvedValue({ hasSensitiveWords: false });
  vi.spyOn(authStorage, 'getAuth').mockResolvedValue(auth); vi.spyOn(dataCardApi, 'getUserCapacity').mockResolvedValue({ capacity: 20, usedSlots: 2 });
  fetcher.mockReset().mockImplementation(async (_url, init) => Response.json(init?.method === 'PUT' ? ack : ready)); vi.stubGlobal('fetch', fetcher);
  vi.spyOn(window, 'alert').mockImplementation(() => {}); vi.spyOn(window, 'confirm').mockReturnValue(true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Web result actual owned API and shared confirmation', () => {
  test('selection previews owner/version then explicit confirm replaces frozen data', async () => {
    await render(); await choose(); expect(writes()).toHaveLength(0); expect(document.body.textContent).toContain('已有待审核版本');
    await click('确认替换'); expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe('/api/data-cards/replace-owned');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ id: 'target', type: 'character', expectedUserId: 7, expectedVersion: target.version, data });
    expect(window.alert).toHaveBeenCalledWith('更新已提交审核，审核通过后生效');
  });
  test('duplicate confirm and Escape cannot cancel the in-flight mutation', async () => {
    await render(); await choose(); const pending = deferred(); fetcher.mockReturnValueOnce(pending.promise);
    await act(async () => { button('确认替换').click(); button('确认替换').click(); await flush(); });
    expect(writes()).toHaveLength(1);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush(); });
    expect(button('替换中...').disabled).toBe(true);
    await act(async () => { pending.resolve(Response.json(ack)); await flush(); });
    expect(button('确认替换')).toBeUndefined();
  });
  test('unknown result stays blocked through close/reopen, no fallback or repeat', async () => {
    await render(); await choose(); fetcher.mockResolvedValueOnce(Response.json({}, { status: 500 })); await click('确认替换');
    expect(button('确认替换').disabled).toBe(true); await click('取消'); await click('替换已有');
    expect(button('确认替换').disabled).toBe(true); expect(writes()).toHaveLength(1);
    expect(writes().every(([url]) => url.endsWith('/replace-owned'))).toBe(true);
    await act(async () => { document.querySelector<HTMLAnchorElement>('a[href="/character-manager"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await flush(); });
    await click('我已检查，重新选择目标'); expect(writes()).toHaveLength(1); await click('选择目标'); expect(button('确认替换').disabled).toBe(false);
  });
  test('version conflict requires another preview and confirmation', async () => {
    await render(); await choose(); fetcher.mockResolvedValueOnce(Response.json({ error: 'TARGET_CHANGED' }, { status: 409 })); await click('确认替换');
    expect(button('确认替换').disabled).toBe(true); await click('重新选择替换目标');
    fetcher.mockResolvedValueOnce(Response.json({ ...ready, target: { ...target, version: 'b'.repeat(64) } })); await click('选择目标'); await click('确认替换');
    expect(JSON.parse(writes()[1][1].body).expectedVersion).toBe('b'.repeat(64));
  });
  test.each(['source', 'account'])('late successful write cannot claim changed %s', async (kind) => {
    await render(); await choose(); const pending = deferred(); fetcher.mockReturnValueOnce(pending.promise); await click('确认替换');
    if (kind === 'account') mocks.user = { id: 8 };
    await render(kind === 'source' ? { name: '另一个结果' } : data);
    await act(async () => { pending.resolve(Response.json(ack)); await flush(); });
    expect(window.alert).not.toHaveBeenCalled(); expect(button('确认替换')).toBeUndefined(); expect(writes()).toHaveLength(1);
  });
  test('cancel during preview discards late target and never writes', async () => {
    await render(); await click('替换已有'); const pending = deferred(); fetcher.mockReturnValueOnce(pending.promise); await click('选择目标'); await click('关闭列表');
    await act(async () => { pending.resolve(Response.json(ready)); await flush(); });
    expect(button('确认替换')).toBeUndefined(); expect(writes()).toHaveLength(0);
  });
  test('credential changes during confirmation precheck do not dispatch', async () => {
    await render(); await choose(); vi.spyOn(authStorage, 'getAuth').mockResolvedValue({ ...auth, authKey: 'changed-mock' }); await click('确认替换');
    expect(writes()).toHaveLength(0); expect(document.body.textContent).toContain('登录状态已改变');
  });
});
