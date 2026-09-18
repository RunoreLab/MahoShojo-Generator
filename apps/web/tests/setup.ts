import 'fake-indexeddb/auto';
import { expect } from 'vitest';

// 手动使用 React act 的测试共享同一环境声明，保留未包裹更新的诊断。
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type GlobalWithWindow = typeof globalThis & {
  window?: Window & typeof globalThis;
};

const globalWithWindow = globalThis as unknown as GlobalWithWindow;

if (!globalWithWindow.window) {
  globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
}

// Node.js 内置的 localStorage 可能不具备完整的 Storage 接口（setItem/getItem 等），
// 导致 zustand persist 中间件在测试环境中报错。这里提供一个基于 Map 的内存实现。
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, writable: true, configurable: true });
  Object.defineProperty(globalWithWindow, 'window', { value: globalWithWindow, writable: true, configurable: true });
  if (!globalWithWindow.window.localStorage) {
    Object.defineProperty(globalWithWindow.window, 'localStorage', { value: memoryStorage, writable: true, configurable: true });
  }
}

expect.extend({
  toBeNumber(received) {
    const pass = typeof received === 'number' && !Number.isNaN(received);
    return {
      pass,
      message: () => `expected ${String(received)} ${pass ? 'not ' : ''}to be a number`,
    };
  },
  toBeString(received) {
    const pass = typeof received === 'string';
    return {
      pass,
      message: () => `expected ${String(received)} ${pass ? 'not ' : ''}to be a string`,
    };
  },
});
