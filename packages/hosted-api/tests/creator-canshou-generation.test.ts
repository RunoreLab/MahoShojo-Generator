import { describe, expect, it, vi } from 'vitest';

import {
  createGenerateCreatorService,
  createGenerateCreatorStreamService,
} from '../src/generate-creator';
import {
  createGenerateCanshouService,
  createGenerateCanshouStreamService,
} from '../src/generate-canshou';
import { completeStep, respondStep } from '../src/regular-generation';

type Prepared = { template: string };
type Execution = { provider: string };
type Generated = { value: string };

const request = (body = JSON.stringify({ template: 'test' }), signal?: AbortSignal) => new Request(
  'https://example.test/api/generate',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    ...(signal ? { signal } : {}),
  },
);

const dependencies = (events: string[]) => ({
  prepare: vi.fn(async (_request: Request, body: unknown) => {
    events.push('prepare');
    return completeStep({
      template: (body as { template?: string })?.template ?? 'missing',
    });
  }),
  resolveExecution: vi.fn(async () => {
    events.push('provider');
    return completeStep({ provider: 'system' });
  }),
  checkRateLimit: vi.fn(async (): Promise<Response | null> => {
    events.push('rate-limit');
    return null;
  }),
  enforceSafety: vi.fn(async () => {
    events.push('safety');
    return null;
  }),
  generate: vi.fn(async (incomingRequest: Request) => {
    events.push(`generate:${incomingRequest.signal.aborted ? 'aborted' : 'active'}`);
    return completeStep({ value: 'generated' });
  }),
  recordActivity: vi.fn(() => {
    events.push('activity');
  }),
  buildResponse: vi.fn(async () => {
    events.push('response');
    return new Response('ok', {
      status: 200,
      headers: { 'X-Upstream-Response': 'preserved' },
    });
  }),
  logError: vi.fn((error: unknown) => {
    events.push(`error:${error instanceof Error ? error.message : String(error)}`);
  }),
});

describe('Creator / 残兽 shared generation services', () => {
  it('Creator 非流式保留 Provider 在限速与安全之前解析的顺序', async () => {
    const events: string[] = [];
    const service = createGenerateCreatorService<Prepared, Execution, Generated>(
      dependencies(events),
    );

    const response = await service(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('x-upstream-response')).toBe('preserved');
    expect(events).toEqual([
      'prepare',
      'provider',
      'rate-limit',
      'safety',
      'generate:active',
      'activity',
      'response',
    ]);
  });

  it.each([
    ['Creator stream', createGenerateCreatorStreamService<Prepared, Execution, Generated>],
    ['残兽 non-stream', createGenerateCanshouService<Prepared, Execution, Generated>],
    ['残兽 stream', createGenerateCanshouStreamService<Prepared, Execution, Generated>],
  ] as const)('%s 保留限速、安全、Provider、生成、活动与响应顺序', async (_name, createService) => {
    const events: string[] = [];
    const controller = new AbortController();
    const deps = dependencies(events);
    const service = createService(deps);
    const incomingRequest = request(undefined, controller.signal);

    const response = await service(incomingRequest);

    expect(response.status).toBe(200);
    expect(events).toEqual([
      'prepare',
      'rate-limit',
      'safety',
      'provider',
      'generate:active',
      'activity',
      'response',
    ]);
    const upstreamSignal = deps.generate.mock.calls[0]?.[0].signal;
    expect(upstreamSignal).toBe(incomingRequest.signal);
    expect(upstreamSignal.aborted).toBe(false);
    controller.abort('caller-abort');
    expect(upstreamSignal.aborted).toBe(true);
  });

  it('Creator 非流式 malformed JSON 使用既有 400 wire 且不记录生成错误', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    const service = createGenerateCreatorService<Prepared, Execution, Generated>(deps);

    const response = await service(request('{'));

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(events).toEqual([]);
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it('残兽非流式 malformed JSON 使用既有 busy 500 wire 并记录错误', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    const service = createGenerateCanshouService<Prepared, Execution, Generated>(deps);

    const response = await service(request('{'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: '生成失败，当前服务器可能正忙，请稍后重试',
      message: expect.any(String),
    });
    expect(events[0]).toMatch(/^error:/u);
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it('任一步骤短路后不得执行 Provider、生成、活动或响应', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.checkRateLimit.mockImplementationOnce(async () => {
      events.push('rate-limit');
      return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
    });
    const service = createGenerateCreatorStreamService<Prepared, Execution, Generated>(deps);

    const response = await service(request());

    expect(response.status).toBe(429);
    expect(events).toEqual(['prepare', 'rate-limit']);
    expect(deps.resolveExecution).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.recordActivity).not.toHaveBeenCalled();
    expect(deps.buildResponse).not.toHaveBeenCalled();
  });

  it.each([
    ['prepare', ['prepare']],
    ['safety', ['prepare', 'rate-limit', 'safety']],
    ['provider', ['prepare', 'rate-limit', 'safety', 'provider']],
    ['generate', ['prepare', 'rate-limit', 'safety', 'provider', 'generate']],
  ] as const)('%s 返回 StepResult/Response 时停止全部后续步骤', async (step, expectedEvents) => {
    const events: string[] = [];
    const deps = dependencies(events);
    const stopped = () => new Response(JSON.stringify({ error: `${step} stopped` }), {
      status: 418,
    });
    if (step === 'prepare') {
      deps.prepare.mockImplementationOnce(async () => {
        events.push('prepare');
        return respondStep(stopped()) as never;
      });
    } else if (step === 'safety') {
      deps.enforceSafety.mockImplementationOnce(async () => {
        events.push('safety');
        return stopped() as never;
      });
    } else if (step === 'provider') {
      deps.resolveExecution.mockImplementationOnce(async () => {
        events.push('provider');
        return respondStep(stopped()) as never;
      });
    } else {
      deps.generate.mockImplementationOnce(async () => {
        events.push('generate');
        return respondStep(stopped()) as never;
      });
    }
    const service = createGenerateCreatorStreamService<Prepared, Execution, Generated>(deps);

    const response = await service(request());

    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({ error: `${step} stopped` });
    expect(events).toEqual(expectedEvents);
    expect(deps.recordActivity).not.toHaveBeenCalled();
    expect(deps.buildResponse).not.toHaveBeenCalled();
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it('正常拒绝使用 StepResult 响应且不被转换成异常 wire', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.resolveExecution.mockImplementationOnce(async () => {
      events.push('provider');
      return respondStep(new Response(JSON.stringify({ error: 'provider invalid' }), {
        status: 400,
      }));
    });
    const service = createGenerateCanshouStreamService<Prepared, Execution, Generated>(deps);

    const response = await service(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'provider invalid' });
    expect(events).toEqual(['prepare', 'rate-limit', 'safety', 'provider']);
    expect(deps.logError).not.toHaveBeenCalled();
  });
});
