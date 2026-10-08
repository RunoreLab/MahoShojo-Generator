// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CharacterManagerArenaHistorySection, type ArenaHistoryLike } from '../src/character-manager/arena-history-section';
import { CharacterManagerCurrentStateSection } from '../src/character-manager/current-state-section';
import { CurrentStatePanel } from '../src/character-card/CurrentStatePanel';
import { ArenaHistoryBlock } from '../src/character-card/internals';
import { ArenaHistoryEntrySchema } from '@mahoshojo/domain/data-card-schemas';
import type { CharacterCurrentState, CurrentStateField, ArenaHistory } from '@mahoshojo/domain/arena-types';

let container: HTMLDivElement;
let root: Root;
const Markdown = ({ content }: { content: string }) => <p>{content}</p>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it.each([{ summary: 1 }, { summary: '摘要', fields: [null] }])('does not crash or rewrite malformed optional current state %j', (value) => {
  const original = JSON.stringify(value);
  expect(() => act(() => root.render(<CurrentStatePanel state={value as unknown as CharacterCurrentState} Markdown={Markdown} />))).not.toThrow();
  expect(container.textContent).toContain('当前状态格式暂不支持预览');
  expect(JSON.stringify(value)).toBe(original);
});

it('keeps valid current-state content and omits an invalid optional timestamp', () => {
  act(() => root.render(<CurrentStatePanel state={{ summary: '仍在战斗', fields: [{ id: 'hp', label: '生命', type: 'number', value: 42 }], updated_at: 'not-a-date' }} Markdown={Markdown} />));
  expect(container.textContent).toContain('仍在战斗');
  expect(container.textContent).toContain('生命');
  expect(container.textContent).toContain('42');
  expect(container.textContent).not.toContain('Invalid Date');
});

it('opens mixed legacy history safely, keeps valid order and leaves source bytes unchanged', () => {
  const value = { entries: [
    { id: 1, title: '较早', type: 'classic', impact: '旧正文' },
    null,
    { id: 2, title: { invalid: true }, impact: ['invalid'] },
    { id: 3, title: '较新', type: 'scenario', impact: '新正文' },
  ] };
  const original = JSON.stringify(value);
  act(() => root.render(<ArenaHistoryBlock history={value as unknown as ArenaHistory} Markdown={Markdown} />));
  expect(() => act(() => container.querySelector('button')!.click())).not.toThrow();
  expect(container.textContent).toContain('2 条历战记录格式暂不支持预览');
  expect(container.textContent!.indexOf('较新')).toBeLessThan(container.textContent!.indexOf('较早'));
  expect(JSON.stringify(value)).toBe(original);
});


it('keeps malformed optional state read-only in the structured editor without a cleanup write', () => {
  const value = { summary: 1, fields: [null], future: { keep: true } };
  const original = JSON.stringify(value); const change = vi.fn();
  act(() => root.render(<CharacterManagerCurrentStateSection state={value as unknown as CharacterCurrentState} onChange={change} />));
  expect(container.textContent).toContain('暂不支持结构化编辑');
  expect(container.querySelector('pre')?.textContent).toContain('"future"');
  expect(change).not.toHaveBeenCalled();
  expect(JSON.stringify(value)).toBe(original);
});

it('deletes only the clicked history position even with null entries and repeated ids', () => {
  const value = { entries: [null, { id: 'duplicate', title: '第一条' }, { id: 'duplicate', title: '第二条' }], future: { keep: true } };
  const original = JSON.stringify(value); const change = vi.fn();
  act(() => root.render(<CharacterManagerArenaHistorySection history={value as unknown as ArenaHistoryLike} onChange={change} />));
  expect(container.textContent).toContain('原始记录仍保留');
  expect(change).not.toHaveBeenCalled();
  const deletes = [...container.querySelectorAll('button')].filter((button) => button.textContent === '删除');
  act(() => deletes[1].click());
  expect(change).toHaveBeenCalledExactlyOnceWith({ ...value, entries: [null, value.entries[2]] });
  expect(JSON.stringify(value)).toBe(original);
});

it('keeps an empty field label editable while renaming and preserves field extensions', () => {
  const change = vi.fn();
  function Editor() {
    const [state, setState] = useState<CharacterCurrentState>({ summary: '', fields: [{ id: 'one', label: '旧名称', type: 'string', value: '内容', future: '保留' } as CurrentStateField] });
    return <CharacterManagerCurrentStateSection state={state} onChange={(next) => { change(next); setState(next); }} />;
  }
  act(() => root.render(<Editor />));
  const enter = (value: string) => {
    const input = container.querySelector<HTMLInputElement>('input[placeholder="字段名称"]')!;
    expect(input).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  enter('');
  expect(container.querySelector('input[placeholder="字段名称"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  enter('新名称');
  expect(change.mock.lastCall?.[0].fields[0]).toMatchObject({ label: '新名称', future: '保留' });
});


it('preserves top-level and field extensions across real summary edits and field changes', () => {
  const value = { summary: '旧摘要', generation_id: 'generation', base_revision_hash: 'revision',
    future_extension: { nested: ['原样'] }, fields: [{ id: 'one', label: '名称', type: 'string' as const, value: '内容', future_extension: { keep: true } }] };
  const original = JSON.stringify(value); const change = vi.fn();
  function Editor() {
    const [state, setState] = useState<CharacterCurrentState>(value);
    return <CharacterManagerCurrentStateSection state={state} onChange={(next) => { change(next); setState(next); }} />;
  }
  act(() => root.render(<Editor />));
  const textarea = container.querySelector('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '新摘要');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(change.mock.lastCall?.[0]).toMatchObject({ ...value, summary: '新摘要' });
  const input = container.querySelector('input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(change.mock.lastCall?.[0]).toMatchObject({ ...value, summary: '新摘要', fields: [{ ...value.fields[0], label: '' }] });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(JSON.stringify(value)).toBe(original);
});

it.each(['string', 'number', 'boolean'] as const)('explicitly associates summary and %s field labels across editor instances', (type) => {
  const state = { summary: '', fields: [{ id: 'same', label: '', type, value: type === 'boolean' ? false : type === 'number' ? 0 : '' }] };
  act(() => root.render(<><CharacterManagerCurrentStateSection state={state} onChange={vi.fn()} /><CharacterManagerCurrentStateSection state={state} onChange={vi.fn()} /></>));
  const controls = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')];
  expect(controls).toHaveLength(8);
  expect(new Set(controls.map((control) => control.id)).size).toBe(controls.length);
  for (const control of controls) {
    expect(control.id).not.toBe('');
    expect(control.labels?.length).toBeGreaterThan(0);
    expect(control.labels?.[0].htmlFor).toBe(control.id);
    expect(control.labels?.[0].textContent?.trim()).not.toBe('');
  }
});

it('previews legacy string ids without weakening canonical validation or mutating source records', () => {
  const value = { entries: [
    { id: 1, title: '数字记录', impact: '数字正文' },
    { id: 'old-id', title: '旧记录', impact: '旧正文', metadata: { future: true } },
    { id: { invalid: true }, title: '不可显示', impact: '保留' },
    { id: 'invalid-title', title: { invalid: true }, impact: '保留' },
  ] };
  const original = JSON.stringify(value);
  expect(ArenaHistoryEntrySchema.safeParse(value.entries[1]).success).toBe(false);
  act(() => root.render(<ArenaHistoryBlock history={value as unknown as ArenaHistory} Markdown={Markdown} />));
  act(() => container.querySelector('button')!.click());
  expect(container.textContent).toContain('旧记录');
  expect(container.textContent).toContain('旧正文');
  expect(container.textContent).toContain('数字正文');
  expect(container.textContent).toContain('2 条历战记录格式暂不支持预览');
  expect(container.textContent!.indexOf('旧记录')).toBeLessThan(container.textContent!.indexOf('数字记录'));
  act(() => container.querySelector('button')!.click());
  act(() => container.querySelector('button')!.click());
  expect(JSON.stringify(value)).toBe(original);
});
