'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_PVP_RULES } from '@/lib/pvp/defaults';
import type { PvpRoomRules } from '@/lib/pvp/types';

type PvpLobbyStoreState = {
  rules: PvpRoomRules;
  setRules: (rules: PvpRoomRules) => void;
  updateRules: (patch: Partial<PvpRoomRules>) => void;
};

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

export const usePvpLobbyStore = create<PvpLobbyStoreState>()(
  persist(
    (set) => ({
      rules: DEFAULT_PVP_RULES,
      setRules: (rules) => set({ rules }),
      updateRules: (patch) =>
        set((state) => ({
          rules: {
            ...state.rules,
            ...patch,
          },
        })),
    }),
    {
      name: 'pvp-lobby-storage',
      storage: createJSONStorage(createStorage),
      partialize: (state) => ({ rules: state.rules }),
    }
  )
);

