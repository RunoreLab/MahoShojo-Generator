// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
const host = vi.hoisted(() => ({ paste: vi.fn(), upload: vi.fn(), save: vi.fn(), preference: vi.fn() }));
vi.mock('@/components/arena/hooks/useBattleActions', () => ({ useBattleActions: () => ({ handleFileUpload: host.upload, handlePaste: host.paste }) }));
vi.mock('@/lib/local-library/preferences', () => ({ useLocalLibraryPreferences: () => ({ preferences: { saveImportedDataCards: true }, setPreference: host.preference }) }));
vi.mock('@/lib/local-library/use-local-library-auto-save', () => ({ useLocalLibraryAutoSave: () => ({ save: host.save, error: null, result: null }) }));
import { RosterUploader } from '@/components/arena/components/RosterUploader';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.resetAllMocks(); });
describe('Web roster import host with shared form', () => {
  it('retains rejected paste, persists accepted cards and clears only accepted input', async () => {
    useBattleStore.setState(useBattleStore.getInitialState(), true);
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<RosterUploader />));
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      const textarea = container.querySelector('textarea')!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '{ card }'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
      const submit = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('从文本添加角色'))!;
      host.paste.mockRejectedValueOnce(new Error('invalid character'));
      await act(async () => submit.click());
      expect(textarea.value).toBe('{ card }'); expect(useBattleStore.getState().error).toBe('invalid character'); expect(host.save).not.toHaveBeenCalled();
      host.paste.mockResolvedValueOnce([{ filename: 'card.json', data: { name: '翠雀' } }]);
      await act(async () => submit.click());
      expect(host.save).toHaveBeenCalledWith([{ cardType: 'character', title: 'card.json', payload: { name: '翠雀' } }]);
      expect(textarea.value).toBe(''); expect(useBattleStore.getState().error).toBeNull();
      await act(async () => useBattleStore.setState({ isGenerating: true }));
      expect(container.querySelector<HTMLInputElement>('#file-upload')!.disabled).toBe(true); expect(textarea.disabled).toBe(true);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
