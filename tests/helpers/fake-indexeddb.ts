import 'fake-indexeddb/auto';

type GlobalWithWindow = typeof globalThis & {
  window?: typeof globalThis;
};

const globalWithWindow = globalThis as GlobalWithWindow;

if (!globalWithWindow.window) {
  globalWithWindow.window = globalWithWindow;
}
