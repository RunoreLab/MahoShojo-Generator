// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileSignatureField, useProfileSignatureEditor, normalizeProfileSignature, type ProfileSignatureEditorState } from '../src/settings';
let root: Root; let container: HTMLDivElement; let editor: ProfileSignatureEditorState;
let props: Parameters<typeof useProfileSignatureEditor>[0];
const Harness = () => { editor = useProfileSignatureEditor(props); return <ProfileSignatureField editor={editor} />; };
const render = () => act(async () => root.render(<Harness />));
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  props = { scope: 'A:0', signature: undefined, canSave: true, save: vi.fn(async (value) => value) };
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('profile personal signature shared editor', () => {
  it('loads nonempty data once and never permits a blank write before data arrives', async () => {
    await render(); expect(editor.loaded).toBe(false); expect(container.querySelector('textarea')?.disabled).toBe(true);
    await act(() => editor.submit()); expect(props.save).not.toHaveBeenCalled();
    props.signature = '原有签名'; await render(); expect(editor.draft).toBe('原有签名'); expect(editor.dirty).toBe(false);
    props.signature = '刷新签名'; await render(); expect(editor.draft).toBe('刷新签名');
  });
  it('retains a dirty draft on refetch and requires explicit discard or overwrite', async () => {
    props.signature = '原有'; await render(); act(() => editor.change('草稿'));
    props.signature = '另一端更新'; await render(); expect(editor.draft).toBe('草稿'); expect(editor.conflict).toBe(true);
    act(() => editor.discard()); expect(editor.draft).toBe('另一端更新'); expect(editor.dirty).toBe(false);
  });
  it('uses only confirmed canonical success and single-flights repeated clicks', async () => {
    const pending = deferred<string>(); props = { ...props, signature: '原有', save: vi.fn(() => pending.promise) }; await render();
    act(() => editor.change('新签名')); act(() => { void editor.submit(); void editor.submit(); });
    expect(props.save).toHaveBeenCalledTimes(1); expect(editor.saved).toBe(false);
    await act(async () => pending.resolve('服务器确认')); expect(editor.draft).toBe('服务器确认'); expect(editor.saved).toBe(true);
  });
  it('retains newer edits made while saving and never marks them saved', async () => {
    const pending = deferred<string>(); props = { ...props, signature: '原有', save: () => pending.promise }; await render();
    act(() => editor.change('提交')); act(() => { void editor.submit(); }); act(() => editor.change('较新草稿'));
    await act(async () => pending.resolve('提交')); expect(editor.draft).toBe('较新草稿'); expect(editor.dirty).toBe(true); expect(editor.saved).toBe(false);
  });
  it('retains failure draft and retries only on another explicit submit', async () => {
    props = { ...props, signature: '原有', save: vi.fn().mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce('草稿') }; await render();
    act(() => editor.change('草稿')); await act(() => editor.submit()); expect(editor.error).toBe('连接中断'); expect(editor.draft).toBe('草稿'); expect(editor.saved).toBe(false);
    await render(); expect(props.save).toHaveBeenCalledTimes(1); await act(() => editor.submit()); expect(props.save).toHaveBeenCalledTimes(2); expect(editor.saved).toBe(true);
  });
  it('confirms a matching explicit readback after an uncertain write', async () => {
    props = { ...props, signature: '原有', save: vi.fn().mockRejectedValue(new Error('连接中断')) }; await render();
    act(() => editor.change('草稿')); await act(() => editor.submit());
    props.signature = '草稿'; await render(); expect(editor.error).toBeNull(); expect(editor.saved).toBe(true); expect(editor.dirty).toBe(false);
    expect(props.save).toHaveBeenCalledTimes(1);
  });
  it.each(['B:0', 'A:1', null])('discards late A success and draft on scope change to %s', async (scope) => {
    const pending = deferred<string>(); props = { ...props, signature: 'A资料', save: () => pending.promise }; await render();
    act(() => editor.change('A草稿')); act(() => { void editor.submit(); }); props = { ...props, scope, signature: scope ? '新资料' : undefined }; await render();
    if (scope) act(() => editor.change('新草稿'));
    await act(async () => pending.resolve('A已存')); expect(editor.draft).toBe(scope ? '新草稿' : ''); expect(editor.saved).toBe(false); expect(editor.saving).toBe(false);
  });
  it('normalizes CRLF and caps UTF-16 without cutting a surrogate pair', () => {
    expect(normalizeProfileSignature('一\r\n二')).toBe('一\n二'); expect(normalizeProfileSignature('x'.repeat(121))).toHaveLength(120);
    expect(normalizeProfileSignature('x'.repeat(119) + '🌸')).toBe('x'.repeat(119));
  });
});
