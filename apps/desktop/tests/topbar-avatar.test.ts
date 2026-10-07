import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InvokeFn } from '../src/platform/cloud-bridge';
import {
  ensureTopbarAvatar,
  getTopbarAvatar,
  invalidateTopbarAvatar,
  resetTopbarAvatarForTests,
  subscribeTopbarAvatar,
} from '../src/features/account/use-topbar-avatar';

/** 等 microtask 链结算：ensure 的 .then/.finally 完成并 notify。 */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const WEBP_AVATAR = 'data:image/webp;base64,QUJD';

describe('topbar avatar cache', () => {
  beforeEach(() => {
    resetTopbarAvatarForTests();
  });

  it('fetches once per user and serves the cached data URL afterwards', async () => {
    const invoke = vi.fn(async () => ({
      userId: 7,
      signature: '圆焰',
      avatarDataUrl: WEBP_AVATAR,
    })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();

    expect(getTopbarAvatar(7)).toBe(WEBP_AVATAR);
    expect(invoke).toHaveBeenCalledTimes(1);

    // 已 checked（含「无头像」）后重挂载不重拉。
    ensureTopbarAvatar(7, invoke);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('marks checked even when the profile has no avatar', async () => {
    const invoke = vi.fn(async () => ({ userId: 7, signature: '' })) as unknown as InvokeFn;

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
      return { userId: 7, avatarDataUrl: WEBP_AVATAR };
    }) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();
    expect(getTopbarAvatar(7)).toBeNull();

    fail = false;
    ensureTopbarAvatar(7, invoke);
    await flush();
    expect(getTopbarAvatar(7)).toBe(WEBP_AVATAR);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent ensures for the same user', async () => {
    let release = (): void => {
      throw new Error('release not captured');
    };
    const invoke = vi.fn(
      async () =>
        new Promise<{ userId: number; avatarDataUrl: string }>((resolve) => {
          release = () => resolve({ userId: 7, avatarDataUrl: WEBP_AVATAR });
        }),
    ) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    ensureTopbarAvatar(7, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);

    release();
    await flush();
    expect(getTopbarAvatar(7)).toBe(WEBP_AVATAR);
  });

  it('notifies subscribers when the fetch settles', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTopbarAvatar(listener);
    const invoke = vi.fn(async () => ({
      userId: 7,
      avatarDataUrl: WEBP_AVATAR,
    })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('scopes the cache by userId — a different account never sees a stale avatar', async () => {
    const invoke = vi.fn(async () => ({
      userId: 7,
      avatarDataUrl: WEBP_AVATAR,
    })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();

    expect(getTopbarAvatar(7)).toBe(WEBP_AVATAR);
    expect(getTopbarAvatar(8)).toBeNull();
    expect(getTopbarAvatar(null)).toBeNull();
  });

  it('invalidate clears the cached entry so the next ensure refetches', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTopbarAvatar(listener);
    const invoke = vi.fn(async () => ({
      userId: 7,
      avatarDataUrl: WEBP_AVATAR,
    })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();
    expect(getTopbarAvatar(7)).toBe(WEBP_AVATAR);

    listener.mockClear();
    invalidateTopbarAvatar(7);
    // 已渲染的头像立即消失，订阅者得到一次失效通知。
    expect(getTopbarAvatar(7)).toBeNull();
    expect(listener).toHaveBeenCalled();

    ensureTopbarAvatar(7, invoke);
    await flush();
    expect(getTopbarAvatar(7)).toBe(WEBP_AVATAR);
    expect(invoke).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('identity fence：响应携带的 userId 与请求目标不一致时不写缓存', async () => {
    // native 按当前凭据返回 userId——登出/换号竞态下达的响应归属别的账号，
    // renderer 核对后整份丢弃，既不写缓存也不标 checked（下次挂载重试）。
    const invoke = vi.fn(async () => ({
      userId: 8,
      avatarDataUrl: WEBP_AVATAR,
    })) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    await flush();

    expect(getTopbarAvatar(7)).toBeNull();
    expect(getTopbarAvatar(8)).toBeNull();

    // 未标记 checked：换号后的下一次挂载允许重试。
    const retry = vi.fn(async () => ({
      userId: 7,
      avatarDataUrl: WEBP_AVATAR,
    })) as unknown as InvokeFn;
    ensureTopbarAvatar(7, retry);
    await flush();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(getTopbarAvatar(7)).toBe(WEBP_AVATAR);
  });

  it('invalidate during an in-flight fetch expires the late response', async () => {
    // 登出发生在 me_profile 在途窗口：世代号已推进，迟到响应结算时
    // 被丢弃——登出后任何挂载都不会看到「已注销账号」的头像复活。
    let release = (): void => {
      throw new Error('release not captured');
    };
    const invoke = vi.fn(
      async () =>
        new Promise<{ userId: number; avatarDataUrl: string }>((resolve) => {
          release = () => resolve({ userId: 7, avatarDataUrl: WEBP_AVATAR });
        }),
    ) as unknown as InvokeFn;

    ensureTopbarAvatar(7, invoke);
    invalidateTopbarAvatar(7);
    release();
    await flush();

    expect(getTopbarAvatar(7)).toBeNull();
    // 既未写缓存也未标记 checked：下一次挂载重新拉取。
    const refetch = vi.fn(async () => ({
      userId: 7,
      avatarDataUrl: WEBP_AVATAR,
    })) as unknown as InvokeFn;
    ensureTopbarAvatar(7, refetch);
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(getTopbarAvatar(7)).toBe(WEBP_AVATAR);
  });
});
