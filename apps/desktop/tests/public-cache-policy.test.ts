/**
 * `public-cache-policy` 的生效策略推导与同步器（D5.1-K1，DESK-CACHE-008）。
 *
 * 钉住的口径：
 *
 * 1. 文件值原样透传——captureEnabled/maxBytes/whenFull 三项只经
 *    `publicCacheDegraded` 折叠，不做第二次域判定；
 * 2. 组不可校验（降级）→ 推「暂停捕获 + 暂停淘汰」，不推归一默认值；
 * 3. 同步器只在 config 终态推送、按内容去重、失败允许下次重试——
 *    native 策略与文件口径不会静默分叉。
 */

import { describe, expect, it, vi } from 'vitest';

import { DesktopConfigStore } from '../src/features/config/desktop-config-store';
import {
  createPublicCachePolicySync,
  effectivePublicCachePolicy,
} from '../src/features/public-cache/public-cache-policy';
import type { DesktopConfigState } from '../src/features/config/desktop-config-store';

const REV = `sha256:${'a'.repeat(64)}`;

const readResult = (file: Record<string, unknown>) => ({
  path: 'C:\\cfg\\config.json',
  directory: 'C:\\cfg',
  backupPresent: false,
  file,
});

const okFile = (content: string) => ({ status: 'ok' as const, revision: REV, content });

const makeInvoke = (impl: (command: string, args?: Record<string, unknown>) => Promise<unknown>) =>
  vi.fn(impl);

const stateWith = (overrides: Partial<DesktopConfigState>): DesktopConfigState => ({
  status: 'ready',
  path: null,
  directory: null,
  backupPresent: false,
  fileStatus: 'ok',
  fileFatal: false,
  publicCacheDegraded: false,
  values: {
    announcementsCheckPolicy: 'on-launch',
    confirmContentLinks: true,
    escapeMenuEnabled: true,
    publicCacheCaptureEnabled: true,
    publicCacheMaxBytes: 268_435_456,
    publicCacheWhenFull: 'pause',
  },
  diagnostics: [],
  readError: null,
  saveError: null,
  conflictedFields: null,
  saving: false,
  ...overrides,
});

describe('effectivePublicCachePolicy', () => {
  it('passes file values through when the group is verifiable', () => {
    expect(
      effectivePublicCachePolicy(
        stateWith({
          values: {
            ...stateWith({}).values,
            publicCacheCaptureEnabled: false,
            publicCacheMaxBytes: 'unlimited',
            publicCacheWhenFull: 'evict-least-recently-used',
          },
        }),
      ),
    ).toEqual({
      captureEnabled: false,
      maxBytes: 'unlimited',
      whenFull: 'evict-least-recently-used',
    });
  });

  it('collapses to pause-capture + pause-evict when the group is degraded', () => {
    expect(
      effectivePublicCachePolicy(
        stateWith({
          publicCacheDegraded: true,
          values: {
            ...stateWith({}).values,
            publicCacheCaptureEnabled: true,
            publicCacheMaxBytes: 'unlimited',
            publicCacheWhenFull: 'evict-least-recently-used',
          },
        }),
      ),
    ).toEqual({
      captureEnabled: false,
      maxBytes: 'unlimited',
      whenFull: 'pause',
    });
  });
});

describe('createPublicCachePolicySync', () => {
  it('pushes the effective policy once config reaches a terminal state', async () => {
    const applyCalls: unknown[] = [];
    const invoke = makeInvoke(async (command, args) => {
      if (command === 'desktop_config_read') {
        return readResult(
          okFile('{"version":1,"publicLibraryCache":{"captureEnabled":false}}'),
        );
      }
      if (command === 'public_read_cache_apply_policy') {
        applyCalls.push(args?.policy);
        return null;
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    const stop = createPublicCachePolicySync(store, { invoke });

    await store.ready();
    await vi.waitFor(() => {
      expect(applyCalls).toHaveLength(1);
    });
    expect(applyCalls[0]).toEqual({
      captureEnabled: false,
      maxBytes: 268_435_456,
      whenFull: 'pause',
    });
    stop();
  });

  it('pushes again when the effective policy changes, but not on unrelated publishes', async () => {
    const applyCalls: unknown[] = [];
    const invoke = makeInvoke(async (command, args) => {
      if (command === 'desktop_config_read') return readResult({ status: 'missing' });
      if (command === 'public_read_cache_apply_policy') {
        applyCalls.push(args?.policy);
        return null;
      }
      if (command === 'desktop_config_write') {
        return { revision: REV };
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    const stop = createPublicCachePolicySync(store, { invoke });
    await store.ready();
    await vi.waitFor(() => {
      expect(applyCalls).toHaveLength(1);
    });

    // 非缓存字段的写入：策略未变，不重复推送。
    store.setField('confirmContentLinks', false);
    await vi.waitFor(() => {
      expect(store.getSnapshot().saving).toBe(false);
    });
    expect(applyCalls).toHaveLength(1);

    // 缓存字段变化 → 第二次推送。
    store.setField('publicCacheWhenFull', 'evict-least-recently-used');
    await vi.waitFor(() => {
      expect(applyCalls).toHaveLength(2);
    });
    expect(applyCalls[1]).toEqual({
      captureEnabled: true,
      maxBytes: 268_435_456,
      whenFull: 'evict-least-recently-used',
    });
    stop();
  });

  it('a degraded file pushes pause semantics instead of normalized defaults', async () => {
    const applyCalls: unknown[] = [];
    const invoke = makeInvoke(async (command, args) => {
      if (command === 'desktop_config_read') {
        return readResult(
          okFile('{"version":1,"publicLibraryCache":{"maxBytes":"not-a-number"}}'),
        );
      }
      if (command === 'public_read_cache_apply_policy') {
        applyCalls.push(args?.policy);
        return null;
      }
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    const stop = createPublicCachePolicySync(store, { invoke });
    await store.ready();
    await vi.waitFor(() => {
      expect(applyCalls).toHaveLength(1);
    });
    expect(applyCalls[0]).toEqual({
      captureEnabled: false,
      maxBytes: 268_435_456,
      whenFull: 'pause',
    });
    stop();
  });

  it('a failed push is retried on the next publish instead of being swallowed', async () => {
    let applyAttempts = 0;
    const invoke = makeInvoke(async (command, _args) => {
      if (command === 'desktop_config_read') return readResult({ status: 'missing' });
      if (command === 'public_read_cache_apply_policy') {
        applyAttempts += 1;
        if (applyAttempts === 1) {
          throw { code: 'storage-unavailable', message: '缓存库不可用' };
        }
        return null;
      }
      if (command === 'desktop_config_write') return { revision: REV };
      return undefined;
    });
    const store = new DesktopConfigStore({ invoke });
    const stop = createPublicCachePolicySync(store, { invoke });
    await store.ready();
    await vi.waitFor(() => {
      expect(applyAttempts).toBe(1);
    });

    // 第一次推送失败 → 下一次发布（这里由一笔字段写触发）重试同一策略。
    store.setField('confirmContentLinks', false);
    await vi.waitFor(() => {
      expect(applyAttempts).toBe(2);
    });
    stop();
  });
});
