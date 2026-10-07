/**
 * `public-cache-bridge` 的契约复核与错误投影（D5.1-K1，DESK-CACHE-006/008）。
 *
 * 桥只做三件事：发对命令（策略/统计/清空）、把 native 返回按 desktop-ipc
 * schema 复核、把错误按已登记错误码透出。不符合契约的载荷与未登记错误码
 * 都归为 fail-closed。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  applyPublicCachePolicy,
  clearPublicCache,
  DesktopPublicCacheError,
  readPublicCacheStats,
} from '../src/platform/public-cache-bridge';
import type { InvokeFn } from '../src/platform/public-cache-bridge';

const STATS = {
  status: 'ready',
  path: 'C:\\data\\public-read-cache.sqlite',
  usageBytes: 1234,
  entryCount: 2,
  summaryCount: 2,
  bodyCount: 1,
  withdrawnCount: 0,
  appliedPolicy: {
    captureEnabled: true,
    maxBytes: 268_435_456,
    whenFull: 'pause',
  },
};

describe('public cache bridge', () => {
  it('apply policy sends the fixed command with a contract-shaped payload', async () => {
    const invoke: InvokeFn = vi.fn(async () => null);
    await applyPublicCachePolicy(invoke, {
      captureEnabled: true,
      maxBytes: 'unlimited',
      whenFull: 'pause',
    });
    expect(invoke).toHaveBeenCalledWith('public_read_cache_apply_policy', {
      policy: { captureEnabled: true, maxBytes: 'unlimited', whenFull: 'pause' },
    });
  });

  it('rejects out-of-domain policy before any IPC leaves the renderer', async () => {
    const invoke: InvokeFn = vi.fn(async () => null);
    for (const policy of [
      { captureEnabled: true, maxBytes: 0, whenFull: 'pause' },
      { captureEnabled: true, maxBytes: '512MiB', whenFull: 'pause' },
      { captureEnabled: true, maxBytes: 268_435_456, whenFull: 'evict' },
      { captureEnabled: true, maxBytes: 268_435_456, whenFull: 'pause', path: '/tmp/x' },
    ]) {
      await expect(
        applyPublicCachePolicy(invoke, policy as never),
      ).rejects.toMatchObject({ code: 'invalid-request' });
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stats and clear return schema-checked payloads', async () => {
    const statsInvoke: InvokeFn = vi.fn(async () => STATS);
    const stats = await readPublicCacheStats(statsInvoke);
    expect(statsInvoke).toHaveBeenCalledWith('public_read_cache_stats');
    expect(stats.usageBytes).toBe(1234);

    const clearInvoke: InvokeFn = vi.fn(async () => ({
      removedEntries: 3,
      freedBytes: 4567,
    }));
    const result = await clearPublicCache(clearInvoke);
    expect(clearInvoke).toHaveBeenCalledWith('public_read_cache_clear');
    expect(result).toEqual({ removedEntries: 3, freedBytes: 4567 });
  });

  it('malformed native payloads become bridge-invalid, not silently trusted', async () => {
    const badStats: InvokeFn = vi.fn(async () => ({ status: 'mystery' }));
    await expect(readPublicCacheStats(badStats)).rejects.toMatchObject({
      code: 'bridge-invalid',
    });
    const badClear: InvokeFn = vi.fn(async () => ({ path: '/etc/passwd' }));
    await expect(clearPublicCache(badClear)).rejects.toMatchObject({
      code: 'bridge-invalid',
    });
  });

  it('structured native errors keep their code; unknown codes fall back', async () => {
    const known: InvokeFn = vi.fn(async () => {
      throw { code: 'storage-unavailable', message: '缓存库不可用' };
    });
    const error = await readPublicCacheStats(known).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DesktopPublicCacheError);
    expect((error as DesktopPublicCacheError).code).toBe('storage-unavailable');

    const unknown: InvokeFn = vi.fn(async () => {
      throw { code: 'something-else', message: 'x' };
    });
    await expect(clearPublicCache(unknown)).rejects.toMatchObject({
      code: 'internal-error',
    });
  });
});
