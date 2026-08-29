import { afterEach, describe, expect, it, vi } from 'vitest';

import { hostedDrClientRouting } from '@/config/hosted-dr-client.generated';
import {
  lookupHostedDrClientOperation,
  selectHostedDrPlacement,
} from '@/lib/hosted-dr/client-preflight';

const readyResponse = (
  placement: 'hono-primary' | 'next-dr',
  overrides: Record<string, unknown> = {},
) => Response.json({
  ok: true,
  ...(placement === 'hono-primary' ? { service: 'mahoshojo-hono' } : {}),
  placement,
  contractVersion: 'g25e1-v1',
  ...overrides,
}, {
  headers: { 'Cache-Control': 'no-store' },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Hosted DR client preflight selector', () => {
  it('primary ready 时只执行一次无凭据 GET，并固定 hono-primary', async () => {
    const fetcher = vi.fn(async () => readyResponse('hono-primary'));

    const decision = await selectHostedDrPlacement({
      path: '/api/generate-free?format=sse',
      method: 'POST',
      fetcher,
    });

    expect(decision).toMatchObject({
      placement: 'hono-primary',
      reason: 'PRIMARY_READY',
      contractVersion: 'g25e1-v1',
      routeFamily: '/api/generate-free',
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://homura.colanns.me/api/health/ready');
    expect(init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    });
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('eligible operation 在 primary non-ready 后只探测一次 DR 并固定 next-dr', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }))
      .mockResolvedValueOnce(readyResponse('next-dr'));

    const decision = await selectHostedDrPlacement({
      path: '/api/creator/generate',
      method: 'post',
      fetcher,
    });

    expect(decision).toMatchObject({
      placement: 'next-dr',
      reason: 'DR_READY',
      routeFamily: '/api/creator/generate',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'https://mahoshojo.colanns.me/api/hosted/dr-readiness',
    );
  });

  it('隔离验证可以注入 loopback routing，而 production 默认仍来自 generated projection', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }))
      .mockResolvedValueOnce(readyResponse('next-dr'));

    const decision = await selectHostedDrPlacement({
      path: '/api/generate-free',
      method: 'POST',
      fetcher,
      routing: {
        ...hostedDrClientRouting,
        primaryOrigin: 'http://127.0.0.1:41001',
        drOrigin: 'http://127.0.0.1:41002',
      },
    });

    expect(decision.placement).toBe('next-dr');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:41001/api/health/ready',
      'http://127.0.0.1:41002/api/hosted/dr-readiness',
    ]);
  });

  it('fail-closed operation 在 primary non-ready 时不探测 DR', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: false }, { status: 503 }));

    const decision = await selectHostedDrPlacement({
      path: '/api/arena/generate',
      method: 'POST',
      fetcher,
    });

    expect(decision).toMatchObject({
      placement: 'unavailable',
      reason: 'DR_NOT_ELIGIBLE',
      routeFamily: '/api/arena/generate',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('未登记 route/method 在 primary non-ready 时不探测 DR', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: false }, { status: 503 }));

    const decision = await selectHostedDrPlacement({
      path: '/api/generate-free',
      method: 'DELETE',
      fetcher,
    });

    expect(decision).toMatchObject({
      placement: 'unavailable',
      reason: 'OPERATION_NOT_DECLARED',
      routeFamily: 'undeclared',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('动态 route 只匹配单个非空 segment 与精确 method', () => {
    expect(lookupHostedDrClientOperation(
      '/api/arena/generations/generation-1/stream?after=8-0',
      'GET',
    )).toMatchObject({
      route: '/api/arena/generations/[generationId]/stream',
      drMode: 'safe-read',
    });
    expect(lookupHostedDrClientOperation(
      '/api/arena/generations/generation-1/extra/stream',
      'GET',
    )).toBeNull();
    expect(lookupHostedDrClientOperation(
      '/api/arena/generations/generation-1/stream',
      'POST',
    )).toBeNull();
  });

  it('协议不匹配或可缓存的 primary response 不能被视为 ready', async () => {
    const cacheablePrimary = Response.json({
      ok: true,
      service: 'mahoshojo-hono',
      placement: 'hono-primary',
      contractVersion: 'g25e1-v1',
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(cacheablePrimary)
      .mockResolvedValueOnce(readyResponse('next-dr'));

    const decision = await selectHostedDrPlacement({
      path: '/api/generate-game-card',
      method: 'POST',
      fetcher,
    });

    expect(decision.placement).toBe('next-dr');
    expect(decision.primaryProbe.outcome).toBe('protocol-error');
  });

  it.each([
    ['旧 client 接受相邻新版 primary', 'g25e1-v1', 'g25e1-v2'],
    ['新 client 接受相邻旧版 primary', 'g25e1-v2', 'g25e1-v1'],
  ])('%s', async (_label, clientVersion, primaryVersion) => {
    const fetcher = vi.fn(async () => readyResponse('hono-primary', {
      contractVersion: primaryVersion,
    }));

    const decision = await selectHostedDrPlacement({
      path: '/api/generate-free',
      method: 'POST',
      fetcher,
      routing: { ...hostedDrClientRouting, contractVersion: clientVersion },
    });

    expect(decision.placement).toBe('hono-primary');
    expect(decision.primaryProbe.outcome).toBe('ready');
  });

  it('旧 client 在 primary down 时接受相邻新版 DR', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }))
      .mockResolvedValueOnce(readyResponse('next-dr', { contractVersion: 'g25e1-v2' }));

    const decision = await selectHostedDrPlacement({
      path: '/api/generate-free',
      method: 'POST',
      fetcher,
      routing: { ...hostedDrClientRouting, contractVersion: 'g25e1-v1' },
    });

    expect(decision.placement).toBe('next-dr');
    expect(decision.drProbe?.outcome).toBe('ready');
  });

  it('超出相邻版本窗口的 readiness 继续 fail closed', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(readyResponse('hono-primary', { contractVersion: 'g25e1-v3' }))
      .mockResolvedValueOnce(readyResponse('next-dr', { contractVersion: 'g25e1-v3' }));

    const decision = await selectHostedDrPlacement({
      path: '/api/generate-free',
      method: 'POST',
      fetcher,
      routing: { ...hostedDrClientRouting, contractVersion: 'g25e1-v1' },
    });

    expect(decision.placement).toBe('unavailable');
    expect(decision.primaryProbe.outcome).toBe('protocol-error');
    expect(decision.drProbe?.outcome).toBe('protocol-error');
  });

  it('primary 和 DR 都 non-ready 时返回 NO_READY_PLACEMENT', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: false }, { status: 503 }));

    const decision = await selectHostedDrPlacement({
      path: '/api/generate-magical-girl',
      method: 'POST',
      fetcher,
    });

    expect(decision).toMatchObject({
      placement: 'unavailable',
      reason: 'NO_READY_PLACEMENT',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('probe 超时会 abort 自己的 transport，不自动重试', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      }),
    ));

    const pending = selectHostedDrPlacement({
      path: '/api/arena/generate',
      method: 'POST',
      fetcher,
      timeoutMs: 500,
    });
    void pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(500);
    const decision = await pending;

    expect(decision).toMatchObject({
      placement: 'unavailable',
      reason: 'DR_NOT_ELIGIBLE',
      primaryProbe: { outcome: 'timeout' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
