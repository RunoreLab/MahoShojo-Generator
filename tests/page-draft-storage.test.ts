import { describe, expect, test } from 'bun:test';

import { clearPageDraft, readPageDraft, writePageDraft } from '@/lib/page-draft-storage';

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

describe('page draft storage', () => {
  test('writes and reads the current draft payload', () => {
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;

    try {
      const localStorage = new LocalStorageMock();
      (globalThis as typeof globalThis & { window?: unknown }).window = {};
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = localStorage;

      const stored = writePageDraft('mahoshojo.scenario.page-draft.v1', { answers: { scene: '黄昏钟楼' } }, { version: 1 });

      expect(stored?.version).toBe(1);
      expect(typeof stored?.updatedAt).toBe('number');
      expect(stored?.payload).toEqual({ answers: { scene: '黄昏钟楼' } });

      const restored = readPageDraft<{ answers: Record<string, string> }>('mahoshojo.scenario.page-draft.v1', {
        version: 1,
        ttlMs: 10_000,
      });

      expect(restored?.payload.answers.scene).toBe('黄昏钟楼');
    } finally {
      (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = previousLocalStorage;
    }
  });

  test('clears broken json instead of throwing', () => {
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;

    try {
      const localStorage = new LocalStorageMock();
      (globalThis as typeof globalThis & { window?: unknown }).window = {};
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = localStorage;

      localStorage.setItem('mahoshojo.scenario.page-draft.v1', '{broken');

      const restored = readPageDraft('mahoshojo.scenario.page-draft.v1', { version: 1, ttlMs: 10_000 });

      expect(restored).toBeNull();
      expect(localStorage.getItem('mahoshojo.scenario.page-draft.v1')).toBeNull();
    } finally {
      (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = previousLocalStorage;
    }
  });

  test('drops expired drafts and clears mismatched versions', () => {
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    const previousLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;

    try {
      const localStorage = new LocalStorageMock();
      (globalThis as typeof globalThis & { window?: unknown }).window = {};
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = localStorage;

      localStorage.setItem(
        'expired',
        JSON.stringify({
          version: 1,
          updatedAt: Date.now() - 20_000,
          payload: { answers: { scene: '旧草稿' } },
        }),
      );
      localStorage.setItem(
        'mismatch',
        JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          payload: { answers: { scene: '旧版本草稿' } },
        }),
      );

      expect(readPageDraft('expired', { version: 1, ttlMs: 10_000 })).toBeNull();
      expect(localStorage.getItem('expired')).toBeNull();

      expect(readPageDraft('mismatch', { version: 2, ttlMs: 10_000 })).toBeNull();
      expect(localStorage.getItem('mismatch')).toBeNull();

      writePageDraft('clear-me', { answers: { scene: '待清理' } }, { version: 1 });
      clearPageDraft('clear-me');
      expect(localStorage.getItem('clear-me')).toBeNull();
    } finally {
      (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
      (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage = previousLocalStorage;
    }
  });
});
