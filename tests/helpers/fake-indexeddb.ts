import 'fake-indexeddb/auto';

type GlobalWithWindow = typeof globalThis & {
  window?: Window & typeof globalThis;
};

const globalWithWindow = globalThis as unknown as GlobalWithWindow;

if (!globalWithWindow.window) {
  globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
}
