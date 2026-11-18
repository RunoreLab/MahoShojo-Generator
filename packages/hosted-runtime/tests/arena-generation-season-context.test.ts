import { describe, expect, it, vi } from 'vitest';

import { createArenaSeasonContextReader } from '../src/arena-generation/season-context';

describe('Arena season context authority', () => {
  it('normalizes the current season from a trusted configured origin', async () => {
    const fetcher = vi.fn(async () => Response.json({
      schemaVersion: 1,
      seasons: [{
        id: 's9', status: 'current',
        specialRules: {
          mode: 'scenario',
          storyGuidance: '  fixed  ',
          scenarioPresetFilename: 'season.json',
          questionnaireLorePresetIds: ['q1'],
        },
      }],
    }));
    const read = createArenaSeasonContextReader({
      baseUrl: 'https://web.example', fetch: fetcher,
    });
    await expect(read()).resolves.toEqual({
      authorityAvailable: true,
      seasonId: 's9',
      mode: 'scenario',
      storyGuidance: 'fixed',
      scenarioPresetFilename: 'season.json',
      questionnaireLoreAllowed: true,
      questionnaireLorePresetIds: ['q1'],
    });
  });

  it('marks transport failure unavailable instead of inventing classic authority', async () => {
    const read = createArenaSeasonContextReader({
      baseUrl: 'https://web.example',
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
    });
    await expect(read()).resolves.toMatchObject({ authorityAvailable: false });
  });

  it('热态刷新失败时走 stale-if-error 返回上次有效配置，冷态仅短缓存负结果并可恢复', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-18T00:00:00.000Z'));
      const coldFetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(Response.json({
          schemaVersion: 1,
          seasons: [{ id: 's10', status: 'current', specialRules: { mode: 'classic' } }],
        }));
      const coldRead = createArenaSeasonContextReader({
        baseUrl: 'https://web.example',
        fetch: coldFetcher,
        cacheTtlMs: 60_000,
        failureCacheTtlMs: 5_000,
      });

      await expect(coldRead()).resolves.toMatchObject({ authorityAvailable: false });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(coldRead()).resolves.toMatchObject({ authorityAvailable: false });
      expect(coldFetcher).toHaveBeenCalledTimes(1);

      // 超过短负缓存 5s 后立即重新探测恢复，而不锁死 60s
      await vi.advanceTimersByTimeAsync(3_500);
      await expect(coldRead()).resolves.toMatchObject({ authorityAvailable: true, seasonId: 's10' });
      expect(coldFetcher).toHaveBeenCalledTimes(2);

      // 热态下 cache 过期后上游短暂失败：降级返回 lastValid（stale-if-error）
      coldFetcher.mockResolvedValueOnce(new Response(null, { status: 502 }));
      await vi.advanceTimersByTimeAsync(61_000);
      await expect(coldRead()).resolves.toMatchObject({ authorityAvailable: true, seasonId: 's10' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('读取赛季上下文超时后中止请求并避免无限挂起', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('timeout', 'AbortError'));
        }, { once: true });
      }));
      const read = createArenaSeasonContextReader({
        baseUrl: 'https://web.example',
        fetch: fetcher,
        timeoutMs: 250,
      });

      const pending = read();
      await vi.advanceTimersByTimeAsync(250);
      await expect(pending).resolves.toMatchObject({ authorityAvailable: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
