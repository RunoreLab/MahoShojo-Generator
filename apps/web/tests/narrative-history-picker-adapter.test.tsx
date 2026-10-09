// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NarrativeHistoryPickerModal } from '@/components/arena/components/NarrativeHistoryPickerModal';
import { useNarrativeHistoryStore } from '@/components/arena/stores/useNarrativeHistoryStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('Web adapter uses the original store and shared picker without stripping extensions or changing prompt order', async () => {
  const entries = [{ id: 'old-string-id', title: '既有战报', content: '原正文', createdAt: '2020-01-01', updatedAt: '2020-01-01', extension: true }];
  useNarrativeHistoryStore.setState({ entries, sort: 'updated_desc', lastUpdatedAt: '2020-01-01' });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const onConfirm = vi.fn();
  try {
    await act(async () => root.render(<NarrativeHistoryPickerModal isOpen onClose={() => {}} initialSelectedIds={['old-string-id']} onConfirm={onConfirm} />));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      const select = document.querySelector('select')!; select.value = 'prompt_order'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useNarrativeHistoryStore.getState().sort).toBe('prompt_order');
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('使用选中'))!.click());
    expect(onConfirm).toHaveBeenCalledWith(entries);
    expect(onConfirm.mock.calls[0][0][0]).toBe(entries[0]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
