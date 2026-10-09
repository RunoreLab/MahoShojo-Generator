// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterManagerPage } from '@/components/character/CharacterManagerPage';
import { writeCharacterManagerPageDraft } from '@/lib/character-manager-page-draft';
import { authStorage, dataCardApi } from '@/lib/auth';
import * as cardClient from '@/lib/data-card-list-client';
import type { OwnedDataCardReplacementTarget } from '@mahoshojo/contracts/data-cards';
const state = vi.hoisted(() => ({ userId: 7, users: { 7: { id: 7, username: 'tester' }, 8: { id: 8, username: 'tester' } } as Record<number, { id: number; username: string }>, push: vi.fn(), resign: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: state.users[state.userId], loading: false, isAuthenticated: true, authSource: 'better-auth-session' }) }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: async () => ({ hasSensitiveWords: false, matchDetails: [] }) }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('@/components/MagicalGirlCard', () => ({ default: () => null }));
vi.mock('@/components/CanshouCard', () => ({ default: () => null }));
vi.mock('@/components/GeneralCharacterCard', () => ({ default: () => null }));
vi.mock('@/components/shared/CharacterPortraitAssetPanel', () => ({ CharacterPortraitAssetPanel: () => null }));
vi.mock('@/components/UserTitle', () => ({ UserWithTitle: () => null }));
let root: Root; let container: HTMLDivElement;
const sample = { templateId: '通用角色', name: '雾灯', content: '角色正文', signature: 'opaque-evidence' };
const target: OwnedDataCardReplacementTarget = { id: 'owned-card', type: 'character', name: '原云卡', description: '保留描述', isPublic: 1, reviewStatus: 'approved', hasPendingUpdate: true, version: '1'.repeat(64) };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)!;
const click = (label: string) => act(async () => { button(label).click(); });
const inputValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
const waitFor = async (check: () => boolean) => { const end = Date.now() + 4000; while (!check()) { if (Date.now() > end) throw new Error('等待角色管理云卡状态超时'); await act(async () => { await new Promise((done) => setTimeout(done, 10)); }); } };
const mount = async (isNative = false) => {
  writeCharacterManagerPageDraft({ pastedJson: '', characterData: sample, originalData: sample, isNative, selectedTemplate: 'general' });
  await act(async () => { root.render(<CharacterManagerPage />); }); await waitFor(() => !!button('保存到云端'));
};
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; state.userId = 7; state.resign.mockReset(); state.push.mockClear(); localStorage.clear();
  vi.spyOn(authStorage, 'getAuth').mockImplementation(async () => ({ userId: state.userId, username: 'tester' })); vi.spyOn(authStorage, 'getAuthHeader').mockResolvedValue(null);
  vi.spyOn(dataCardApi, 'getUserCapacity').mockResolvedValue({ capacity: 20, usedSlots: 0 }); vi.spyOn(dataCardApi, 'getRecycleBin').mockResolvedValue([]);
  vi.spyOn(dataCardApi, 'createCard').mockResolvedValue({ success: true, id: 'new-card' }); vi.spyOn(dataCardApi, 'readOwnedReplacementTarget').mockResolvedValue({ success: true, target }); vi.spyOn(dataCardApi, 'replaceOwnedCard').mockResolvedValue({ success: true, pendingReview: true });
  vi.spyOn(cardClient, 'getDataCardSummaryPage').mockResolvedValue({ success: true, cards: [{ id: target.id, user_id: 7, name: target.name, description: target.description, type: 'character', is_public: 1, review_status: 'approved', created_at: null, updated_at: null, usage_count: 0, like_count: 0, favorite_count: 0, is_recommended: 0, username: 'tester', roleType: 'general', nativeAllowed: false, has_pending_update: true, tag_ids: [], favorited_at: null }], total: 1, nextOffset: null });
  vi.spyOn(cardClient, 'loadFullDataCard').mockResolvedValue({ id: target.id, type: target.type, name: target.name, data: JSON.stringify(sample) });
  vi.stubGlobal('fetch', vi.fn(async (url, options) => { if (String(url).includes('/api/resign-data')) { const result = await state.resign(options); return result ?? Response.json({ ...sample, signature: 'renewed-signature' }); } return Response.json({ success: true, badges: [], items: {}, tags: [], reportCapability: null }); }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('Web真实角色管理普通角色/情景云写宿主', () => {
  it('保存表单可取消重开、设为公开，提交仍走原签名准备与owner围栏；重复点击只提交一次', async () => {
    await mount(true); await click('保存到云端'); await click('取消'); expect(document.querySelector('[role=dialog]')).toBeNull(); await click('保存到云端');
    await act(async () => { (document.querySelector('[role=dialog] input[type=checkbox]') as HTMLInputElement).click(); button('保存').click(); button('保存').click(); });
    await waitFor(() => vi.mocked(dataCardApi.createCard).mock.calls.length > 0);
    expect(state.resign).toHaveBeenCalledOnce(); expect(dataCardApi.createCard).toHaveBeenCalledOnce();
    expect(vi.mocked(dataCardApi.createCard).mock.calls[0]).toEqual(['character', '雾灯', '角色数据卡', expect.objectContaining({ signature: 'renewed-signature' }), 1, expect.objectContaining({ expectedUserId: 7 })]);
    expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('雾灯'); expect(container.textContent).toContain('数据卡保存成功');
  });
  it('明确保存失败保留名称描述和编辑正文；不确定结果关闭重开仍禁止直接重发', async () => {
    vi.mocked(dataCardApi.createCard).mockResolvedValueOnce({ success: false, error: '容量不足' }).mockResolvedValueOnce({ success: false, uncertain: true, error: '结果不确定' });
    await mount(); await click('保存到云端'); const fields = document.querySelectorAll<HTMLInputElement>('[role=dialog] input'); await inputValue(fields[0], '我的新名字');
    await click('保存'); expect(document.body.textContent).toContain('容量不足'); expect(document.querySelector<HTMLInputElement>('[role=dialog] input')?.value).toBe('我的新名字');
    await click('保存'); expect(button('保存').disabled).toBe(true); expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('雾灯');
    await click('取消'); await click('保存到云端'); expect(button('保存').disabled).toBe(true); expect(dataCardApi.createCard).toHaveBeenCalledTimes(2);
  });
  it('从真实管理卡片选替换目标，服务端版本先读后确认，取消零写，待审按ack反馈', async () => {
    await mount(); await act(async () => { [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('我的数据卡'))!.click(); }); await waitFor(() => !!button('替换')); await click('替换');
    expect(dataCardApi.readOwnedReplacementTarget).toHaveBeenCalledWith(target.id, expect.objectContaining({ expectedUserId: 7 })); expect(document.body.textContent).toContain('已有待审核版本'); expect(dataCardApi.replaceOwnedCard).not.toHaveBeenCalled();
    await click('取消'); await act(async () => { [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('我的数据卡'))!.click(); }); await waitFor(() => !!button('替换')); await click('替换'); await click('确认替换');
    expect(dataCardApi.replaceOwnedCard).toHaveBeenCalledWith(target, expect.objectContaining({ name: '雾灯' }), expect.objectContaining({ expectedUserId: 7 })); expect(container.textContent).toContain('更新已提交审核');
  });
  it('账号切换使已打开保存/替换失效，旧准备响应不写新账号，编辑正文仍在', async () => {
    const old = deferred<{ success: boolean; target: OwnedDataCardReplacementTarget }>(); vi.mocked(dataCardApi.readOwnedReplacementTarget).mockReturnValue(old.promise);
    await mount(); await act(async () => { [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('我的数据卡'))!.click(); }); await waitFor(() => !!button('替换')); await click('替换');
    state.userId = 8; await act(async () => { root.render(<CharacterManagerPage />); }); await act(async () => { old.resolve({ success: true, target }); });
    expect(document.querySelector('[role=dialog]')).toBeNull(); expect(dataCardApi.replaceOwnedCard).not.toHaveBeenCalled(); expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('雾灯');
  });
  it('替换未知响应不自动重放且失败保稿，必须回列表重新读取目标', async () => {
    vi.mocked(dataCardApi.replaceOwnedCard).mockResolvedValue({ success: false, uncertain: true, error: '替换结果不确定' });
    await mount(); await act(async () => { [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('我的数据卡'))!.click(); }); await waitFor(() => !!button('替换')); await click('替换'); await click('确认替换');
    expect(button('确认替换').disabled).toBe(true); expect(dataCardApi.replaceOwnedCard).toHaveBeenCalledOnce(); expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe('雾灯');
    await click('检查我的云端卡并重新选择目标'); await waitFor(() => !!button('替换')); expect(dataCardApi.replaceOwnedCard).toHaveBeenCalledOnce();
  });
  it.each(['account', 'source'])('签名准备在途换%s，迟到的不合规响应不跳转、不写入、不污染新页面', async (change) => {
    const signing = deferred<Response>(); state.resign.mockImplementationOnce(() => signing.promise);
    await mount(true); await click('保存到云端'); await click('保存'); await waitFor(() => state.resign.mock.calls.length === 1);
    if (change === 'account') { state.userId = 8; await act(async () => { root.render(<CharacterManagerPage />); }); }
    else await inputValue(container.querySelector<HTMLInputElement>('#editor-field-name')!, '新编辑正文');
    await act(async () => { signing.resolve(Response.json({ shouldRedirect: true, reason: '旧数据拒绝' }, { status: 403 })); });
    expect(state.push).not.toHaveBeenCalled(); expect(dataCardApi.createCard).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('#editor-field-name')?.value).toBe(change === 'account' ? '雾灯' : '新编辑正文'); expect(document.querySelector('[role=dialog]')).toBeNull();
  });

});
