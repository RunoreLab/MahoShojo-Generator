// @vitest-environment jsdom
import fixture from '@mahoshojo/contracts/fixtures/battle-report-history.json';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattleReportDetailSchema, BattleReportListSchema, DEFAULT_BATTLE_REPORT_FILTERS } from '@mahoshojo/contracts/battle-report-history';
import { BattleReportDetailsView, BattleReportsListView, useBattleReportFilters } from '../src/battle-report-history';
const list = BattleReportListSchema.parse(fixture.list); const detail = BattleReportDetailSchema.parse(fixture.detail);
let root: Root; let container: HTMLDivElement;
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
const button = (text: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };

describe('shared report history UI', () => {
  it('uses controlled filters atomically, paginates, resets effective search and never offers unprovided actions', async () => {
    vi.useFakeTimers(); const observe = vi.fn(); const refresh = vi.fn(); const open = vi.fn();
    function Harness() {
      const state = useBattleReportFilters({ ...DEFAULT_BATTLE_REPORT_FILTERS, page: 2 }); observe(state.filters);
      return <BattleReportsListView filters={state.filters} onFiltersChange={state.setFilters} searchInput={state.searchInput} onSearchInputChange={state.setSearchInput}
        data={{ ...list, total: 32 }} loading={false} refreshing={false} error={null} onRefresh={refresh} onOpenDetails={open} />;
    }
    await act(async () => root.render(<Harness />));
    expect(container.textContent).not.toContain('重生战报');
    const status = container.querySelectorAll('select')[1]!;
    await act(async () => { status.value = 'failed'; status.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(observe.mock.lastCall?.[0]).toMatchObject({ page: 1, status: 'failed' });
    await click('下一页'); expect(observe.mock.lastCall?.[0].page).toBe(2);
    const input = container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  标题  '); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(observe.mock.lastCall?.[0].q).toBe('');
    await act(async () => vi.advanceTimersByTime(300));
    expect(observe.mock.lastCall?.[0]).toMatchObject({ page: 1, q: '标题', status: 'failed' });
    await click('清空筛选'); expect(observe.mock.lastCall?.[0]).toEqual(DEFAULT_BATTLE_REPORT_FILTERS);
    await click('刷新'); expect(refresh).toHaveBeenCalledTimes(1);
    await click('详情'); expect(open).toHaveBeenCalledWith('generation-1');
  });
  it('converges an out-of-range page only on a successful result', async () => {
    const change = vi.fn();
    const props = { filters: { ...DEFAULT_BATTLE_REPORT_FILTERS, page: 8 }, onFiltersChange: change, searchInput: '', onSearchInputChange: vi.fn(), data: { ...list, total: 12 }, loading: false, refreshing: false, error: '网络失败' as string | null, onRefresh: vi.fn(), onOpenDetails: vi.fn() };
    await act(async () => root.render(<BattleReportsListView {...props} />)); expect(change).not.toHaveBeenCalled(); expect(container.textContent).not.toContain('暂无战报记录');
    await act(async () => root.render(<BattleReportsListView {...props} error={null} />)); expect(change).toHaveBeenCalledWith({ ...props.filters, page: 2 });
  });
  it('never offers page 10001 even when the server total exceeds its accessible page range', async () => {
    const change = vi.fn();
    await act(async () => root.render(<BattleReportsListView filters={{ ...DEFAULT_BATTLE_REPORT_FILTERS, page: 10_000 }} onFiltersChange={change} searchInput="" onSearchInputChange={vi.fn()}
      data={{ ...list, page: 10_000, total: 1_000_000 }} loading={false} refreshing={false} error={null} onRefresh={vi.fn()} onOpenDetails={vi.fn()} />));
    expect(button('下一页').disabled).toBe(true); expect(container.textContent).toContain('/ 10000 页');
    await click('下一页'); expect(change).not.toHaveBeenCalled();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="跳转页码"]')!;
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await type('10001'); expect(button('跳转').disabled).toBe(true);
    await type('9999'); expect(change).not.toHaveBeenCalled();
    await click('跳转'); expect(change).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ page: 9999 }));
  });
  it('preserves source labels and optional Web regenerate action', async () => {
    const regenerate = vi.fn();
    await act(async () => root.render(<BattleReportsListView filters={DEFAULT_BATTLE_REPORT_FILTERS} onFiltersChange={vi.fn()} searchInput="" onSearchInputChange={vi.fn()}
      data={{ ...list, records: [ { ...list.records[0]!, id: 'host', sourceKind: 'arena-multiplayer', arenaParticipantRole: 'host' }, { ...list.records[0]!, id: 'member', sourceKind: 'arena-multiplayer', arenaParticipantRole: 'member' }, { ...list.records[0]!, id: 'pvp', sourceKind: 'pvp' } ] }}
      loading={false} refreshing={false} error={null} onRefresh={vi.fn()} onOpenDetails={vi.fn()} onRegenerate={regenerate} />));
    for (const label of ['多人 · 房主', '多人 · 成员', 'PVP']) expect(container.textContent).toContain(label);
    await click('重生战报'); expect(regenerate).toHaveBeenCalledWith('host');
  });
  it.each([
    [{ contentBlocked: true, outputReadError: 'R2失败', contentExpired: true }, '已禁止浏览内容', '正文读取失败'],
    [{ outputReadError: 'R2失败', contentExpired: true }, '正文读取失败：R2失败', '当前仅保留'],
    [{ contentExpired: true }, '当前仅保留标题', '原始正文'],
    [{ outputPreview: null, hasPreview: false }, '暂无可用预览', '原始正文'],
  ])('renders body status priority without confusing it with empty history', async (patch, expected, absent) => {
    await act(async () => root.render(<BattleReportDetailsView isOpen generationId="generation-1" data={{ ...detail, record: { ...detail.record, ...patch } }} loading={false} error={null} onClose={vi.fn()} onRetry={vi.fn()} />));
    expect(document.body.textContent).toContain(expected); expect(document.body.textContent).not.toContain(absent);
  });
  it('renders only text and reuses BaseModal focus, Tab, Escape and focus return', async () => {
    function Harness() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>打开详情</button><BattleReportDetailsView isOpen={open} generationId="generation-1" data={detail} loading={false} error={null} onClose={() => setOpen(false)} onRetry={vi.fn()} /></>; }
    await act(async () => root.render(<Harness />)); const opener = button('打开详情'); opener.focus(); await click('打开详情');
    const dialog = document.querySelector('[role="dialog"]')!; expect(dialog).not.toBeNull(); expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.querySelector('script')).toBeNull(); expect(dialog.querySelector('pre')?.textContent?.trim()).toBe(detail.record.outputPreview);
    const buttons = dialog.querySelectorAll('button'); buttons[buttons.length - 1]!.focus();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener);
  });
});
