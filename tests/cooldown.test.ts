import { describe, expect, test } from 'bun:test';

import { readCooldownSnapshot, subscribeCooldownKey, writeCooldownSnapshot } from '@/lib/cooldown';

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

class CustomEventPolyfill<T = unknown> extends Event {
  detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = (init?.detail ?? null) as T;
  }
}

describe('cooldown 同页同步', () => {
  test('同一个 key 在当前页面写入后会通知所有订阅者', () => {
    const previousWindow = (globalThis as any).window;
    const previousLocalStorage = (globalThis as any).localStorage;
    const previousCustomEvent = (globalThis as any).CustomEvent;

    try {
      (globalThis as any).window = new EventTarget();
      (globalThis as any).localStorage = new LocalStorageMock();
      if (typeof previousCustomEvent === 'undefined') {
        (globalThis as any).CustomEvent = CustomEventPolyfill;
      }

      let firstSubscriberCalls = 0;
      let secondSubscriberCalls = 0;

      const unsubscribeFirst = subscribeCooldownKey('arena.shared.cooldown', () => {
        firstSubscriberCalls += 1;
      });
      const unsubscribeSecond = subscribeCooldownKey('arena.shared.cooldown', () => {
        secondSubscriberCalls += 1;
      });

      const snapshot = writeCooldownSnapshot('arena.shared.cooldown', Date.now() + 15_000);

      expect(snapshot.endTime).not.toBeNull();
      expect(snapshot.remainingTime).toBeGreaterThan(0);
      expect(firstSubscriberCalls).toBe(1);
      expect(secondSubscriberCalls).toBe(1);

      unsubscribeFirst();
      unsubscribeSecond();
    } finally {
      (globalThis as any).window = previousWindow;
      (globalThis as any).localStorage = previousLocalStorage;
      (globalThis as any).CustomEvent = previousCustomEvent;
    }
  });

  test('读取过期冷却时会自动清理本地存储', () => {
    const previousWindow = (globalThis as any).window;
    const previousLocalStorage = (globalThis as any).localStorage;

    try {
      const localStorage = new LocalStorageMock();
      (globalThis as any).window = {};
      (globalThis as any).localStorage = localStorage;

      localStorage.setItem('arena.expired.cooldown', String(Date.now() - 5_000));

      const snapshot = readCooldownSnapshot('arena.expired.cooldown');

      expect(snapshot).toEqual({ endTime: null, remainingTime: 0 });
      expect(localStorage.getItem('arena.expired.cooldown')).toBeNull();
    } finally {
      (globalThis as any).window = previousWindow;
      (globalThis as any).localStorage = previousLocalStorage;
    }
  });
});
