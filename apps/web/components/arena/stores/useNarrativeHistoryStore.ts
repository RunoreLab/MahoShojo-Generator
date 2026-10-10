'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { appendNarrativeHistoryEntry, updateNarrativeHistoryEntry } from '@mahoshojo/domain/narrative-history-operations';

import { randomUUID } from '@/lib/crypto';
import {
  migrateLegacyNarrativeHistoryOrder,
  moveNarrativeHistoryEntry,
  reorderNarrativeHistoryEntries,
  type NarrativeHistoryReorderDirection,
  type NarrativeHistorySort,
} from '@/lib/narrative-history';
import type { NarrativeHistoryEntry } from '@/types/arena';
import { createHydrationSafeJsonStorage } from '@/lib/zustand-persist-storage';

export const NARRATIVE_HISTORY_STORAGE_KEY = 'arena-narrative-history-v1';
export type { NarrativeHistorySort } from '@/lib/narrative-history';

interface NarrativeHistoryStoreState {
  entries: NarrativeHistoryEntry[];
  lastUpdatedAt: string | null;
  sort: NarrativeHistorySort;

  setSort: (sort: NarrativeHistorySort) => void;
  appendEntry: (payload: {
    title: string;
    content: string;
    generationId?: string | null;
  }) => NarrativeHistoryEntry | null;
  updateEntry: (id: string, patch: { title?: string; content?: string }) => void;
  moveEntry: (id: string, direction: NarrativeHistoryReorderDirection) => void;
  reorderEntries: (movingId: string, targetId: string) => void;
  deleteEntry: (id: string) => void;
  replaceAll: (entries: NarrativeHistoryEntry[]) => void;
  clear: () => void;
}

const createStorage = (): Storage => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
};

const nowIso = (): string => new Date().toISOString();

export const useNarrativeHistoryStore = create<NarrativeHistoryStoreState>()(
  persist(
    (set, get) => ({
      entries: [],
      lastUpdatedAt: null,
      sort: 'updated_desc',

      setSort: (sort) => set({ sort }),

      appendEntry: (payload) => {
        const result = appendNarrativeHistoryEntry(get().entries, payload, {
          fallbackId: randomUUID(),
          createdAt: nowIso(),
        });
        if (result.appended && result.entry) {
          set({ entries: result.entries, lastUpdatedAt: result.entry.updatedAt });
        }
        return result.entry;
      },

      updateEntry: (id, patch) => {
        if (!id) return;
        set((state) => ({
          entries: updateNarrativeHistoryEntry(state.entries, id, patch, { now: nowIso }),
          lastUpdatedAt: nowIso(),
        }));
      },

      moveEntry: (id, direction) => {
        if (!id) return;
        set((state) => {
          const nextEntries = moveNarrativeHistoryEntry(state.entries, id, direction);
          const orderChanged =
            nextEntries.length !== state.entries.length ||
            nextEntries.some((entry, index) => entry.id !== state.entries[index]?.id);
          if (!orderChanged) return state;
          return { entries: nextEntries, lastUpdatedAt: nowIso() };
        });
      },

      reorderEntries: (movingId, targetId) => {
        if (!movingId || !targetId || movingId === targetId) return;
        set((state) => {
          const nextEntries = reorderNarrativeHistoryEntries(state.entries, movingId, targetId);
          const orderChanged =
            nextEntries.length !== state.entries.length ||
            nextEntries.some((entry, index) => entry.id !== state.entries[index]?.id);
          if (!orderChanged) return state;
          return { entries: nextEntries, lastUpdatedAt: nowIso() };
        });
      },

      deleteEntry: (id) => {
        if (!id) return;
        set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id), lastUpdatedAt: nowIso() }));
      },

      replaceAll: (entries) => {
        const safe = Array.isArray(entries) ? entries : [];
        set({ entries: safe, lastUpdatedAt: nowIso() });
      },

      clear: () => set({ entries: [], lastUpdatedAt: nowIso() }),
    }),
    {
      name: NARRATIVE_HISTORY_STORAGE_KEY,
      version: 2,
      // 避免客户端首帧先于 React hydration 同步读取 localStorage；由路由 boundary 显式恢复。
      skipHydration: true,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<NarrativeHistoryStoreState> & Record<string, unknown>;
        const rawEntries = Array.isArray(state.entries) ? state.entries : [];
        if (version < 2) {
          return {
            ...state,
            entries: migrateLegacyNarrativeHistoryOrder(rawEntries as NarrativeHistoryEntry[]),
            sort:
              state.sort === 'updated_desc' ||
              state.sort === 'updated_asc' ||
              state.sort === 'created_desc' ||
              state.sort === 'created_asc' ||
              state.sort === 'prompt_order'
                ? state.sort
                : 'updated_desc',
          };
        }
        return {
          ...state,
          entries: rawEntries as NarrativeHistoryEntry[],
          sort:
            state.sort === 'updated_desc' ||
            state.sort === 'updated_asc' ||
            state.sort === 'created_desc' ||
            state.sort === 'created_asc' ||
            state.sort === 'prompt_order'
              ? state.sort
              : 'updated_desc',
        };
      },
      storage: createHydrationSafeJsonStorage(createStorage),
      partialize: (state) => ({
        entries: state.entries,
        lastUpdatedAt: state.lastUpdatedAt,
        sort: state.sort,
      }),
    }
  )
);
