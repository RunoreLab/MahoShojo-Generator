import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureArenaGenerationService } from '@mahoshojo/hosted-runtime/arena-generation';
import { DELETE as cancelRequest, POST as create } from '../src/adapters/arena/generate-stream';
import { GET as lookup } from '../src/adapters/arena/generation-requests/[generationRequestId]';
import { POST as cancel } from '../src/adapters/arena/generations/[generationId]/cancel';
import { GET as status } from '../src/adapters/arena/generations/[generationId]';
import { GET as resume } from '../src/adapters/arena/generations/[generationId]/stream';

afterEach(() => configureArenaGenerationService(null));

const context = { params: Promise.resolve({ generationId: 'generation-1' }) };
const requestContext = { params: Promise.resolve({ generationRequestId: 'request-1' }) };

describe('Hono Arena generation adapters', () => {
  it('delegate create/lookup/resume/status/cancel to the same registered service', async () => {
    const response = (operation: string) => new Response(
      `id: 1-0\nevent: ${operation}\ndata: {"ok":true}\n\n`,
      {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-Mahoshojo-Generation-Id': 'generation-1',
        },
      },
    );
    const service = {
      create: vi.fn(async () => response('create')),
      resume: vi.fn(async () => response('resume')),
      status: vi.fn(async () => response('status')),
      cancel: vi.fn(async () => response('cancel')),
      cancelRequest: vi.fn(async () => response('cancel-request')),
      lookup: vi.fn(async () => response('lookup')),
    };
    configureArenaGenerationService(service);

    const responses = await Promise.all([
      create(new Request('https://example.test', { method: 'POST' })),
      resume(new Request('https://example.test'), context),
      status(new Request('https://example.test'), context),
      cancel(new Request('https://example.test', { method: 'POST' }), context),
      cancelRequest(new Request('https://example.test', { method: 'DELETE' })),
      lookup(new Request('https://example.test'), requestContext),
    ]);

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.resume).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
    expect(service.status).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
    expect(service.cancel).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
    expect(service.cancelRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(service.lookup).toHaveBeenCalledWith(expect.any(Request), {
      generationRequestId: 'request-1',
    });
    for (const responseValue of responses) {
      expect(responseValue.headers.get('content-type')).toContain('text/event-stream');
      expect(responseValue.headers.get('x-mahoshojo-generation-id')).toBe('generation-1');
      expect(await responseValue.text()).toMatch(/^id: 1-0\nevent: /u);
    }
  });
});
