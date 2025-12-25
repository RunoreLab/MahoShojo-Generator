import { describe, expect, test } from 'bun:test';

import { addLikedDeck, getLikedDecks, isDeckLiked } from '@/lib/localStorage';

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
  clear() {
    this.store.clear();
  }
}

describe('localStorage liked decks', () => {
  test('首次点赞写入，重复点赞被阻止', () => {
    const previousWindow = (globalThis as any).window;
    const previousLocalStorage = (globalThis as any).localStorage;

    try {
      (globalThis as any).window = {};
      (globalThis as any).localStorage = new LocalStorageMock();

      expect(getLikedDecks().size).toBe(0);
      expect(isDeckLiked('d1')).toBe(false);

      expect(addLikedDeck('d1')).toBe(true);
      expect(addLikedDeck('d1')).toBe(false);
      expect(getLikedDecks()).toEqual(new Set(['d1']));
      expect(isDeckLiked('d1')).toBe(true);
    } finally {
      (globalThis as any).window = previousWindow;
      (globalThis as any).localStorage = previousLocalStorage;
    }
  });
});

