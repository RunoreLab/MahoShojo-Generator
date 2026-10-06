import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InvokeFn } from '../src/platform/cloud-bridge';
import {
  ensureTopbarAvatar,
  getTopbarAvatar,
  resetTopbarAvatarForTests,
  subscribeTopbarAvatar,
} from '../src/features/account/use-topbar-avatar';

/** 等 microtask 链结算：ensure 的 .then/.finally 完成并 notify。 */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('topbar avatar cache', () => {
  beforeEach(() => {
    resetTopbarAvatarForTests();
  });

  it('fetches once per user and serves the cached data URL afterwards', async () => {
    const invoke = vi.fn(async () => ({
      signature: '圆焰',
      avatarDataUrl: 'data:image/webp;base64,QUJD',
    })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();

    expect(getTopbarAvatar(7)).toBe('data:image/webp;base64,QUJD');
    expect(invoke).toHaveBeenCalledTimes(1);

    // 已 checked（含「无头像」）后重挂载不重拉。
    ensureTopbarAvatar(7, invoke);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('marks checked even when the profile has no avatar', async () => {
    const invoke = vi.fn(async () => ({ signature: '' })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();
    ensureTopbarAvatar(7, invoke);
    await flush();

    expect(getTopbarAvatar(7)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps failures out of the cache and retries on the next mount', async () => {
    let fail = true;
    const invoke = vi.fn(async () => {
      if (fail) throw { code: 'network-error', message: 'down' };
      return { avatarDataUrl: 'data:image/webp;base64,QUJD' };
    }) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();
    expect(getTopbarAvatar(7)).toBeNull();

    fail = false;
    ensureTopbarAvatar(7, invoke);
    await flush();
    expect(getTopbarAvatar(7)).toBe('data:image/webp;base64,QUJD');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent ensures for the same user', async () => {
    let release: (() => void) | null = null;
    const invoke = vi.fn(
      async () =>
        new Promise<{ avatarDataUrl: string }>((resolve) => {
          release = () => resolve({ avatarDataUrl: 'data:image/webp;base64,QUJD' });
        }),
    ) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    ensureTopbarAvatar(7, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);

    release?.();
    await flush();
    expect(getTopbarAvatar(7)).toBe('data:image/webp;base64,QUJD');
  });

  it('notifies subscribers when the fetch settles', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTopbarAvatar(listener);
    const invoke = vi.fn(async () => ({
      avatarDataUrl: 'data:image/webp;base64,QUJD',
    })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('scopes the cache by userId — a different account never sees a stale avatar', async () => {
    const invoke = vi.fn(async () => ({
      avatarDataUrl: 'data:image/webp;base64,QUJD',
    })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();

    expect(getTopbarAvatar(7)).toBe('data:image/webp;base64,QUJD');
    expect(getTopbarAvatar(8)).toBeNull();
    expect(getTopbarAvatar(null)).toBeNull();
  });
});
