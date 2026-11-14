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
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; }); return { promise, resolve, reject }; };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  host = { defaultCapacity: 20, recycleLimit: 5, fetchSummaryPage: vi.fn(async () => ({ success: true as const, cards: [], total: 0, nextOffset: null })),
    loadFullCard: vi.fn(async (card) => card), fetchCardMetaBatch: vi.fn(async () => null), downloadJson: vi.fn(), isHotCard: () => false,
    tilePlatform: { Link: ({ children, ...props }) => <a {...props}>{children}</a>, marks: { isLiked: () => false, markLiked: () => true }, copyText: vi.fn(async () => {}), reviewHref: '/review' } };
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Web / Desktop 真实管理模态框共源控制', () => {
  it.each([
    { label: 'camelCase 数组', tags: { tagIds: [' a ', 'b', 'a', '', 1] }, expected: ['a', 'b'] },
    { label: 'snake_case 数组', tags: { tag_ids: ['a', 'b'] }, expected: ['a', 'b'] },
    { label: '详情接口 CSV', tags: { tag_ids: ' a, b,a, ' }, expected: ['a', 'b'] },
    { label: '无标签', tags: { tag_ids: null }, expected: [] },
    { label: '缺失标签', tags: {}, expected: [] },
    { label: '异常标签对象', tags: { tagIds: { length: 1 } }, expected: [] },
    { label: '异常 camelCase 回退', tags: { tagIds: 1, tag_ids: 'a,b' }, expected: ['a', 'b'] },
  ])('详情插槽接收归一化标签：$label', async ({ tags, expected }) => {
    const details = vi.fn(() => null);
    host.DetailsModal = details;
    host.loadFullCard = vi.fn(async () => ({ ...row, ...tags }));
    await render(); await click(button('详情'));
    expect(details).toHaveBeenLastCalledWith(expect.objectContaining({
      isOpen: true, card: expect.objectContaining({ tagIds: expected }),
    }), undefined);
  });
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
    await render({ onEditCard: edit, onDeleteCard: remove, onOpenRecycleBin: recycle, recycleCount: 0 });
    await click(button('修改信息')); expect(edit).toHaveBeenCalledWith(expect.objectContaining(row));
    await click(button('删除')); expect(remove).toHaveBeenCalledWith(row.id);
    await click(button('回收站 0/5')); expect(recycle).toHaveBeenCalledOnce();
    const cancel = vi.fn(); const update = vi.fn();
    await render({ editingCard: row, onCancelEdit: cancel, onUpdateCard: update });
    await click(button('取消')); expect(cancel).toHaveBeenCalledOnce();
    await click(button('保存')); expect(update).toHaveBeenCalledWith(row.id, row.name, row.description, 1);
  });
  it('删除错误在当前对话框内显示原文并优先于旧列表错误，不自动重发或额外读取正文', async () => {
    const message = '回收站已满，本次未删除任何卡片';
    const remove = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue(undefined);
    await render({ onDeleteCard: remove, error: '旧列表刷新失败' });
    await click(button('删除'));
    expect(document.querySelector('[role=dialog] [role=alert]')?.textContent).toBe(message);
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('雾灯');
    expect(remove).toHaveBeenCalledExactlyOnceWith(row.id); expect(host.loadFullCard).not.toHaveBeenCalled();
    await click(button('删除')); expect(remove).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role=dialog] [role=alert]')?.textContent).not.toContain(message);
  });
  it.each(['close-reopen', 'account-change'])('删除single-flight与%s不认领旧失败，也不释放新动作', async (change) => {
    const old = deferred<void>(), next = deferred<void>();
    const remove = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await render({ onDeleteCard: remove, scopeKey: 'owner-1:epoch-1' });
    await act(async () => { button('删除').click(); button('删除').click(); });
    expect(remove).toHaveBeenCalledOnce();
    if (change === 'close-reopen') await render({ isOpen: false, onDeleteCard: remove, scopeKey: 'owner-1:epoch-1' });
    const nextScope = change === 'account-change' ? 'owner-2:epoch-2' : 'owner-1:epoch-1';
    await render({ onDeleteCard: remove, scopeKey: nextScope }); await click(button('删除'));
    await act(async () => { old.reject(new Error('上一对话的失败')); });
    expect(document.querySelector('[role=dialog] [role=alert]')).toBeNull();
    await click(button('删除')); expect(remove).toHaveBeenCalledTimes(2);
    await act(async () => { next.reject(new Error('当前对话的失败')); });
    expect(document.querySelector('[role=dialog] [role=alert]')?.textContent).toBe('当前对话的失败');
  });
  it('宿主busy阻断普通删除，保留同步void回调兼容', async () => {
    const remove = vi.fn();
    await render({ busy: true, onDeleteCard: remove }); await click(button('删除')); expect(remove).not.toHaveBeenCalled();
    await render({ onDeleteCard: remove }); await click(button('删除')); expect(remove).toHaveBeenCalledExactlyOnceWith(row.id);
  });
  it('同轮重复点击只认领一次，关闭后迟到单卡响应不能执行选择', async () => {
    const pending = deferred<unknown>(); host.loadFullCard = vi.fn(() => pending.promise); const replace = vi.fn();
    await render({ onReplaceCard: replace });
    await act(async () => { button('替换').click(); button('替换').click(); });
    expect(host.loadFullCard).toHaveBeenCalledOnce();
    await render({ isOpen: false, onReplaceCard: replace });
    await act(async () => { pending.resolve(row); }); expect(replace).not.toHaveBeenCalled();
  });
  it('正文读取和宿主准备期间立即反馈，关闭与Escape仍可用', async () => {
    const reading = deferred<unknown>(), preparing = deferred<void>();
    host.loadFullCard = vi.fn(() => reading.promise);
    const replace = vi.fn(() => preparing.promise), close = vi.fn();
    await render({ onReplaceCard: replace, onClose: close });
    await click(button('替换'));
    expect(document.querySelector('[role=status]')?.textContent).toContain('正在处理数据卡');
    expect(document.querySelector<HTMLButtonElement>('[aria-label=关闭]')?.disabled).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    await act(async () => { reading.resolve(row); });
    expect(replace).toHaveBeenCalledOnce();
    expect(document.querySelector('[role=status]')?.textContent).toContain('正在处理数据卡');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(close).toHaveBeenCalledOnce();
    await render({ isOpen: false, onReplaceCard: replace, onClose: close });
    await act(async () => { preparing.resolve(); });
  });
  it('关闭重开后的新loading不被旧动作finally清除', async () => {
    const old = deferred<unknown>(), current = deferred<unknown>();
    host.loadFullCard = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const replace = vi.fn();
    await render({ onReplaceCard: replace }); await click(button('替换'));
    await render({ isOpen: false, onReplaceCard: replace });
    await render({ onReplaceCard: replace }); await click(button('替换'));
    await act(async () => { old.resolve(row); });
    expect(document.querySelector('[role=status]')?.textContent).toContain('正在处理数据卡');
    expect(replace).not.toHaveBeenCalled();
    await act(async () => { current.resolve(row); });
    expect(document.querySelector('[role=status]')).toBeNull();
    expect(replace).toHaveBeenCalledOnce();
  });
  it.each(['read', 'prepare'])('%s失败清理loading并保留列表供手动重试', async (stage) => {
    const failure = deferred<unknown>();
    const replace = stage === 'prepare' ? vi.fn(() => failure.promise as Promise<void>) : vi.fn();
    if (stage === 'read') host.loadFullCard = vi.fn(() => failure.promise);
    await render({ onReplaceCard: replace }); await click(button('替换'));
    expect(document.querySelector('[role=status]')).not.toBeNull();
    await act(async () => { failure.reject(new Error('目标读取失败')); });
    expect(document.querySelector('[role=status]')).toBeNull();
    expect(document.querySelector('[role=alert]')?.textContent).toBe('目标读取失败');
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('雾灯');
  });
  it('账号凭据代际改变取消旧读取且清理原详情，旧响应不进入新账号', async () => {
    const pending = deferred<unknown>(); host.loadFullCard = vi.fn(() => pending.promise); const replace = vi.fn();
    await render({ scopeKey: 'owner-1:epoch-1', onReplaceCard: replace });
    await click(button('替换'));
    await render({ scopeKey: 'owner-1:epoch-2', dataCards: [], onReplaceCard: replace });
    expect((host.loadFullCard as ReturnType<typeof vi.fn>).mock.calls[0][2].aborted).toBe(true);
    await act(async () => { pending.resolve(row); }); expect(replace).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('雾灯');
  });
  it('元信息响应省略卡片时不触发无限重试', async () => {
    host.fetchCardMetaBatch = vi.fn(async () => ({}));
    await render(); expect(host.fetchCardMetaBatch).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('雾灯');
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

describe('数据卡列表的视口与原生滚动结构', () => {
  it.each([0, 1, 30])('为 %i 张卡保留独立可聚焦滚动区，fieldset 只负责禁用', async count => {
    await render({ dataCards: Array.from({ length: count }, (_, index) => ({ ...row, id: `card-${index}` })), cardsPerPage: 40, busy: true });
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    const region = dialog.querySelector<HTMLElement>('[role=region]')!;
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.className).toContain('max-h-[min(90dvh,calc(100dvh-2rem))]');
    expect(region.tagName).toBe('DIV');
    expect(region.className).toContain('min-h-0');
    expect(region.className).toContain('overflow-auto');
    expect(region.className).toContain('overscroll-contain');
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute('aria-labelledby')).toBe(dialog.getAttribute('aria-labelledby'));
    expect(region.querySelector('fieldset')?.disabled).toBe(true);
    region.focus();
    const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    region.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.documentElement.style.overflow).toBe('hidden');
  });
});
