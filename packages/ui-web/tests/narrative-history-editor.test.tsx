// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NarrativeHistoryEditor, type NarrativeHistoryEditorProps } from '../src/narrative-history';
import type { NarrativeHistoryEntry } from '@mahoshojo/domain/arena-types';
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;
const a: NarrativeHistoryEntry = { id: 'original-a', title: 'First', content: 'A', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const b: NarrativeHistoryEntry = { ...a, id: 'original-b', title: 'Second', content: 'B', updatedAt: '2026-02-01' };
const props = (overrides: Partial<NarrativeHistoryEditorProps> = {}): NarrativeHistoryEditorProps => ({ isOpen: true, onClose: vi.fn(), entries: [a, b], lastUpdatedAt: null, sort: 'updated_desc', onSortChange: vi.fn(), formatDateTime: (value) => value, onCreate: vi.fn((input) => ({ ...a, ...input })), onUpdate: vi.fn((id, input) => ({ ...a, id, ...input })), onDelete: vi.fn(), onClear: vi.fn(), onMove: vi.fn(), onReorder: vi.fn(), onImportText: vi.fn(), onImportFile: vi.fn(), onExport: vi.fn(), requestDiscard: vi.fn(() => false), confirmAction: vi.fn(() => false), ...overrides });
async function render(element: ReactElement) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(element)); }
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });
async function click(text: string) { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text)); expect(button, text).toBeTruthy(); await act(async () => button!.click()); }
async function input(element: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function edit(value: string) { await input(document.querySelector('[aria-label="历史正文"]') as HTMLTextAreaElement, value); }
async function pick(text: string) { const entry = [...document.querySelectorAll('[role="button"]')].find((item) => item.textContent?.includes(text)); await act(async () => (entry as HTMLElement).click()); }
describe('active narrative editor controls', () => {
  it('display sort never mutates prompt order; reorder uses original IDs', async () => {
    const p = props(); await render(<NarrativeHistoryEditor {...p} />); expect(document.querySelector('[role="button"]')?.textContent).toContain('Second'); expect(p.onReorder).not.toHaveBeenCalled();
    await click('编辑 AI 顺序'); expect(document.querySelector('[role="button"]')?.textContent).toContain('First'); await click('下移'); expect(p.onMove).toHaveBeenCalledWith('original-a', 'down');
  });
  it('dirty edit cannot be dismissed by back or Escape without discard approval', async () => {
    const dirty = vi.fn(); const p = props({ onDirtyChange: dirty }); await render(<NarrativeHistoryEditor {...p} />); await pick('First'); await edit('unsaved'); expect(dirty).toHaveBeenLastCalledWith(true);
    await click('返回列表'); expect(p.requestDiscard).toHaveBeenCalledOnce(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(p.onClose).not.toHaveBeenCalled(); expect((document.querySelector('[aria-label="历史正文"]') as HTMLTextAreaElement).value).toBe('unsaved');
  });
  it('saves once while pending and resets dirty only after success', async () => {
    let resolve!: (value: NarrativeHistoryEntry) => void; const save = vi.fn(() => new Promise<NarrativeHistoryEntry>((done) => { resolve = done; })); const busy = vi.fn(), dirty = vi.fn(); const p = props({ onUpdate: save, onBusyChange: busy, onDirtyChange: dirty });
    await render(<NarrativeHistoryEditor {...p} />); await pick('First'); await edit('new body'); await click('保存修改'); await click('保存中'); expect(save).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledWith('original-a', { title: 'First', content: 'new body' }); expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => (document.querySelector('[aria-label="关闭叙事历史"]') as HTMLButtonElement).click()); expect(p.onClose).not.toHaveBeenCalled(); await act(async () => resolve({ ...a, content: 'new body' })); expect(dirty).toHaveBeenLastCalledWith(false); expect(busy).toHaveBeenLastCalledWith(false);
  });
  it('delete and clear require confirmation; cancelled imports preserve paste', async () => {
    const p = props({ onImportText: vi.fn(() => ({ cancelled: true })) }); await render(<NarrativeHistoryEditor {...p} />); await click('清空'); expect(p.onClear).not.toHaveBeenCalled(); await pick('First'); await click('删除'); expect(p.onDelete).not.toHaveBeenCalled(); await click('返回列表'); await click('粘贴导入');
    const field = document.querySelector('textarea')!; await input(field, '[{"entries":[]}]'); await click('确认追加导入'); expect(p.onImportText).toHaveBeenCalledWith('[{"entries":[]}]', 'append'); expect(field.value).toContain('entries');
  });
  it('late save after scope change cannot replace visible text', async () => {
    let resolve!: (value: NarrativeHistoryEntry) => void; const p = props({ scopeKey: 'old', onUpdate: () => new Promise((done) => { resolve = done; }) }); await render(<NarrativeHistoryEditor {...p} />); await pick('First'); await edit('old pending'); await click('保存修改');
    await act(async () => root.render(<NarrativeHistoryEditor {...p} scopeKey="new" />)); await act(async () => resolve({ ...a, content: 'late filtered content' })); expect(document.querySelector('[aria-label="历史正文"]')).toBeNull(); expect(document.body.textContent).not.toContain('late filtered content');
  });
});
