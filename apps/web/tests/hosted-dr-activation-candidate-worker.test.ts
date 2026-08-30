import { describe, expect, test, vi } from 'vitest';

import { createHostedDrActivationCandidateWorker } from '../lib/hosted-dr/activation-candidate-worker';

type TestEnvironment = Record<string, never>;
type TestContext = { waitUntil: (promise: Promise<unknown>) => void };

const request = (path: string, method = 'GET'): Request => new Request(
  `https://homura-dr.colanns.me${path}`,
  { method },
);

describe('Hosted DR activation candidate outer Worker', () => {
  test.each(['GET', 'HEAD'])('仅将 readiness %s 委托给 OpenNext', async (method) => {
    const upstreamFetch = vi.fn(async () => new Response('delegated'));
    const worker = createHostedDrActivationCandidateWorker<TestEnvironment, TestContext>({
      fetch: upstreamFetch,
    });
    const environment = {};
    const context = { waitUntil: vi.fn() };

    const response = await worker.fetch(
      request('/api/hosted/dr-readiness?probe=phase-2.5', method),
      environment,
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('delegated');
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  test.each([
    ['/api/hosted/dr-readiness', 'POST'],
    ['/', 'GET'],
    ['/_next/image?url=https%3A%2F%2Fexample.com%2Fimage.png&w=64&q=75', 'GET'],
    ['/cdn-cgi/image/width=64/https://example.com/image.png', 'GET'],
  ])('在 OpenNext 之前拒绝 %s %s', async (path, method) => {
    const upstreamFetch = vi.fn(async () => new Response('unexpected'));
    const worker = createHostedDrActivationCandidateWorker<TestEnvironment, TestContext>({
      fetch: upstreamFetch,
    });

    const response = await worker.fetch(
      request(path, method),
      {},
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  test('不依赖运行时开关，候选入口缺少环境变量时仍保持 fail-closed', async () => {
    const upstreamFetch = vi.fn(async () => new Response('unexpected'));
    const worker = createHostedDrActivationCandidateWorker<TestEnvironment, TestContext>({
      fetch: upstreamFetch,
    });

    const response = await worker.fetch(
      request('/api/generate-free'),
      {},
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
