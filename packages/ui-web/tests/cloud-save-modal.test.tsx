// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveCardModal } from '../src/cloud-save';
import { BaseModal } from '../src/modal';
let root: Root; let container: HTMLDivElement;
const close = vi.fn(); const save = vi.fn();
const props = { isOpen: true, onClose: close, onSave: save, name: '卡', description: '描述', isPublic: 0,
  onNameChange: vi.fn(), onDescriptionChange: vi.fn(), onPublicChange: vi.fn(), error: null, data: { name: '卡' } };
const render = (saving = false, above = false) => act(async () => {
  root.render(<><SaveCardModal {...props} isSaving={saving} privateOnly /><BaseModal isOpen={above} title="检查我的云端卡" onClose={() => {}}>云卡</BaseModal></>);
  await new Promise((resolve) => setTimeout(resolve, 0));
});
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; close.mockReset(); save.mockReset(); document.body.style.overflow = 'auto'; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('shared actual cloud-save modal', () => {
  it('uses unknown capacity, private-only controlled fields and estimates without promising success', async () => {
    await render(); expect(document.body.textContent).toContain('云端容量未知'); expect(document.body.textContent).toContain('估算不保证可保存');
    expect(document.querySelector('input[type=checkbox]')).toBeNull(); expect(document.querySelector('input')?.maxLength).toBe(20); expect(document.querySelector('textarea')?.maxLength).toBe(300);
    const submit = [...document.querySelectorAll('button')].find((b) => b.textContent === '保存')!; expect(submit.disabled).toBe(false);
  });
  it('saving consumes Escape and blocks close/backdrop/cancel', async () => {
    await render(true); await act(async () => {
      for (const button of document.querySelectorAll<HTMLButtonElement>('[aria-label="关闭"]')) button.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }); expect(close).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('button')].find((b) => b.textContent === '取消')?.disabled).toBe(true);
  });
  it('retains lower modal scroll lock after the checking layer closes', async () => {
    await render(false, true); expect(document.querySelectorAll('[role=dialog]')).toHaveLength(2);
    await render(false, false); expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1); expect(document.body.style.overflow).toBe('hidden');
    act(() => root.unmount()); expect(document.body.style.overflow).toBe('auto'); root = createRoot(container);
  });
});
