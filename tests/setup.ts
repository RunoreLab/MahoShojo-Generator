import 'fake-indexeddb/auto';
import { expect } from 'vitest';

type GlobalWithWindow = typeof globalThis & {
  window?: Window & typeof globalThis;
};

const globalWithWindow = globalThis as unknown as GlobalWithWindow;

if (!globalWithWindow.window) {
  globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
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
