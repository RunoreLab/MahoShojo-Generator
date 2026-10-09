// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { LocalTeamPanel } from '../src/team/local-panel';
import { readTeamFile } from '../src/team/file';

let container: HTMLDivElement;
let root: Root;
const saveCard = vi.fn<(data: Record<string, unknown>, name: string) => Promise<'saved' | 'already-present'>>(async () => 'saved');
const downloadJson = vi.fn();
const dirty = vi.fn();
const repository = { list: vi.fn(async () => ({ items: [], nextCursor: undefined })), get: vi.fn() } as unknown as CardRepository;
function button(text: string) { const result = [...container.querySelectorAll('button')].find((node) => node.textContent === text); if (!result) throw new Error(text); return result; }
async function click(text: string) { await act(async () => button(text).click()); }
function edit(label: string, value: string) {
  const input = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
function data() { return JSON.parse(container.querySelector('pre')!.textContent!); }
async function add(value: unknown) { edit('粘贴队员 JSON', JSON.stringify(value)); await click('解析并添加'); }
beforeEach(() => { vi.clearAllMocks(); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); act(() => root.render(<LocalTeamPanel repository={repository} saveCard={saveCard} downloadJson={downloadJson} renderPreview={() => <p>卡片预览</p>} onDirtyChange={dirty} />)); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('local party composition', () => {
  it('uses shared reorder/name/template controls and saves unsigned without altering sources', async () => {
    const originals = [{ codename: 'A', appearance: { outfit: '衣A' }, signature: 'native?', _native: 'true', _extra: { keep: '内容' } }, { codename: 'B', appearance: { outfit: '衣B' } }];
    await add(originals);
    edit('队员 1 标识', '甲'); await click('下移');
    expect(data().codename).toBe('B & 甲'); expect(data().appearance.outfit).toBe('【B】衣B\n\n【甲】衣A');
    expect(data()).not.toHaveProperty('signature'); expect(data()).not.toHaveProperty('_native'); expect(data()._extra.keep).toBe('【甲】内容');
    expect(dirty).toHaveBeenLastCalledWith(true);
    await click('保存到本地卡库'); expect(dirty).toHaveBeenLastCalledWith(false); expect(saveCard).toHaveBeenCalledTimes(1); expect(saveCard.mock.calls[0][0]).toEqual(data());
    await click('下载 JSON'); expect(downloadJson.mock.calls[0][0]).toEqual(data());
    await click('另存队员源 JSON'); expect(downloadJson.mock.calls[1][0]).toEqual([originals[1], originals[0]]);
    edit('输出模板', 'general'); expect(dirty).toHaveBeenLastCalledWith(true); expect(data().templateId).toBe('通用角色');
    await click('移除'); expect(data().name).toBe('甲'); await click('清空队伍'); expect(button('保存到本地卡库').disabled).toBe(true);
  });
  it('does not leave the host dirty for whitespace, unchanged labels or clearing a saved team', async () => {
    expect(dirty).toHaveBeenLastCalledWith(false);
    edit('粘贴队员 JSON', ' '); expect(dirty).toHaveBeenLastCalledWith(false);
    await add({ codename: 'A' }); await click('保存到本地卡库'); expect(dirty).toHaveBeenLastCalledWith(false);
    edit('队员 1 标识', 'A'); expect(dirty).toHaveBeenLastCalledWith(false);
    await click('清空队伍'); expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('keeps input and team on bad batches and prefix-budget failure, allowing correction', async () => {
    await add({ codename: 'A' }); await add([{ codename: 'B' }, null]);
    expect(data().codename).toBe('A'); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toContain('null');
    await click('清空队伍'); await add({ codename: 'A'.repeat(10_000), userAnswers: Array.from({ length: 1000 }, () => 'x') });
    expect(container.textContent).toContain('预计合并结果超过安全预算'); expect(button('下载 JSON').disabled).toBe(true);
    edit('队员 1 标识', ''); expect(button('下载 JSON').disabled).toBe(true);
    expect(button('另存队员源 JSON').disabled).toBe(false);
    edit('队员 1 标识', '短名'); expect(data().codename).toBe('短名');
  });
  it('single-flights saving and retains a failed result for retry', async () => {
    let reject!: (cause: Error) => void;
    saveCard.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await add({ codename: 'A' }); await click('保存到本地卡库'); await click('保存到本地卡库');
    expect(saveCard).toHaveBeenCalledTimes(1); expect(button('清空队伍').disabled).toBe(true);
    await act(async () => reject(new Error('磁盘不可用')));
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(container.textContent).toContain('磁盘不可用'); expect(data().codename).toBe('A');
    await click('保存到本地卡库'); expect(saveCard).toHaveBeenCalledTimes(2);
  });

  it('ignores a late local-card selection after newer input and reports library errors', async () => {
    const card = { id: 'local-a', cardType: 'character', title: '本地A', data: { codename: '本地A' } };
    vi.mocked(repository.list).mockResolvedValueOnce({ items: [card], nextCursor: undefined } as never);
    await click('从本地卡库读取角色卡');
    let resolve!: (value: unknown) => void;
    vi.mocked(repository.get).mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as never);
    await click('本地A');
    await add({ codename: '新输入' });
    await act(async () => resolve(card));
    expect(data().codename).toBe('新输入');
    vi.mocked(repository.list).mockRejectedValueOnce(new Error('离线磁盘'));
    await click('刷新本地角色卡'); expect(container.textContent).toContain('本地库读取失败');
  });
  it('reads a file batch atomically, then allows retry after one invalid file', async () => {
    const file = (name: string, text: string) => ({ name, size: text.length, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
    const input = container.querySelector('[aria-label="上传队员 JSON"]')!;
    const choose = async (files: unknown[]) => {
      Object.defineProperty(input, 'files', { configurable: true, value: files });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    };
    await choose([file('a.json', '{"codename":"A"}'), file('bad.json', '{')]);
    expect(data().name).toBe('空队伍');
    await choose([file('a.json', '{"codename":"A"}'), file('b.json', '{"codename":"B"}')]);
    expect(data().codename).toBe('A & B');
  });
  it('rejects oversized files before reading and checks returned bytes too', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    await expect(readTeamFile({ name: 'a.json', size: 1024 * 1024 + 1, arrayBuffer })).rejects.toThrow(/1 MiB/); expect(arrayBuffer).not.toHaveBeenCalled();
    await expect(readTeamFile({ name: 'a.json', size: 1, arrayBuffer: async () => new ArrayBuffer(1024 * 1024 + 1) })).rejects.toThrow(/1 MiB/);
  });
});
