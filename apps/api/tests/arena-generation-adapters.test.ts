import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureArenaGenerationService } from '@mahoshojo/hosted-runtime/arena-generation';
import { POST as create } from '../src/adapters/arena/generate-stream';
import { POST as cancel } from '../src/adapters/arena/generations/[generationId]/cancel';
import { GET as status } from '../src/adapters/arena/generations/[generationId]';
import { GET as resume } from '../src/adapters/arena/generations/[generationId]/stream';

afterEach(() => configureArenaGenerationService(null));

const context = { params: Promise.resolve({ generationId: 'generation-1' }) };

describe('Hono Arena generation adapters', () => {
  it('delegate create/resume/status/cancel to the same registered service', async () => {
    const response = () => new Response('ok');
    const service = {
      create: vi.fn(async () => response()),
      resume: vi.fn(async () => response()),
      status: vi.fn(async () => response()),
      cancel: vi.fn(async () => response()),
    };
    configureArenaGenerationService(service);

    await create(new Request('https://example.test', { method: 'POST' }));
    await resume(new Request('https://example.test'), context);
    await status(new Request('https://example.test'), context);
    await cancel(new Request('https://example.test', { method: 'POST' }), context);

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.resume).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
    expect(service.status).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
    expect(service.cancel).toHaveBeenCalledWith(expect.any(Request), { generationId: 'generation-1' });
  });
});
