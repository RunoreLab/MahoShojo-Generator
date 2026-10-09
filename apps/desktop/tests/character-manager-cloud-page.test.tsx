// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopRouter } from '../src/app/router';
import { getDesktopCloudSessionStore, resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';
import { DESKTOP_CHARACTER_MANAGER_DRAFT_KEY } from '../src/features/character-manager/draft-persistence';
const mock = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: mock.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mock.listen }) }));
vi.mock('../src/platform/desktop-archive-host', () => ({ createDesktopArchiveHost: () => ({ probeStorage: async () => null }), DESKTOP_LIBRARY_ARCHIVE_LIMITS: { fileBytes: 1024 } }));
let root: Root; let container: HTMLDivElement; let accountId: number;
const listeners = new Set<(event: { preventDefault: () => void }) => void>();
const sample = { templateId: '通用角色', name: '本地编辑稿', content: '未保存的正文', signature: 'keep-evidence' };
const target = { id: 'owned-target', type: 'character', name: '原云端卡', description: '保留描述', isPublic: 1, reviewStatus: 'approved', hasPendingUpdate: true, version: 'c'.repeat(64) };
const row = { id: target.id, user_id: 7, type: 'character', name: target.name, description: target.description, is_public: 1, review_status: 'approved', created_at: null, updated_at: null, usage_count: 0, like_count: 0, favorite_count: 0, is_recommended: 0, username: 'tester', roleType: 'general', nativeAllowed: false, has_pending_update: true, tag_ids: [], favorited_at: null };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;
const click = (label: string) => act(async () => { button(label).click(); });
const waitFor = async (test: () => boolean) => { const until = Date.now() + 5000; while (!test()) { if (Date.now() > until) throw new Error('等待角色管理云卡页面超时'); await act(async () => { await new Promise((done) => setTimeout(done, 15)); }); } };
const requests = (route: string) => mock.invoke.mock.calls.filter(([command, args]) => command === 'cloud_card_library_request' && args?.request?.routeId === route);
const mount = async () => { window.location.hash = '#/character-manager'; const router = createDesktopRouter(); await router.load(); await act(async () => { root.render(<RouterProvider router={router} />); }); await waitFor(() => !!button('保存到云端') && !button('保存到云端').disabled && !!button('我的数据卡')); return router; };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); accountId = 7; resetDesktopCloudSessionStoreForTests(); listeners.clear(); mock.invoke.mockReset(); mock.listen.mockReset();
  localStorage.setItem(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY, JSON.stringify({ version: 1, updatedAt: Date.now(), payload: { pastedJson: '', draft: { originalId: null, cardType: 'character', title: '本地编辑稿', data: sample, originalData: sample } } }));
  mock.listen.mockImplementation(async (handler) => { listeners.add(handler); return () => listeners.delete(handler); });
  mock.invoke.mockImplementation(async (command, args) => {
    const account = { userId: accountId, username: 'tester' }; const sessionExpiresAt = '2026-12-31T00:00:00.000Z';
    if (command === 'cloud_cached_account') return { account, sessionExpiresAt };
    if (command === 'cloud_auth_status') return { state: 'active', account, sessionExpiresAt };
    if (command === 'list_local_cards') return { documents: [] };
    if (command === 'list_local_backups') return { backups: [], invalidCount: 0 };
    if (command === 'cloud_card_library_request') {
      const request = args.request;
      if (request.routeId === 'user-capacity.query') return { status: 200, body: { success: true, capacity: 20, usedSlots: 1 } };
      if (request.routeId === 'data-cards.query') return { status: 200, body: request.query?.id ? { success: true, card: { ...row, data: JSON.stringify({ ...sample, name: '云端载入稿', content: '云端正文' }) } } : { success: true, cards: [row], total: 1, nextOffset: null } };
      if (request.routeId === 'data-cards.replace-target.query') return { status: 200, body: { success: true, accountFenceVersion: 1, ownerUserId: accountId, target } };
      if (request.routeId === 'data-cards.create') return { status: 201, body: { success: true, accountFenceVersion: 1, ownerUserId: accountId, id: 'new-card' } };
      if (request.routeId === 'data-cards.replace') return { status: 200, body: { success: true, accountFenceVersion: 1, ownerUserId: accountId, id: target.id, replacementVersion: 1, pendingReview: true } };
      return { status: 200, body: { success: true, items: {} } };
    }
    return undefined;
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); vi.spyOn(window, 'confirm').mockReturnValue(false);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
describe('Desktop真实角色管理云写宿主与Native模拟边界', () => {
  it('公开上传使用共享表单和owner IPC，未知/失败保稿；唯一关窗守卫同时覆盖本地dirty和云写', async () => {
    await mount(); expect(listeners.size).toBe(1); const blocked = vi.fn(); await act(async () => { listeners.forEach((listener) => listener({ preventDefault: blocked })); }); expect(blocked).toHaveBeenCalledOnce();
    await click('保存到云端'); const pending = deferred<unknown>(); const fallback = mock.invoke.getMockImplementation()!; mock.invoke.mockImplementation((command, args) => command === 'cloud_card_library_request' && args.request.routeId === 'data-cards.create' ? pending.promise : fallback(command, args));
    await act(async () => { (document.querySelector('[role=dialog] input[type=checkbox]') as HTMLInputElement).click(); button('保存').click(); button('保存').click(); });
    expect(requests('data-cards.create')).toHaveLength(1); expect(requests('data-cards.create')[0][1].request).toMatchObject({ expectedUserId: 7, body: { isPublic: 1, data: sample } });
    const nativeBlocked = vi.fn(); await act(async () => { listeners.forEach((listener) => listener({ preventDefault: nativeBlocked })); }); expect(nativeBlocked).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLFieldSetElement>('fieldset[disabled]')).not.toBeNull();
    await act(async () => { pending.resolve({ status: 400, body: { error: '容量不足' } }); });
    expect(document.body.textContent).toContain('容量不足'); expect(document.querySelector<HTMLInputElement>('[role=dialog] input')?.value).toBe('本地编辑稿');
    expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('本地编辑稿'); expect(mock.invoke.mock.calls.some(([command]) => command === 'save_local_card')).toBe(false);
  });
  it('顶部我的数据卡打开Web同源管理，替换先读真实版本、取消零写，再确认回显待审', async () => {
    await mount(); await click('我的数据卡'); await waitFor(() => !!button('替换')); expect(button('修改信息')).toBeUndefined(); expect(button('删除')).toBeUndefined();
    await click('替换'); await waitFor(() => !!button('确认替换')); expect(requests('data-cards.replace-target.query')).toHaveLength(1); expect(requests('data-cards.replace')).toHaveLength(0); await click('取消');
    await click('我的数据卡'); await waitFor(() => !!button('替换')); await click('替换'); await waitFor(() => !!button('确认替换')); await click('确认替换');
    expect(requests('data-cards.replace')).toHaveLength(1); expect(requests('data-cards.replace')[0][1].request).toMatchObject({ expectedUserId: 7, body: { id: target.id, expectedVersion: target.version, data: sample } });
    expect(document.body.textContent).toContain('更新已提交审核'); expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('本地编辑稿');
  });
  it('载入云端其他数据保留未保存确认，取消保稿；确认后管理关闭且本地保存/复制入口仍在', async () => {
    await mount(); await click('我的数据卡'); await waitFor(() => !!button('编辑档案')); await click('编辑档案');
    expect(document.body.textContent).toContain('已取消载入'); expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('本地编辑稿');
    vi.mocked(window.confirm).mockReturnValue(true); await click('编辑档案');
    expect(document.querySelector('[role=dialog]')).toBeNull(); expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('云端载入稿'); expect(button('保存到本地库')).toBeTruthy(); expect(button('复制到剪贴板')).toBeTruthy(); expect(requests('data-cards.replace')).toHaveLength(0);
  });
  it('账号切换立即隐去旧管理/确认，迟到的原账号替换响应不污染新账号', async () => {
    await mount(); await click('我的数据卡'); await waitFor(() => !!button('替换')); const pending = deferred<unknown>(); const fallback = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation((command, args) => command === 'cloud_card_library_request' && args.request.routeId === 'data-cards.replace-target.query' ? pending.promise : fallback(command, args)); await click('替换');
    accountId = 8; await act(async () => { await getDesktopCloudSessionStore().refresh(); }); await act(async () => { pending.resolve({ status: 200, body: { success: true, accountFenceVersion: 1, ownerUserId: 7, target } }); });
    expect(document.querySelector('[role=dialog]')).toBeNull(); expect(requests('data-cards.replace')).toHaveLength(0); expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('本地编辑稿');
  });
  it('管理列表选择异类替换目标时原位显示错误，保留当前编辑且不发目标读取或写入', async () => {
    const fallback = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation((command, args) => {
      if (command === 'cloud_card_library_request' && args.request.routeId === 'data-cards.query') {
        const scenario = { ...row, type: 'scenario', roleType: null, name: '另一个情景' };
        return Promise.resolve({ status: 200, body: args.request.query?.id
          ? { success: true, card: { ...scenario, data: JSON.stringify({ templateId: '通用情景', title: '另一个情景', content: '情景正文' }) } }
          : { success: true, cards: [scenario], total: 1, nextOffset: null } });
      }
      return fallback(command, args);
    });
    await mount(); await click('我的数据卡'); await waitFor(() => !!button('替换')); await click('替换');
    expect(document.querySelector('[role=dialog] [role=alert]')?.textContent).toContain('请选择与当前内容类型相同的数据卡');
    expect(requests('data-cards.replace-target.query')).toHaveLength(0); expect(requests('data-cards.replace')).toHaveLength(0);
    expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('本地编辑稿');
  });

});
