// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useNarrativeHistoryStore } from '@/components/arena/stores/useNarrativeHistoryStore';
import { ArenaPersistedStateBoundary } from '@/components/arena/ArenaPersistedStateBoundary';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('malformed stored JSON remains intact and does not mount the ready-only history adapter', async () => {
  const raw = '{broken-history';
  localStorage.setItem('arena-narrative-history-v1', raw);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ArenaPersistedStateBoundary hydrateBattleStore={false}><div data-ready>ready picker</div></ArenaPersistedStateBoundary>));
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    expect(host.querySelector('[data-ready]')).toBeNull();
    expect(useNarrativeHistoryStore.persist.hasHydrated()).toBe(false);
    expect(localStorage.getItem('arena-narrative-history-v1')).toBe(raw);
  } finally { await act(async () => root.unmount()); host.remove(); localStorage.removeItem('arena-narrative-history-v1'); }
});
