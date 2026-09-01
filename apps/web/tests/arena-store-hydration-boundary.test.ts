// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Arena persisted store hydration boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('keeps the SSR-compatible default snapshot until explicit client rehydration', async () => {
    localStorage.setItem('arena-storage', JSON.stringify({
      state: { battleMode: 'daily' },
      version: 0,
    }));
    localStorage.setItem('arena-narrative-history-v1', JSON.stringify({
      state: {
        entries: [{
          id: 'persisted-entry',
          title: '持久化战报',
          content: '战报正文',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        }],
        lastUpdatedAt: '2026-09-01T00:00:00.000Z',
        sort: 'updated_desc',
      },
      version: 2,
    }));

    const [{ useBattleStore }, { useNarrativeHistoryStore }] = await Promise.all([
      import('@/components/arena/stores/useBattleStore'),
      import('@/components/arena/stores/useNarrativeHistoryStore'),
    ]);

    expect(useBattleStore.persist.hasHydrated()).toBe(false);
    expect(useNarrativeHistoryStore.persist.hasHydrated()).toBe(false);
    expect(useBattleStore.getState().battleMode).toBe('classic');
    expect(useNarrativeHistoryStore.getState().entries).toEqual([]);

    await Promise.all([
      useBattleStore.persist.rehydrate(),
      useNarrativeHistoryStore.persist.rehydrate(),
    ]);

    expect(useBattleStore.getState().battleMode).toBe('daily');
    expect(useNarrativeHistoryStore.getState().entries).toHaveLength(1);
  });

  it('does not overwrite persisted battle settings when state changes before hydration', async () => {
    localStorage.setItem('arena-storage', JSON.stringify({
      state: {
        battleMode: 'daily',
        generationMode: 'stream',
        storyLength: 'long',
        selectedLanguage: 'en-US',
      },
      version: 1,
    }));

    const { useBattleStore } = await import('@/components/arena/stores/useBattleStore');
    useBattleStore.getState().setUserProviderConfig({
      providerId: 'openai',
      apiKey: 'test-only',
      modelId: 'test-model',
    });

    const beforeHydration = JSON.parse(localStorage.getItem('arena-storage') ?? '{}');
    expect(beforeHydration.state).toMatchObject({
      battleMode: 'daily',
      generationMode: 'stream',
      storyLength: 'long',
      selectedLanguage: 'en-US',
    });

    await useBattleStore.persist.rehydrate();
    expect(useBattleStore.getState()).toMatchObject({
      battleMode: 'daily',
      generationMode: 'stream',
      storyLength: 'long',
      selectedLanguage: 'en-US',
    });
  });

  it('does not erase persisted narrative entries when state changes before hydration', async () => {
    localStorage.setItem('arena-narrative-history-v1', JSON.stringify({
      state: {
        entries: [{
          id: 'persisted-entry',
          title: '持久化战报',
          content: '战报正文',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        }],
        lastUpdatedAt: '2026-09-01T00:00:00.000Z',
        sort: 'updated_desc',
      },
      version: 2,
    }));

    const { useNarrativeHistoryStore } = await import('@/components/arena/stores/useNarrativeHistoryStore');
    useNarrativeHistoryStore.getState().setSort('created_asc');

    const beforeHydration = JSON.parse(localStorage.getItem('arena-narrative-history-v1') ?? '{}');
    expect(beforeHydration.state.entries).toHaveLength(1);
    expect(beforeHydration.state.sort).toBe('updated_desc');

    await useNarrativeHistoryStore.persist.rehydrate();
    expect(useNarrativeHistoryStore.getState().entries).toHaveLength(1);
    expect(useNarrativeHistoryStore.getState().sort).toBe('updated_desc');
  });
});
