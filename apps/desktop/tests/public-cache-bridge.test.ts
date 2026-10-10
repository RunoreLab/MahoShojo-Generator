/**
 * `public-cache-bridge` 的契约复核与错误投影（D5.1-K1/K2，DESK-CACHE-004~008）。
 *
 * 桥只做三件事：发对命令（策略/统计/清空/摘要查询/单卡正文）、把 native
 * 返回按 desktop-ipc schema 复核、把错误按已登记错误码透出。不符合契约
 * 的载荷与未登记错误码都归为 fail-closed。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  applyPublicCachePolicy,
  clearPublicCache,
  DesktopPublicCacheError,
  queryPublicReadCache,
  readPublicCacheCard,
  readPublicCacheStats,
} from '../src/platform/public-cache-bridge';
import type { InvokeFn } from '../src/platform/public-cache-bridge';

/**
 * 从 `lib.rs` 的 `#[tauri::command]` 签名里提取业务参数名。
 *
 * Tauri 按 Rust 参数名绑定 `invoke` 顶层键——桥发出的键必须和签名里的
 * 业务参数名逐一相同，否则命令在 native 反序列化阶段就失败。这里不做
 * 全量 Rust 解析：命令签名只允许「Tauri 注入参数（`app`/`state`/`handle`
 * 等）+ 扁平的业务参数」形态，按顶层逗号切分（跳过 `<…>`/`(…)` 内部）
 * 已足够覆盖现有命令面。
 */
const nativeBusinessArgNames = (command: string): string[] => {
  const libSource = readFileSync(
    path.resolve(import.meta.dirname, '..', 'src-tauri', 'src', 'lib.rs'),
    'utf8',
  );
  const signature = new RegExp(`(?:async\\s+)?fn\\s+${command}\\s*\\(`, 'u').exec(libSource);
  if (signature === null) throw new Error(`lib.rs 中必须存在 ${command} 命令函数`);
  // 提取配对括号内的参数列表。
  const rest = libSource.slice(signature.index + signature[0].length);
  let depth = 1;
  let end = 0;
  while (end < rest.length && depth > 0) {
    if (rest[end] === '(') depth += 1;
    if (rest[end] === ')') depth -= 1;
    end += 1;
  }
  const paramsSource = rest.slice(0, end - 1);
  const params: string[] = [];
  let bracketDepth = 0;
  let current = '';
  for (const ch of paramsSource) {
    if (ch === '<' || ch === '[') bracketDepth += 1;
    if (ch === '>' || ch === ']') bracketDepth -= 1;
    if (ch === ',' && bracketDepth === 0) {
      params.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current);
  // Tauri 注入参数一律命名为 app/state/handle 且类型是
  // `tauri::AppHandle`/`State<'_, _>`——按名剔除后剩下的就是业务参数。
  return params
    .map((param) => param.split(':')[0]?.trim() ?? '')
    .filter((name) => name.length > 0 && name !== 'app' && name !== 'state' && name !== 'handle');
};

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

  /* ── K2 读取通路（DESK-CACHE-004/005）────────────────────────────── */

  it('query sends the fixed command with a validated list query', async () => {
    const invoke: InvokeFn = vi.fn(async () => ({
      status: 'ready',
      entries: [
        {
          card: { id: 'c1', type: 'character', name: '缓存角色' },
          hasBody: true,
          lastSuccessAt: '2026-10-05T00:00:00Z',
          summaryUpdatedAt: '2026-10-05T00:00:00Z',
          bodyUpdatedAt: '2026-10-05T00:00:00Z',
        },
      ],
      total: 7,
      bodyCount: 3,
    }));
    const result = await queryPublicReadCache(invoke, {
      type: 'character',
      limit: 12,
      offset: 24,
      sortBy: 'likes',
      search: '魔法',
      tagIds: ['t1'],
      tagMatch: 'all',
      author: '作者A',
      minLikes: '5',
      nativeAllowedOnly: true,
    });
    expect(invoke).toHaveBeenCalledWith('public_read_cache_query', {
      request: {
        type: 'character',
        limit: 12,
        offset: 24,
        sortBy: 'likes',
        search: '魔法',
        tagIds: ['t1'],
        tagMatch: 'all',
        author: '作者A',
        minLikes: '5',
        nativeAllowedOnly: true,
      },
    });
    // total 是匹配缓存的行数——不是线上 total（DESK-CACHE-004）。
    expect(result.total).toBe(7);
    expect(result.bodyCount).toBe(3);
  });

  it('query rejects invalid params before IPC; malformed pages become bridge-invalid', async () => {
    const invoke: InvokeFn = vi.fn(async () => null);
    for (const query of [
      { limit: 0, offset: 0, sortBy: 'likes' },
      { limit: 12, offset: -1, sortBy: 'likes' },
      { limit: 12, offset: 0, sortBy: 'name' },
      { limit: 12, offset: 0, sortBy: 'likes', nativeOnly: true },
      { limit: 12, offset: 0, sortBy: 'likes', tagIds: [] },
    ]) {
      await expect(
        queryPublicReadCache(invoke, query as never),
      ).rejects.toMatchObject({ code: 'invalid-request' });
    }
    expect(invoke).not.toHaveBeenCalled();

    const bad: InvokeFn = vi.fn(async () => ({ status: 'ready', entries: 'nope', total: 0, bodyCount: 0 }));
    await expect(queryPublicReadCache(bad, { limit: 12, offset: 0, sortBy: 'likes' }))
      .rejects.toMatchObject({ code: 'bridge-invalid' });
  });

  it('card read validates id, returns availability verbatim, and keeps withdrawn unavailable', async () => {
    const full: InvokeFn = vi.fn(async () => ({
      status: 'ready',
      availability: 'full',
      entry: {
        card: { id: 'c1', data: '{"a":1}' },
        bodyUpdatedAt: '2026-10-05T00:00:00Z',
        lastSuccessAt: '2026-10-05T00:00:00Z',
      },
    }));
    const result = await readPublicCacheCard(full, 'c1');
    expect(full).toHaveBeenCalledWith('public_read_cache_card', { request: { cardId: 'c1' } });
    expect(result.availability).toBe('full');

    const withdrawn: InvokeFn = vi.fn(async () => ({
      status: 'ready',
      availability: 'withdrawn',
      entry: null,
    }));
    const res = await readPublicCacheCard(withdrawn, 'c1');
    // 撤回如实透出——renderer 不得拿它当「没有正文」再降级展示（DESK-CACHE-005）。
    expect(res.availability).toBe('withdrawn');
    expect(res.entry).toBeNull();

    await expect(readPublicCacheCard(vi.fn(), '  ')).rejects.toMatchObject({ code: 'invalid-request' });
    const bad: InvokeFn = vi.fn(async () => ({ status: 'ready', availability: 'maybe' }));
    await expect(readPublicCacheCard(bad, 'c1')).rejects.toMatchObject({ code: 'bridge-invalid' });
  });

  /**
   * K2-r1 跨语言契约门禁：每条命令发出的顶层参数键必须逐一等于
   * `lib.rs` 里对应 `#[tauri::command]` 签名的业务参数名。
   * 分开测两端、再用符合错误假设的 mock 拼接，测不出参数名漂移——
   * 这里直接以 Rust 源码签名为基准做真实形状断言。
   */
  it('sends invoke payloads keyed by the actual Rust command argument names', async () => {
    type BridgeCall = { command: string; run: (invoke: InvokeFn) => Promise<unknown> };
    const calls: BridgeCall[] = [
      {
        command: 'public_read_cache_apply_policy',
        run: (invoke) =>
          applyPublicCachePolicy(invoke, {
            captureEnabled: true,
            maxBytes: 'unlimited',
            whenFull: 'pause',
          }),
      },
      { command: 'public_read_cache_stats', run: (invoke) => readPublicCacheStats(invoke) },
      { command: 'public_read_cache_clear', run: (invoke) => clearPublicCache(invoke) },
      {
        command: 'public_read_cache_query',
        run: (invoke) =>
          queryPublicReadCache(invoke, { limit: 5, offset: 0, sortBy: 'created_at' }),
      },
      { command: 'public_read_cache_card', run: (invoke) => readPublicCacheCard(invoke, 'c1') },
    ];

    for (const { command, run } of calls) {
      const invoke: InvokeFn = vi.fn().mockImplementation((name: string) => {
        if (name === 'public_read_cache_stats') {
          return Promise.resolve({
            status: 'empty',
            path: '/tmp/public-read-cache.sqlite',
            usageBytes: 0,
            entryCount: 0,
            summaryCount: 0,
            bodyCount: 0,
            withdrawnCount: 0,
            appliedPolicy: { captureEnabled: true, maxBytes: 'unlimited', whenFull: 'pause' },
          });
        }
        if (name === 'public_read_cache_clear') {
          return Promise.resolve({ removedEntries: 0, freedBytes: 0 });
        }
        if (name === 'public_read_cache_query') {
          return Promise.resolve({ status: 'empty', entries: [], total: 0, bodyCount: 0 });
        }
        if (name === 'public_read_cache_card') {
          return Promise.resolve({ status: 'ready', availability: 'absent', entry: null });
        }
        return Promise.resolve({ ok: true });
      });
      await run(invoke);
      expect(invoke).toHaveBeenCalledTimes(1);
      const [calledName, payload] = vi.mocked(invoke).mock.calls[0] as [
        string,
        Record<string, unknown> | undefined,
      ];
      expect(calledName).toBe(command);
      // 无参命令发出 `invoke(name)`——空键集合对应 Rust 侧只有注入参数。
      expect(Object.keys(payload ?? {}).sort()).toEqual(nativeBusinessArgNames(command).sort());
    }
  });
});
