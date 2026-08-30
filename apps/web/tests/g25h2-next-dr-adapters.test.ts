import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const core = (operation: string, stream: boolean) => vi.fn(async (request: Request) => {
    const payload = await request.json() as { secretCanary?: string };
    if (request.headers.get('x-test-error') === 'true') {
      return new Response(JSON.stringify({ error: 'HOSTED_GENERATION_FAILED' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'X-Core-Operation': operation },
      });
    }
    if (stream) {
      return new Response(
        `event: reasoning_done\ndata: {"source":"sdk","status":"done"}\n\n`
          + `event: markdown\ndata: {"chunk":"${operation}"}\n\n`,
        {
          status: 202,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'X-Core-Operation': operation,
          },
        },
      );
    }
    return new Response(JSON.stringify({
      data: { operation },
      aiMeta: { aiModel: 'next-dr-test-model' },
      sawSecretCanary: payload.secretCanary === 'request-payload-secret-canary',
    }), {
      status: 202,
      headers: {
        'Content-Type': 'application/json',
        'X-Core-Operation': operation,
        'X-Mahoshojo-AI-Meta': 'preserved',
      },
    });
  });
  return {
    details: core('generate-magical-girl-details', false),
    detailsStream: core('generate-magical-girl-details-stream', true),
    sublimation: core('generate-sublimation', false),
    sublimationStream: core('generate-sublimation-stream', true),
  };
});

vi.mock('@mahoshojo/hosted-runtime/node-runtime/default-services', () => ({
  configureDefaultNodeHostedD1ClientResolver: vi.fn(),
  defaultGenerateMagicalGirlDetailsService: mocks.details,
  defaultGenerateMagicalGirlDetailsStreamService: mocks.detailsStream,
  defaultGenerateSublimationService: mocks.sublimation,
  defaultGenerateSublimationStreamService: mocks.sublimationStream,
  createDefaultGenerateMagicalGirlDetailsService: vi.fn(() => mocks.details),
  createDefaultGenerateMagicalGirlDetailsStreamService: vi.fn(() => mocks.detailsStream),
  createDefaultGenerateSublimationService: vi.fn(() => mocks.sublimation),
  createDefaultGenerateSublimationStreamService: vi.fn(() => mocks.sublimationStream),
}));

import detailsHandler from '@/app/api/generate-magical-girl-details/handler';
import detailsStreamHandler from '@/app/api/generate-magical-girl-details-stream/handler';
import sublimationHandler from '@/app/api/generate-sublimation/handler';
import sublimationStreamHandler from '@/app/api/generate-sublimation-stream/handler';

const routes = [
  {
    operation: 'generate-magical-girl-details',
    handler: detailsHandler,
    core: mocks.details,
    stream: false,
  },
  {
    operation: 'generate-magical-girl-details-stream',
    handler: detailsStreamHandler,
    core: mocks.detailsStream,
    stream: true,
  },
  {
    operation: 'generate-sublimation',
    handler: sublimationHandler,
    core: mocks.sublimation,
    stream: false,
  },
  {
    operation: 'generate-sublimation-stream',
    handler: sublimationStreamHandler,
    core: mocks.sublimationStream,
    stream: true,
  },
] as const;

describe('G25H-2 Next DR POST / stream adapter contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(routes)('$operation 保留 shared core 的 POST status/header/body 与真实终态', async ({
    operation,
    handler,
    core,
    stream,
  }) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = await handler(new Request(
        `https://next-dr-url-secret-canary.test/api/${operation}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secretCanary: 'request-payload-secret-canary' }),
        },
      ));

      expect(response.status).toBe(202);
      expect(response.headers.get('x-core-operation')).toBe(operation);
      const body = await response.text();
      if (stream) {
        expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
        expect(body).toContain('event: reasoning_done');
        expect(body).toContain(`"chunk":"${operation}"`);
      } else {
        expect(response.headers.get('x-mahoshojo-ai-meta')).toBe('preserved');
        expect(JSON.parse(body)).toEqual({
          data: { operation },
          aiMeta: { aiModel: 'next-dr-test-model' },
          sawSecretCanary: true,
        });
      }
      expect(core).toHaveBeenCalledOnce();
      const lifecycle = JSON.parse(String(info.mock.calls[0]?.[0]));
      expect(lifecycle).toEqual(expect.objectContaining({
        event: 'hosted.generation.lifecycle',
        schemaVersion: 1,
        operation,
        placement: 'next-dr',
        outcome: 'success',
      }));
      expect(JSON.stringify(info.mock.calls)).not.toMatch(
        /next-dr-url-secret-canary|request-payload-secret-canary/u,
      );
    } finally {
      info.mockRestore();
    }
  });

  it.each(routes)('$operation 保留 shared core 的错误 wire 并记录 failure', async ({
    operation,
    handler,
  }) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = await handler(new Request(`https://example.test/api/${operation}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Error': 'true',
        },
        body: JSON.stringify({}),
      }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'HOSTED_GENERATION_FAILED' });
      expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual(expect.objectContaining({
        operation,
        placement: 'next-dr',
        outcome: 'failure',
      }));
    } finally {
      info.mockRestore();
    }
  });
});
