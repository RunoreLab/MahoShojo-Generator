// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalLibraryStatusNote } from '@/components/shared/LocalLibraryStatusNote';

const globalWithActFlag = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

let root: Root | null = null;
let originalStorage: PropertyDescriptor | undefined;
let previousActEnvironment: boolean | undefined;

beforeEach(() => {
  originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
  previousActEnvironment = globalWithActFlag.IS_REACT_ACT_ENVIRONMENT;
  globalWithActFlag.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 10 }),
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    },
  });
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  if (originalStorage === undefined) {
    Reflect.deleteProperty(navigator, 'storage');
  } else {
    Object.defineProperty(navigator, 'storage', originalStorage);
  }
  if (previousActEnvironment === undefined) {
    delete globalWithActFlag.IS_REACT_ACT_ENVIRONMENT;
  } else {
    globalWithActFlag.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
  vi.restoreAllMocks();
});

describe('LocalLibraryStatusNote hydration', () => {
  it('keeps its initial server and browser snapshots identical before reading storage capabilities', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const serverMarkup = renderToString(<LocalLibraryStatusNote />);
    expect(serverMarkup).toContain('当前浏览器无法提供本地库空间估计。');

    const container = document.createElement('div');
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);

    await act(async () => {
      root = hydrateRoot(container, <LocalLibraryStatusNote />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(consoleError.mock.calls.flat().join('\n')).not.toMatch(/hydration mismatch|hydration failed/iu);
    expect(container.textContent).toContain('本地库尚未获得持久化存储');
    expect(container.textContent).toContain('0 B / 10 B');
  });
});
