import { afterEach, describe, expect, test } from 'vitest';

import { withEdgeCache } from '@/lib/edge-cache';

describe('withEdgeCache relative URL support', () => {
  const originalCaches = (globalThis as { caches?: unknown }).caches;

  afterEach(() => {
    (globalThis as { caches?: unknown }).caches = originalCaches;
  });

  test('Worker 相对 URL key 不应导致缓存层抛出 Invalid URL', async () => {
    const req = { method: 'GET', url: '/api/tags?includeInactive=1' } as Request;

    const response = await withEdgeCache(req, { key: req.url, ttlSeconds: 300 }, async () => {
      return new Response('ok', { status: 200 });
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  test('Cache API 写入挂起时不应阻塞业务响应', async () => {
    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: async () => null,
        put: () => new Promise<never>(() => {}),
      },
    };

    const req = {
      method: 'GET',
      url: '/api/tags?includeInactive=1',
      headers: new Headers({ host: 'example.test' }),
    } as Request;

    const response = await Promise.race([
      withEdgeCache(req, { key: req.url, ttlSeconds: 300 }, async () => {
        return new Response('ok', { status: 200 });
      }),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 80)),
    ]);

    expect(response).not.toBe('timeout');
    expect(response).toBeInstanceOf(Response);
  });

  test('Cache API 命中时应直接返回缓存响应且不调用 handler', async () => {
    let handlerCalls = 0;
    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: async () => new Response('cached', { status: 200 }),
        put: async () => undefined,
      },
    };

    const req = {
      method: 'GET',
      url: '/api/tags?includeInactive=1&case=cache-hit',
      headers: new Headers({ host: 'example.test' }),
    } as Request;

    const response = await withEdgeCache(req, { key: req.url, ttlSeconds: 300 }, async () => {
      handlerCalls += 1;
      return new Response('fresh', { status: 200 });
    });

    expect(await response.text()).toBe('cached');
    expect(handlerCalls).toBe(0);
  });

  test('Cache API 读取挂起时不应阻塞业务响应', async () => {
    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: () => new Promise<never>(() => {}),
        put: async () => undefined,
      },
    };

    const req = {
      method: 'GET',
      url: '/api/tags?includeInactive=1&case=match-hang',
      headers: new Headers({ host: 'example.test' }),
    } as Request;

    const response = await Promise.race([
      withEdgeCache(req, { key: req.url, ttlSeconds: 300 }, async () => {
        return new Response('ok', { status: 200 });
      }),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 80)),
    ]);

    expect(response).not.toBe('timeout');
    expect(response).toBeInstanceOf(Response);
  });

  test('响应体 clone 读取挂起时不应阻塞业务响应', async () => {
    const req = { method: 'GET', url: '/api/tags?includeInactive=1&case=clone-hang' } as Request;
    const hangingResponse = {
      status: 200,
      headers: new Headers(),
      clone: () => ({
        text: () => new Promise<never>(() => {}),
      }),
    } as unknown as Response;

    const response = await Promise.race([
      withEdgeCache(req, { key: req.url, ttlSeconds: 300 }, async () => hangingResponse),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30)),
    ]);

    expect(response).not.toBe('timeout');
    expect(response).toBe(hangingResponse);
  });
});
