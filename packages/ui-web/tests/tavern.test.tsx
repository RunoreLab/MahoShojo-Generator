// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TavernCandidateSelector, TavernFileInput, TavernLocalProjection, TavernOriginalExport, TavernLocalSources, useTavernSourceSelection, readTavernFile } from '../src/tavern';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { convertTavernToGeneralCard, MAX_TAVERN_TEXT_BYTES, MAX_TAVERN_FILE_BYTES, type TavernCardCandidate } from '@mahoshojo/domain/tavern-card';
let root: Root; let container: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const candidate: TavernCardCandidate = { keyword: 'json', chunkType: 'tEXt', parseMethod: 'json', parsed: { name: '未知/角色', description: '中文', extension: { keep: true } } };
describe('shared Tavern original journey controls', () => {
  it('supports PNG/JSON and repeated selection of the same file', () => {
    const select = vi.fn(); act(() => root.render(<TavernFileInput onFileSelected={select} />));
    const input = container.querySelector('input')!; expect(input.accept).toContain('.json');
    const file = new File(['{}'], 'same.json'); Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(select).toHaveBeenCalledTimes(2); expect(input.value).toBe('');
  });
  it('keeps candidate selection controlled and disabled during a host operation', () => {
    const select = vi.fn(); act(() => root.render(<TavernCandidateSelector candidates={[candidate, { ...candidate, keyword: 'chara' }]} selectedIndex={0} onSelect={select} disabled />));
    expect([...container.querySelectorAll('input')].every((input) => input.disabled)).toBe(true);
    expect(container.querySelector('input')!.checked).toBe(true);
  });
  it('exports semantic original JSON with correct extension and reports dispatch, not confirmed filesystem save', async () => {
    const exportFile = vi.fn(); act(() => root.render(<TavernOriginalExport candidate={candidate} exportFile={exportFile} />));
    await act(async () => container.querySelector('button')!.click());
    expect(exportFile.mock.calls[0][0].name).toMatch(/\.json$/); expect(JSON.parse(new TextDecoder().decode(exportFile.mock.calls[0][0].bytes))).toEqual(candidate.parsed);
    expect(container.textContent).toContain('已发起下载'); expect(container.textContent).toContain('统一为所选候选');
  });
  it('single-flights local writes and hides late results from a previous selected source', async () => {
    let resolve!: (result: 'saved') => void; const save = vi.fn(() => new Promise<'saved'>((done) => { resolve = done; }));
    const data = convertTavernToGeneralCard(candidate); const next = { ...data, name: 'next' };
    act(() => root.render(<TavernLocalProjection data={data} exportFile={vi.fn()} saveCard={save} />));
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes('保存通用卡'))!;
    act(() => { button.click(); button.click(); }); expect(save).toHaveBeenCalledTimes(1);
    act(() => root.render(<TavernLocalProjection data={next} exportFile={vi.fn()} saveCard={save} />));
    await act(async () => resolve('saved')); expect(container.textContent).not.toContain('已保存到本地卡库');
  });
  it('ignores an earlier delayed library read after a newer file intent and discloses unreadable rows', async () => {
    let resolve!: (item: unknown) => void;
    const item = { id: 'card-a', cardType: 'character', title: 'Card A', data: { _tavern: { raw: candidate.parsed } } };
    const repository = { list: async () => ({ items: [item], unreadable: ['broken'], nextCursor: undefined }), get: () => new Promise((done) => { resolve = done; }) } as unknown as CardRepository;
    const onSource = vi.fn();
    function Harness() { const selection = useTavernSourceSelection(); return <><button onClick={() => { selection.begin(); onSource('file-b'); }}>New file</button><TavernLocalSources repository={repository} selection={selection} onSource={onSource} /></>; }
    act(() => root.render(<Harness />));
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('从本地'))!.click());
    expect(container.textContent).toContain('1 条本地记录暂不可读');
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Card A')!.click());
    act(() => container.querySelector('button')!.click());
    await act(async () => resolve(item));
    expect(onSource).toHaveBeenCalledTimes(1); expect(onSource).toHaveBeenCalledWith('file-b');
  });
  it.each([['large.png', MAX_TAVERN_FILE_BYTES + 1], ['large.json', MAX_TAVERN_TEXT_BYTES + 1]])('rejects %s before materializing bytes', async (name, size) => {
    const arrayBuffer = vi.fn(); await expect(readTavernFile({ name: name as string, size: size as number, arrayBuffer })).rejects.toThrow('上限'); expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
