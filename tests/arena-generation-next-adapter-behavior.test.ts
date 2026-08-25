import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  create: vi.fn(),
  cancelRequest: vi.fn(),
  resume: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/app/api/arena/generation-runtime', () => ({
  getCloudflareDrArenaGenerationService: () => mocked,
}));

import { appRouteHandler as create } from '@/app/api/arena/generate-stream/handler';
import { appRouteHandler as cancel } from '@/app/api/arena/generations/[generationId]/cancel/handler';
import { appRouteHandler as status } from '@/app/api/arena/generations/[generationId]/handler';
import { appRouteHandler as resume } from '@/app/api/arena/generations/[generationId]/stream/handler';

const response = (event: string): Response => new Response(
  `id: 7-0\nevent: ${event}\ndata: {"ok":true}\n\n`,
  {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Mahoshojo-Generation-Id': 'generation-1',
      'X-Mahoshojo-Generation-Request-Id': 'request-1',
    },
  },
);

describe('Next/OpenNext Arena generation adapter behavior', () => {
  beforeEach(() => {
    mocked.create.mockResolvedValue(response('create'));
    mocked.cancelRequest.mockResolvedValue(response('cancel-request'));
    mocked.resume.mockResolvedValue(response('resume'));
    mocked.status.mockResolvedValue(response('status'));
    mocked.cancel.mockResolvedValue(response('cancel'));
  });

  it('preserves method, route params, SSE ids, and generation headers', async () => {
    const context = { params: Promise.resolve({ generationId: 'generation-1' }) };
    const responses = await Promise.all([
      create(new Request('https://example.test/api/arena/generate-stream', { method: 'POST' })),
      create(new Request('https://example.test/api/arena/generate-stream', { method: 'DELETE' })),
      resume(new Request('https://example.test/stream'), context),
      status(new Request('https://example.test/status'), context),
      cancel(new Request('https://example.test/cancel', { method: 'POST' }), context),
    ]);

    expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }));
    expect(mocked.cancelRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'DELETE' }));
    expect(mocked.resume).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
    expect(mocked.status).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
    expect(mocked.cancel).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
    for (const result of responses) {
      expect(result.headers.get('content-type')).toContain('text/event-stream');
      expect(result.headers.get('x-mahoshojo-generation-id')).toBe('generation-1');
      expect(result.headers.get('x-mahoshojo-generation-request-id')).toBe('request-1');
      expect(await result.text()).toMatch(/^id: 7-0\nevent: /u);
    }
  });

  it('rejects unsupported create methods without touching the shared service', async () => {
    const result = await create(new Request(
      'https://example.test/api/arena/generate-stream',
      { method: 'PATCH' },
    ));

    expect(result.status).toBe(405);
    expect(result.headers.get('allow')).toBe('POST, DELETE');
    expect(await result.json()).toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
    expect(mocked.create).not.toHaveBeenCalled();
    expect(mocked.cancelRequest).not.toHaveBeenCalled();
  });
});
