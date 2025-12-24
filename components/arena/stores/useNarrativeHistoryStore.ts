'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { randomUUID } from '@/lib/crypto';
import type { NarrativeHistoryEntry } from '@/types/arena';

export const NARRATIVE_HISTORY_STORAGE_KEY = 'arena-narrative-history-v1';

export type NarrativeHistorySort = 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc';

interface NarrativeHistoryStoreState {
  entries: NarrativeHistoryEntry[];
  lastUpdatedAt: string | null;
  sort: NarrativeHistorySort;

  setSort: (sort: NarrativeHistorySort) => void;
  appendEntry: (payload: { title: string; content: string }) => NarrativeHistoryEntry | null;
  updateEntry: (id: string, patch: { title?: string; content?: string }) => void;
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

const normalizeTitleFallback = (content: string): string => {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const stripped = firstLine.replace(/^#{1,6}\s*/, '').trim();
  const candidate = stripped || firstLine.trim();
  return candidate ? candidate.slice(0, 60) : '未命名战报';
};

export const useNarrativeHistoryStore = create<NarrativeHistoryStoreState>()(
  persist(
    (set, get) => ({
      entries: [],
      lastUpdatedAt: null,
      sort: 'updated_desc',

      setSort: (sort) => set({ sort }),

      appendEntry: ({ title, content }) => {
        const trimmedContent = (content ?? '').toString().trim();
        if (!trimmedContent) {
          return null;
        }

        const trimmedTitle = (title ?? '').toString().trim() || normalizeTitleFallback(trimmedContent);
        const createdAt = nowIso();

        const entry: NarrativeHistoryEntry = {
          id: randomUUID(),
          title: trimmedTitle.slice(0, 120),
          content: trimmedContent,
          createdAt,
          updatedAt: createdAt,
        };

        set({
          entries: [entry, ...get().entries],
          lastUpdatedAt: entry.updatedAt,
        });

        return entry;
      },

      updateEntry: (id, patch) => {
        if (!id) return;
        const nextTitle = patch.title === undefined ? undefined : patch.title.toString().trim().slice(0, 120);
        const nextContent = patch.content === undefined ? undefined : patch.content.toString();
        set((state) => {
          const nextEntries = state.entries.map((entry) => {
            if (entry.id !== id) return entry;
            const updatedAt = nowIso();
            return {
              ...entry,
              ...(nextTitle !== undefined ? { title: nextTitle || normalizeTitleFallback(entry.content) } : {}),
              ...(nextContent !== undefined ? { content: nextContent } : {}),
              updatedAt,
            };
          });
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
      storage: createJSONStorage(createStorage),
      partialize: (state) => ({
        entries: state.entries,
        lastUpdatedAt: state.lastUpdatedAt,
        sort: state.sort,
      }),
    }
  )
);

