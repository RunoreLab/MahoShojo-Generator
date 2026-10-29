// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { RecycleBinModal, type OwnedRecycleBinReadPort, type RecycleBinModalProps } from '../src/cloud-save';
import { BaseModal } from '../src/modal/BaseModal';
import type { OwnedRecycleBinCardDetail, OwnedRecycleBinPage } from '@mahoshojo/contracts/data-cards';
const row = { id: 'c', name: '删除的卡', description: '描述', type: 'character' as const, is_public: -1 as const, review_status: 'rejected' as const,
  created_at: null, updated_at: null, deleted_at: '2026-10-15T00:00:00Z', usage_count: 0, like_count: 0, isLegacyQuestionnaire: false };
const page: OwnedRecycleBinPage = { success: true, accountFenceVersion: 1, ownerUserId: 7, cards: [row], total: 8, filteredCount: 8, nextOffset: null };
const detail: OwnedRecycleBinCardDetail = { ...row, data: '{ "content": "正文原件" }' };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let root: Root; let element: HTMLDivElement; let port: OwnedRecycleBinReadPort; let props: RecycleBinModalProps;
const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((value) => value.textContent === label)!;
const click = async (label: string) => act(async () => { button(label).focus(); button(label).click(); });
const render = async (patch: Partial<RecycleBinModalProps> = {}) => { props = { ...props, ...patch }; await act(async () => root.render(<RecycleBinModal {...props} />)); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  port = { isCurrent: () => true, readPage: vi.fn(async () => page), readDetail: vi.fn(async () => detail) };
  props = { isOpen: true, onClose: vi.fn(), limit: 5, port,
    DetailsModal: ({ card, onClose }) => <BaseModal isOpen title="详情" onClose={onClose}><pre>{card.data}</pre></BaseModal> };
});
afterEach(() => { act(() => root.unmount()); element.remove(); });
it('使用当前类型总数限制跳转，直接读取目标 offset', async () => {
  port.readPage = vi.fn(async () => ({ ...page, total: 1000, filteredCount: 60 }));
  await render({ type: 'questionnaire' });
  const input = document.querySelector<HTMLInputElement>('input[aria-label="跳转页码"]')!;
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await type('6'); expect(button('跳转').disabled).toBe(true);
  await type('5'); expect(port.readPage).toHaveBeenCalledTimes(1);
  await click('跳转');
  expect(port.readPage).toHaveBeenCalledTimes(2);
  expect(port.readPage).toHaveBeenLastCalledWith({ limit: 12, offset: 48, type: 'questionnaire' }, expect.any(AbortSignal));
  expect(text()).toContain('第 5 页');
});

it('双端真实列表摘要先行，显示原可见性/审核/删除时间，详情按需；无写slots不出现写按钮', async () => {
  await render(); expect(text()).toContain('账号回收站：8/5'); expect(text()).toContain('原可见性：封禁'); expect(text()).toContain('未通过'); expect(text()).toContain('删除于');
  expect(port.readDetail).not.toHaveBeenCalled(); expect(button('恢复')).toBeUndefined(); expect(button('彻底删除')).toBeUndefined();
  await click('查看详情'); expect(port.readDetail).toHaveBeenCalledExactlyOnceWith('c', expect.any(AbortSignal)); expect(text()).toContain(detail.data);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(text()).not.toContain(detail.data); expect(props.onClose).not.toHaveBeenCalled(); expect(document.activeElement).toBe(button('查看详情'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(props.onClose).toHaveBeenCalledOnce();
});
it('容量使用宿主配置，满时停止移入且不承诺自动清理；未知上限只显示账号总数', async () => {
  await render({ limit: 9 });
  expect(text()).toContain('账号所有类型共用 9 个回收站名额');
  expect(text()).toContain('满时会停止移入，不会自动清理已有卡片');
  expect(text()).toContain('账号回收站：8/9');
  expect(text()).not.toContain('永久清理最早');
  await render({ limit: undefined });
  expect(text()).toContain('账号所有类型共享回收站容量');
  expect(text()).toContain('账号回收站：8 个');
  expect(text()).not.toContain('8/');
  expect(text()).not.toContain('undefined');
});
it('loading/error不伪装为空，刷新后才显示已确认空态', async () => {
  const pending = deferred<OwnedRecycleBinPage>(); port.readPage = vi.fn(() => pending.promise);
  await render(); expect(text()).toContain('正在加载'); expect(text()).not.toContain('回收站为空'); expect(button('刷新').disabled).toBe(true);
  await act(async () => pending.reject(new Error('存储不可用'))); expect(text()).toContain('存储不可用'); expect(text()).not.toContain('回收站为空');
  port.readPage = vi.fn(async () => ({ ...page, cards: [], total: 0, filteredCount: 0 })); await click('刷新'); expect(text()).toContain('回收站为空');
});
it('按类型分页与账号总数分开，refresh维持页码，空页可以返回上一页', async () => {
  port.readPage = vi.fn(async (query) => ({ ...page, total: 30, filteredCount: 20, cards: query.offset ? [] : [row], nextOffset: query.offset ? null : 12 }));
  await render({ type: 'questionnaire' }); expect(text()).toContain('账号回收站：30/5'); expect(text()).toContain('当前类型 20 个');
  await click('下一页'); expect(port.readPage).toHaveBeenLastCalledWith({ limit: 12, offset: 12, type: 'questionnaire' }, expect.any(AbortSignal)); expect(text()).toContain('当前筛选或分页没有数据卡');
  await click('刷新'); expect(port.readPage).toHaveBeenLastCalledWith({ limit: 12, offset: 12, type: 'questionnaire' }, expect.any(AbortSignal));
  await click('上一页'); expect(text()).toContain('第 1 页');
});
it('关闭重开不认领旧读；原ticket不能释放新操作的busy', async () => {
  const old = deferred<OwnedRecycleBinPage>(), next = deferred<OwnedRecycleBinPage>(); let blocked = false;
  const changes = vi.fn((value: boolean) => { blocked = value; });
  port.readPage = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await render({ operationGuard: { isBlocked: () => blocked, onBusyChange: changes } });
  const oldSignal = vi.mocked(port.readPage).mock.calls[0]![1]; await render({ isOpen: false }); expect(oldSignal.aborted).toBe(true);
  await render({ isOpen: true }); expect(blocked).toBe(true);
  await act(async () => old.resolve({ ...page, cards: [{ ...row, name: '旧账号正文' }] })); expect(text()).not.toContain('旧账号正文'); expect(blocked).toBe(true);
  await act(async () => next.resolve(page)); expect(blocked).toBe(false); expect(changes.mock.calls.map(([v]) => v)).toEqual([true, false, true, false]);
});
it('详情错误不回退列表正文；账号epoch改变时迟到详情丢弃', async () => {
  const pending = deferred<OwnedRecycleBinCardDetail>(); port.readDetail = vi.fn(() => pending.promise);
  await render(); await click('查看详情'); port.isCurrent = () => false;
  await act(async () => pending.resolve(detail)); expect(text()).not.toContain(detail.data);
  port.isCurrent = () => true; await render({ isOpen: false }); await render({ isOpen: true });
  port.readDetail = vi.fn(async () => { throw new Error('记录已恢复或不存在'); }); await click('查看详情'); expect(text()).toContain('记录已恢复或不存在'); expect(text()).not.toContain(detail.data);
});
const restoreTarget = { id: 'c', version: 'a'.repeat(64) };
const restoreAck = { status: 200, body: { success: true, accountFenceVersion: 1, restoreProtocolVersion: 1, ownerUserId: 7, operation: 'restore', ...restoreTarget } };
const restorePort = (write: NonNullable<RecycleBinModalProps['restorePort']>['write'], changes = vi.fn()) => ({ expectedUserId: 7, isCurrent: () => true, onBusyChange: changes,
  preview: vi.fn(async () => ({ status: 200, body: { success: true, accountFenceVersion: 1, deleteProtocolVersion: 1, ownerUserId: 7, operation: 'preview-recycle', targets: [{ ...restoreTarget, type: 'character', name: '卡', description: null }], total: 1, recycleLimit: 10 } })), write, onChanged: vi.fn() });
it('共享恢复single-flight，精确回执后刷新且onChanged一次', async () => {
  const pending = deferred<typeof restoreAck>(); let blocked = false;
  const changes = vi.fn((value: boolean) => { blocked = value; }); const restore = restorePort(vi.fn(() => pending.promise), changes);
  await render({ restorePort: restore, operationGuard: { isBlocked: () => blocked, onBusyChange: changes } });
  await act(async () => { button('恢复').click(); button('恢复').click(); });
  expect(restore.write).toHaveBeenCalledOnce(); expect(blocked).toBe(true); expect(button('查看详情').disabled).toBe(true);
  await act(async () => pending.resolve(restoreAck)); expect(port.readPage).toHaveBeenCalledTimes(2); expect(blocked).toBe(false); expect(restore.onChanged).toHaveBeenCalledOnce();
});
it('unknown只读核对不补成功，不重试；关闭不等待服务端回滚', async () => {
  let blocked = false; const changes = vi.fn((value: boolean) => { blocked = value; });
  const restore = restorePort(vi.fn(async () => { throw Error('network'); }), changes);
  await render({ restorePort: restore, operationGuard: { isBlocked: () => blocked, onBusyChange: changes } }); await click('恢复');
  expect(text()).toContain('恢复结果不确定'); expect(blocked).toBe(true); expect(button('恢复').disabled).toBe(true);
  port.readPage = vi.fn(async () => ({ ...page, cards: [], total: 0, filteredCount: 0 })); await click('刷新核对当前回收站');
  expect(text()).toContain('恢复结果不确定'); expect(text()).toContain('回收站为空'); expect(restore.write).toHaveBeenCalledOnce(); expect(restore.onChanged).not.toHaveBeenCalled();
});
it('外部busy与身份失效均阻断dispatch', async () => {
  await render({ operationGuard: { isBlocked: () => true, onBusyChange: vi.fn() } }); expect(port.readPage).not.toHaveBeenCalled(); expect(text()).toContain('其他云端操作');
  await render({ operationGuard: undefined }); port.isCurrent = () => false; await click('刷新'); expect(port.readPage).not.toHaveBeenCalled();
});

it('父层刷新不取消在途恢复，写终态后才开始新摘要', async () => {
  const pending = deferred<typeof restoreAck>(); let blocked = false; const changes = vi.fn((value: boolean) => { blocked = value; });
  await render({ restorePort: restorePort(() => pending.promise, changes), operationGuard: { isBlocked: () => blocked, onBusyChange: changes } });
  await click('恢复'); await render({ refreshKey: 1 }); expect(blocked).toBe(true); expect(port.readPage).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(restoreAck)); expect(port.readPage).toHaveBeenCalledTimes(2); expect(blocked).toBe(false);
});

it('外部刷新撤销旧详情读取，迟到详情不能覆盖更新后的列表', async () => {
  const pending = deferred<OwnedRecycleBinCardDetail>(); port.readDetail = vi.fn(() => pending.promise);
  await render(); await click('查看详情'); const oldSignal = vi.mocked(port.readDetail).mock.calls[0]![1];
  await render({ refreshKey: 1 }); expect(oldSignal.aborted).toBe(true); expect(port.readPage).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(detail)); expect(text()).not.toContain(detail.data); expect(button('刷新').disabled).toBe(false);
});
it('写中关闭再打开保留unknown提示，迟到回执不能刷新或认领成功', async () => {
  const pending = deferred<typeof restoreAck>(); const restore = restorePort(() => pending.promise);
  await render({ restorePort: restore }); await click('恢复');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(props.onClose).toHaveBeenCalledOnce(); await render({ isOpen: false }); await render({ isOpen: true });
  expect(text()).toContain('恢复结果不确定'); await act(async () => pending.resolve(restoreAck));
  expect(text()).not.toContain('数据卡已恢复'); expect(restore.onChanged).not.toHaveBeenCalled(); expect(button('恢复').disabled).toBe(true);
});
it('未提供宿主guard也阻止同tick恢复与删除并发', async () => {
  const pending = deferred<typeof restoreAck>(); const restore = restorePort(() => pending.promise);
  const deletion = { expectedUserId: 7, isCurrent: () => true, preview: vi.fn(async () => ({ status: 503, body: {} })), write: vi.fn(async () => ({ status: 503, body: {} })) };
  await render({ restorePort: restore, deletePort: deletion });
  await act(async () => { button('恢复').click(); button('永久删除…').click(); button('查看详情').click(); });
  expect(deletion.preview).not.toHaveBeenCalled(); expect(port.readDetail).not.toHaveBeenCalled();
  await act(async () => pending.resolve(restoreAck));
});
it('ordinary close hides an unknown restore; only explicit acknowledgement clears its notice', async () => {
  const notice = { uncertain: false };
  const restore = { ...restorePort(vi.fn(async () => { throw Error('lost'); })), notice };
  await render({ restorePort: restore }); await click('恢复');
  expect(text()).toContain('恢复结果不确定');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(props.onClose).toHaveBeenCalledOnce(); expect(notice.uncertain).toBe(true);
  await render({ isOpen: false }); await render({ isOpen: true });
  expect(text()).toContain('恢复结果不确定'); expect(restore.write).toHaveBeenCalledOnce();
  await click('已核对，结束本次操作'); expect(notice.uncertain).toBe(false);
  await render({ isOpen: false }); await render({ isOpen: true }); expect(text()).not.toContain('恢复结果不确定');
});
