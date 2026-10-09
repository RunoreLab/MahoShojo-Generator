// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { readQuestionnaireJsonFile } from '../src/questionnaire-editor/file';
import { LocalQuestionnairePanel } from '../src/questionnaire-editor/local-panel';
let container: HTMLDivElement;
let root: Root;
const saveCard = vi.fn(async (_data: Record<string, unknown>, _title: string): Promise<'saved' | 'already-present'> => 'saved');
const downloadText = vi.fn();
const dirty = vi.fn();
const confirmReplace = vi.fn(() => true);
const list = vi.fn(async () => ({ items: [] as unknown[], nextCursor: undefined as string | undefined }));
const get = vi.fn();
const repository = { list, get } as unknown as CardRepository;
function button(text: string) { const result = [...container.querySelectorAll('button')].find((node) => node.textContent === text); if (!result) throw new Error(text); return result; }
async function click(text: string) { await act(async () => button(text).click()); }
function edit(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
function field(label: string) { const node = [...container.querySelectorAll('label')].find((node) => node.textContent === label); if (!node) throw new Error(label); return node.nextElementSibling as HTMLInputElement; }
function paste(text: string) { edit(container.querySelector('[aria-label="粘贴问卷 JSON"]') as HTMLTextAreaElement, text); }
function data() { return JSON.parse(container.querySelector('pre')!.textContent!); }
const original = { id: 'test', kind: 'magical-girl', title: '已有问卷', nativeAllowed: true, signature: 'unverified', extension: { keep: true }, questions: [{ id: 'q1', question: '第一题', type: 'select', options: [{ label: 'A', value: 'A', extra: true }], displayIf: { questionId: 'q0', questionnaireId: 'other', value: ['A|B', 'C'] } }, { id: 'q2', question: '第二题' }] };
async function load(value: unknown = original) { paste(JSON.stringify(value)); await click('应用粘贴内容'); }
beforeEach(() => { vi.clearAllMocks(); list.mockResolvedValue({ items: [], nextCursor: undefined }); confirmReplace.mockReturnValue(true); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); act(() => root.render(<LocalQuestionnairePanel repository={repository} saveCard={saveCard} downloadText={downloadText} confirmReplace={confirmReplace} onDirtyChange={dirty} />)); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('local questionnaire editor', () => {
  it('loads, edits, reorders and saves using the shared editor, retaining extensions and source', async () => {
    await load();
    expect(data().nativeAllowed).toBe(false); expect(data()).not.toHaveProperty('signature');
    expect(data().questions[0].displayIf).toEqual(original.questions[0].displayIf);
    expect(container.textContent).toContain('高级 JSON 中的条件');
    edit(field('问卷标题'), '编辑后'); await click('下移');
    expect(data().title).toBe('编辑后'); expect(data().questions[0].id).toBe('q2');
    await click('另存到本地问卷库'); expect(saveCard).toHaveBeenCalledWith(data(), '编辑后'); expect(dirty).toHaveBeenLastCalledWith(false);
    await click('下载编辑 JSON'); expect(JSON.parse(downloadText.mock.calls[0][0])).toEqual(data());
    await click('下载原始来源'); expect(JSON.parse(downloadText.mock.calls[1][0])).toEqual(original);
    expect(data().questions[1].options[0].extra).toBe(true);
  });
  it('preserves draft and pasted input after invalid import and canceled replacement', async () => {
    await load(); const before = data(); paste('{broken'); await click('应用粘贴内容');
    expect(data()).toEqual(before); expect((container.querySelector('[aria-label="粘贴问卷 JSON"]') as HTMLTextAreaElement).value).toBe('{broken');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    confirmReplace.mockReturnValue(false); paste(JSON.stringify({ ...original, title: '替换' })); await click('应用粘贴内容');
    expect(data()).toEqual(before); expect(confirmReplace).toHaveBeenCalled();
  });
  it('blocks save for invalid advanced JSON, retaining input and original download', async () => {
    await load(); const label = [...container.querySelectorAll('label')].find((node) => node.textContent === '额外字段 JSON（可选）')!;
    edit(label.parentElement!.querySelector('textarea')!, 'null');
    expect(button('另存到本地问卷库').disabled).toBe(true); expect(button('下载编辑 JSON').disabled).toBe(true);
    await click('下载原始来源'); expect(downloadText).toHaveBeenCalledTimes(1);
  });
  it('clears save feedback when editing again and rejects invalid UTF-8 before import', async () => {
    await load(); await click('另存到本地问卷库'); expect(container.textContent).toContain('已另存为本地未签名问卷');
    edit(field('问卷标题'), '再次修改'); expect(container.textContent).not.toContain('已另存为本地未签名问卷');
    const arrayBuffer = vi.fn(async () => new Uint8Array([0xff]).buffer);
    await expect(readQuestionnaireJsonFile({ size: 1, arrayBuffer })).rejects.toThrow('UTF-8');
    const bom = '\uFEFF' + JSON.stringify({ ...original, title: '中文问卷' });
    await expect(readQuestionnaireJsonFile({ size: new TextEncoder().encode(bom).length, arrayBuffer: async () => new TextEncoder().encode(bom).buffer })).resolves.toBe(bom);
    arrayBuffer.mockClear(); await expect(readQuestionnaireJsonFile({ size: 1024 * 1024 + 1, arrayBuffer })).rejects.toThrow('1 MiB'); expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it('takes over advanced conditions explicitly without reviving them after disabling', async () => {
    await load(); const labels = [...container.querySelectorAll('label')];
    const toggle = labels.find((node) => node.textContent?.includes('启用条件显示'))?.querySelector('input');
    expect(toggle).toBeTruthy(); await act(async () => toggle!.click());
    edit(field('引用题目 ID'), 'q0');
    expect(data().questions[0].displayIf).not.toHaveProperty('questionnaireId');
    await act(async () => toggle!.click()); expect(data().questions[0]).not.toHaveProperty('displayIf');
  });
  it('single-flights save, retains failed edits, and guards newer input during load', async () => {
    await load(); let reject!: (error: Error) => void;
    saveCard.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await click('另存到本地问卷库'); await click('另存到本地问卷库'); expect(saveCard).toHaveBeenCalledTimes(1);
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    await act(async () => reject(new Error('磁盘写入失败'))); expect(container.textContent).toContain('磁盘写入失败'); expect(dirty).toHaveBeenLastCalledWith(true);
    await click('另存到本地问卷库'); expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('filters and reloads questionnaire sources, refuses deleted records', async () => {
    list.mockResolvedValue({ items: [{ id: 'one', title: '本地问卷', cardType: 'questionnaire' }, { id: 'two', title: '角色不应出现', cardType: 'character' }], nextCursor: 'next' });
    await click('打开本地问卷库'); expect(list).toHaveBeenCalledWith({ cardTypes: ['questionnaire'], limit: 100 }); expect(container.textContent).not.toContain('角色不应出现');
    get.mockResolvedValue({ id: 'one', title: '本地问卷', cardType: 'questionnaire', deletedAt: 'deleted', data: original });
    await click('本地问卷'); expect(container.textContent).toContain('问卷已不可用');
    get.mockResolvedValue({ id: 'one', title: '本地问卷', cardType: 'questionnaire', data: original }); await click('本地问卷'); expect(data().title).toBe('已有问卷');
    await click('继续查找下一页'); expect(list).toHaveBeenLastCalledWith({ cardTypes: ['questionnaire'], limit: 100, cursor: 'next' });
  });
});
