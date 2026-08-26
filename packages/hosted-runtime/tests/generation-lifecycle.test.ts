import { describe, expect, it, vi } from 'vitest';

import {
  createObservedHostedGenerationService,
  createStructuredNextDrLifecycleObserver,
  type HostedGenerationLifecycleObservation,
} from '@mahoshojo/hosted-runtime/generation-lifecycle';

describe('Hosted generation lifecycle observation', () => {
  it.each([
    [200, 'success'],
    [429, 'rejected'],
    [500, 'failure'],
  ] as const)('按固定 operation/placement 聚合非流式 HTTP %s', async (status, outcome) => {
    const observations: HostedGenerationLifecycleObservation[] = [];
    const service = createObservedHostedGenerationService({
      operation: 'generate-magical-girl-details',
      placement: 'hono-primary',
      service: async () => new Response('body-secret-canary', { status }),
      observe: (observation) => observations.push(observation),
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(16),
    });

    await service(new Request('https://runtime-secret-canary.test/api'));

    expect(observations).toEqual([{
      event: 'hosted-generation',
      operation: 'generate-magical-girl-details',
      placement: 'hono-primary',
      outcome,
      durationMs: 6,
    }]);
    expect(JSON.stringify(observations)).not.toMatch(/body-secret|runtime-secret/u);
  });

  it('stream 在客户端取消消费时记为 cancelled，且 observation 失败不影响响应', async () => {
    const observations: HostedGenerationLifecycleObservation[] = [];
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'));
      },
    });
    const service = createObservedHostedGenerationService({
      operation: 'generate-sublimation-stream',
      placement: 'next-dr',
      service: async () => new Response(source),
      observe: (observation) => {
        observations.push(observation);
        throw new Error('telemetry-must-fail-soft');
      },
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(14),
    });

    const response = await service(new Request('https://example.test/api'));
    const reader = response.body!.getReader();
    await reader.read();
    await expect(reader.cancel('client-disconnect')).resolves.toBeUndefined();

    expect(observations).toEqual([expect.objectContaining({
      operation: 'generate-sublimation-stream',
      placement: 'next-dr',
      outcome: 'cancelled',
      durationMs: 4,
    })]);
  });

  it.each([
    'hono-primary',
    'next-dr',
  ] as const)('%s stream 自然完成时保留 wire 并且只记录一次 success', async (placement) => {
    const observations: HostedGenerationLifecycleObservation[] = [];
    const service = createObservedHostedGenerationService({
      operation: 'generate-magical-girl-details-stream',
      placement,
      service: async () => new Response('stream-body', {
        status: 201,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Upstream-Stream': 'preserved',
        },
      }),
      observe: (observation) => observations.push(observation),
      now: vi.fn().mockReturnValueOnce(20).mockReturnValueOnce(27),
    });

    const response = await service(new Request('https://example.test/api'));

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-upstream-stream')).toBe('preserved');
    expect(await response.text()).toBe('stream-body');
    expect(observations).toEqual([{
      event: 'hosted-generation',
      operation: 'generate-magical-girl-details-stream',
      placement,
      outcome: 'success',
      durationMs: 7,
    }]);
  });

  it.each([
    'hono-primary',
    'next-dr',
  ] as const)('%s stream 上游异常时只记录一次 failure 并透传读取失败', async (placement) => {
    const observations: HostedGenerationLifecycleObservation[] = [];
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('upstream-stream-failed'));
      },
    });
    const service = createObservedHostedGenerationService({
      operation: 'generate-sublimation-stream',
      placement,
      service: async () => new Response(source),
      observe: (observation) => observations.push(observation),
      now: vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(35),
    });

    const response = await service(new Request('https://example.test/api'));

    await expect(response.text()).rejects.toThrow('upstream-stream-failed');
    expect(observations).toEqual([expect.objectContaining({
      placement,
      outcome: 'failure',
      durationMs: 5,
    })]);
  });

  it.each([
    'hono-primary',
    'next-dr',
  ] as const)('%s stream abort 后自然结束只记录一次 cancelled', async (placement) => {
    const observations: HostedGenerationLifecycleObservation[] = [];
    const controller = new AbortController();
    const service = createObservedHostedGenerationService({
      operation: 'generate-sublimation-stream',
      placement,
      service: async () => new Response('done'),
      observe: (observation) => observations.push(observation),
      now: vi.fn().mockReturnValueOnce(40).mockReturnValueOnce(43),
    });

    const response = await service(new Request('https://example.test/api', {
      signal: controller.signal,
    }));
    controller.abort('caller-abort');

    expect(await response.text()).toBe('done');
    expect(observations).toEqual([expect.objectContaining({
      placement,
      outcome: 'cancelled',
      durationMs: 3,
    })]);
  });

  it('Next DR logger 只输出固定低基数字段', () => {
    const logger = vi.fn();
    const observe = createStructuredNextDrLifecycleObserver(logger);
    observe({
      event: 'hosted-generation',
      operation: 'generate-sublimation',
      placement: 'next-dr',
      outcome: 'success',
      durationMs: 12,
    });

    const serialized = String(logger.mock.calls[0]?.[0]);
    expect(JSON.parse(serialized)).toEqual({
      event: 'hosted.generation.lifecycle',
      schemaVersion: 1,
      operation: 'generate-sublimation',
      placement: 'next-dr',
      outcome: 'success',
      durationMs: 12,
    });
    expect(serialized).not.toMatch(/prompt|body|questionnaire|provider|url|secret/iu);
  });
});
