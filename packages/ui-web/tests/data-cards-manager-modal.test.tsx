// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataCardsModal, ReplaceCardModal, type DataCardsModalHost, type DataCardsModalProps } from '../src/cloud-save';
import { BaseModal } from '../src/modal';

const row = { id: 'owned-card', name: '雾灯', type: 'character', description: '原描述', data: '{"name":"原正文"}', is_public: 1, review_status: 'approved', usage_count: 0, like_count: 0, favorite_count: 0 };
let root: Root; let container: HTMLDivElement;
let host: DataCardsModalHost;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)!;
const render = (props: Partial<DataCardsModalProps> = {}) => act(async () => { root.render(<DataCardsModal host={host} isOpen dataCards={[row]} currentPage={1} cardsPerPage={12} onPageChange={() => {}} onClose={() => {}} {...props} />); });
const click = (element: HTMLElement) => act(async () => { element.click(); });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  host = { defaultCapacity: 20, recycleLimit: 5, fetchSummaryPage: vi.fn(async () => ({ success: true as const, cards: [], total: 0, nextOffset: null })),
    loadFullCard: vi.fn(async (card) => card), fetchCardMetaBatch: vi.fn(async () => null), downloadJson: vi.fn(), isHotCard: () => false,
    tilePlatform: { Link: ({ children, ...props }) => <a {...props}>{children}</a>, marks: { isLiked: () => false, markLiked: () => true }, copyText: vi.fn(async () => {}), reviewHref: '/review' } };
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Web / Desktop 真实管理模态框共源控制', () => {
  it('按宿主能力隐藏治理与详情，同时保留已有分享、下载、编辑和替换', async () => {
    const load = vi.fn(); const replace = vi.fn();
    await render({ onLoadCard: load, onReplaceCard: replace });
    expect(button('修改信息')).toBeUndefined(); expect(button('删除')).toBeUndefined(); expect(button('详情')).toBeUndefined(); expect(button('回收站')).toBeUndefined();
    await click(button('分享')); expect(host.tilePlatform.copyText).toHaveBeenCalledOnce();
    await click(button('编辑档案')); expect(load).toHaveBeenCalledWith(expect.objectContaining(row));
    await click(button('替换')); expect(replace).toHaveBeenCalledWith(expect.objectContaining(row));
    await click(button('下载')); expect(host.downloadJson).toHaveBeenCalledWith('雾灯.json', '{\n  "name": "原正文"\n}');
  });
  it('Web已提供的资料编辑、取消、删除、回收入口继续工作', async () => {
    const edit = vi.fn(); const remove = vi.fn(); const recycle = vi.fn();
    await render({ onEditCard: edit, onDeleteCard: remove, onOpenRecycleBin: recycle });
    await click(button('修改信息')); expect(edit).toHaveBeenCalledWith(expect.objectContaining(row));
    await click(button('删除')); expect(remove).toHaveBeenCalledWith(row.id);
    await click(button('回收站 0/5')); expect(recycle).toHaveBeenCalledOnce();
    const cancel = vi.fn(); const update = vi.fn();
    await render({ editingCard: row, onCancelEdit: cancel, onUpdateCard: update });
    await click(button('取消')); expect(cancel).toHaveBeenCalledOnce();
    await click(button('保存')); expect(update).toHaveBeenCalledWith(row.id, row.name, row.description, 1);
  });
  it('同轮重复点击只认领一次，关闭后迟到单卡响应不能执行选择', async () => {
    const pending = deferred<unknown>(); host.loadFullCard = vi.fn(() => pending.promise); const replace = vi.fn();
    await render({ onReplaceCard: replace });
    await act(async () => { button('替换').click(); button('替换').click(); });
    expect(host.loadFullCard).toHaveBeenCalledOnce();
    await render({ isOpen: false, onReplaceCard: replace });
    await act(async () => { pending.resolve(row); }); expect(replace).not.toHaveBeenCalled();
  });
  it('账号凭据代际改变取消旧读取且清理原详情，旧响应不进入新账号', async () => {
    const pending = deferred<unknown>(); host.loadFullCard = vi.fn(() => pending.promise); const replace = vi.fn();
    await render({ scopeKey: 'owner-1:epoch-1', onReplaceCard: replace });
    await click(button('替换'));
    await render({ scopeKey: 'owner-1:epoch-2', dataCards: [], onReplaceCard: replace });
    expect((host.loadFullCard as ReturnType<typeof vi.fn>).mock.calls[0][2].aborted).toBe(true);
    await act(async () => { pending.resolve(row); }); expect(replace).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('雾灯');
  });
  it('原生异步下载失败显示错误并保留卡列表，可再次操作', async () => {
    host.downloadJson = vi.fn().mockRejectedValueOnce(new Error('磁盘写入失败')).mockResolvedValueOnce(undefined);
    await render(); await click(button('下载')); expect(document.querySelector('[role=alert]')?.textContent).toContain('磁盘写入失败');
    expect(document.body.textContent).toContain('雾灯'); await click(button('下载')); expect(host.downloadJson).toHaveBeenCalledTimes(2);
  });
  it('打开后约束键盘焦点，Escape关闭并恢复入口；保存中关闭与卡操作禁用', async () => {
    function Harness() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>我的数据卡</button><DataCardsModal host={host} isOpen={open} dataCards={[row]} currentPage={1} cardsPerPage={12} onPageChange={() => {}} onClose={() => setOpen(false)} /></>; }
    await act(async () => { root.render(<Harness />); }); button('我的数据卡').focus(); await click(button('我的数据卡'));
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!; const close = dialog.querySelector<HTMLButtonElement>('[aria-label=关闭]')!;
    expect(document.activeElement).toBe(close);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); });
    expect(dialog.contains(document.activeElement)).toBe(true); expect(document.activeElement).not.toBe(close);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement).toBe(button('我的数据卡'));
    const closed = vi.fn(); await render({ busy: true, onClose: closed });
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(closed).not.toHaveBeenCalled(); expect(button('下载').closest('fieldset')?.disabled).toBe(true);
  });
});

describe('共源替换确认', () => {
  it('展示原目标和待审覆盖语义，取消不提交，保存失败仍保留确认稿', async () => {
    const close = vi.fn(); const confirm = vi.fn();
    const props = { isOpen: true, target: { name: '旧卡', type: 'character', isPublic: 1, hasPendingUpdate: true }, onClose: close, onConfirm: confirm };
    await act(async () => { root.render(<ReplaceCardModal {...props} error="替换失败，正文保留" />); });
    expect(document.body.textContent).toContain('已有待审核版本'); expect(document.body.textContent).toContain('保留目标卡片的名称');
    await click(button('取消')); expect(close).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toBe('替换失败，正文保留');
    await act(async () => { root.render(<ReplaceCardModal {...props} isSaving />); });
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(close).toHaveBeenCalledOnce(); expect(button('替换中...').disabled).toBe(true);
  });
  it('详情上层Escape只关闭上层，底层管理模态框仍锁定滚动', async () => {
    host.DetailsModal = ({ isOpen, onClose, card }) => <BaseModal isOpen={isOpen} onClose={onClose} title={card.name}>详情正文</BaseModal>;
    const close = vi.fn(); await render({ onClose: close }); await click(button('详情'));
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(2);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1); expect(close).not.toHaveBeenCalled(); expect(document.body.style.overflow).toBe('hidden');
  });
});
