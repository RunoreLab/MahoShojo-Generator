import { describe, expect, it, vi } from 'vitest';

import {
  createGenerateMagicalGirlDetailsService,
  createGenerateMagicalGirlDetailsStreamService,
} from '../src/generate-magical-girl-details';
import {
  createGenerateSublimationService,
  createGenerateSublimationStreamService,
} from '../src/generate-sublimation';
import { completeStep } from '../src/regular-generation';

const request = (body = JSON.stringify({ value: 'ok' }), signal?: AbortSignal) => new Request(
  'https://example.test/api/generate',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    ...(signal ? { signal } : {}),
  },
);

const dependencies = (events: string[]) => ({
  prepare: vi.fn(async () => {
    events.push('prepare');
    return completeStep({ prepared: true });
  }),
  checkRateLimit: vi.fn(async () => {
    events.push('rate-limit');
    return null;
  }),
  enforceSafety: vi.fn(async () => {
    events.push('safety');
    return null;
  }),
  resolveExecution: vi.fn(async () => {
    events.push('provider');
    return completeStep({ provider: 'system' });
  }),
  generate: vi.fn(async (incomingRequest: Request) => {
    events.push('generate');
    return completeStep({ signal: incomingRequest.signal });
  }),
  recordActivity: vi.fn(() => events.push('activity')),
  buildResponse: vi.fn(async () => {
    events.push('response');
    return new Response('ok');
  }),
  logError: vi.fn(),
});

describe('Details / Sublimation shared application services', () => {
  it.each([
    ['Details', createGenerateMagicalGirlDetailsService, [
      'prepare', 'provider', 'rate-limit', 'safety', 'generate', 'activity', 'response',
    ]],
    ['Details stream', createGenerateMagicalGirlDetailsStreamService, [
      'prepare', 'rate-limit', 'safety', 'provider', 'generate', 'activity', 'response',
    ]],
    ['Sublimation', createGenerateSublimationService, [
      'prepare', 'rate-limit', 'safety', 'provider', 'generate', 'activity', 'response',
    ]],
    ['Sublimation stream', createGenerateSublimationStreamService, [
      'prepare', 'rate-limit', 'safety', 'provider', 'generate', 'activity', 'response',
    ]],
  ] as const)('%s 保持 legacy 步骤顺序与 abort identity', async (_name, factory, expectedEvents) => {
    const events: string[] = [];
    const controller = new AbortController();
    const deps = dependencies(events);
    const incomingRequest = request(undefined, controller.signal);

    const response = await factory(deps)(incomingRequest);

    expect(response.status).toBe(200);
    expect(events).toEqual(expectedEvents);
    expect(deps.generate.mock.calls[0]?.[0].signal).toBe(incomingRequest.signal);
  });

  it('Details malformed JSON 保持既有 400 wire，且不进入业务步骤', async () => {
    const deps = dependencies([]);
    const response = await createGenerateMagicalGirlDetailsService(deps)(request('{'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it.each([
    ['Details', createGenerateMagicalGirlDetailsService, '生成失败，当前服务器可能正忙，请稍后重试'],
    ['Details stream', createGenerateMagicalGirlDetailsStreamService, '生成失败'],
    ['Sublimation', createGenerateSublimationService, '角色成长升华失败: HOSTED_GENERATION_FAILED'],
    ['Sublimation stream', createGenerateSublimationStreamService, '生成失败'],
  ] as const)('%s 异常响应不泄漏原始错误', async (_name, factory, publicError) => {
    const deps = dependencies([]);
    deps.generate.mockRejectedValueOnce(new Error('provider-secret-canary'));

    const response = await factory(deps)(request());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual(expect.objectContaining({ error: publicError }));
    expect(JSON.stringify({ payload, log: deps.logError.mock.calls })).not.toContain(
      'provider-secret-canary',
    );
  });

  it.each([
    createGenerateMagicalGirlDetailsService,
    createGenerateMagicalGirlDetailsStreamService,
    createGenerateSublimationService,
    createGenerateSublimationStreamService,
  ])('非 POST method fail closed 且不进入业务步骤', async (factory) => {
    const deps = dependencies([]);
    const response = await factory(deps)(new Request('https://example.test/api/generate'));

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
    expect(deps.prepare).not.toHaveBeenCalled();
  });
});
