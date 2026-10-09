// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopOwnedCardsModal } from '../src/features/cloud-save/owned-cards-modal';
const mocks = vi.hoisted(() => ({ accountId: 7, epoch: 1, fetch: vi.fn(), load: vi.fn(), capacity: vi.fn(), createPort: vi.fn(), download: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../src/platform/private-cloud-save', () => ({ readPrivateCloudCapacity: mocks.capacity }));
vi.mock('../src/features/account/use-desktop-cloud-session', () => ({ useDesktopCloudSession: () => ({ state: { account: { userId: mocks.accountId }, verification: 'verified', authFlow: { kind: 'idle' } }, store: {
  getCredentialEpoch: () => mocks.epoch, getSnapshot: () => ({ account: { userId: mocks.accountId }, verification: 'verified', authFlow: { kind: 'idle' } }),
} }) }));
const platform = { Link: ({ children, ...props }: any) => <a {...props}>{children}</a>, marks: { isLiked: () => false, markLiked: () => true }, copyText: vi.fn(), downloadJson: mocks.download };
vi.mock('../src/platform/card-library-host', () => ({
  createDesktopCardLibraryOnlinePort: (...args: unknown[]) => { mocks.createPort(...args); return { fetchSummaryPage: mocks.fetch, loadFullCard: mocks.load }; },
  useDesktopCardLibraryHost: () => ({ platform, slots: {} }),
}));
let root: Root; let container: HTMLDivElement;
const card = { id: 'owned', type: 'character', user_id: 7, name: '云端雾灯', description: '', is_public: 0, review_status: 'approved', roleType: 'general', usage_count: 0, like_count: 0, favorite_count: 0 };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!;
const render = (replace = vi.fn(), load = vi.fn()) => act(async () => { root.render(<DesktopOwnedCardsModal isOpen expectedUserId={7} onClose={() => {}} onReplaceCard={replace} onSelectCard={load} />); });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mocks.accountId = 7; mocks.epoch = 1;
  mocks.fetch.mockResolvedValue({ success: true, cards: [card], total: 1, nextOffset: null }); mocks.load.mockResolvedValue({ ...card, data: '{"name":"正文"}' }); mocks.capacity.mockResolvedValue(null);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
describe('Desktop 我的卡宿主回用共享管理模态框', () => {
  it('列表按expected owner读取，容量未知不伪装默认值，仅真实能力按钮可用', async () => {
    const select = vi.fn(); const replace = vi.fn(); await render(replace, select);
    expect(mocks.createPort.mock.calls[0][1]).toBe(7); expect(document.body.textContent).toContain('云端容量未知'); expect(document.body.textContent).not.toContain('0/20 槽');
    expect(button('修改信息')).toBeUndefined(); expect(button('删除')).toBeUndefined(); expect(button('详情')).toBeUndefined();
    await act(async () => { button('编辑档案').click(); }); expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'owned', data: '{"name":"正文"}' }));
    await act(async () => { button('替换').click(); }); expect(replace).toHaveBeenCalledOnce();
  });
  it('账号切换关闭旧账号管理，已在读取的目标迟到不会触发替换', async () => {
    let resolve!: (card: unknown) => void; mocks.load.mockReturnValue(new Promise((done) => { resolve = done; }));
    const replace = vi.fn(); await render(replace); await act(async () => { button('替换').click(); });
    mocks.accountId = 8; mocks.epoch += 1; await render(replace); await act(async () => { resolve({ ...card, data: '{}' }); });
    expect(document.querySelector('[role=dialog]')).toBeNull(); expect(replace).not.toHaveBeenCalled();
  });
});
