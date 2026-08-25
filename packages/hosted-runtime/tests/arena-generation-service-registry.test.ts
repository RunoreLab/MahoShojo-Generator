import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureArenaGenerationService,
  registeredArenaGenerationService,
} from '../src/arena-generation/service-registry';

afterEach(() => configureArenaGenerationService(null));

describe('Arena generation service registry', () => {
  it('fails closed until the runtime adapter configures a service', async () => {
    await expect(registeredArenaGenerationService.create(
      new Request('https://example.test'),
    )).resolves.toMatchObject({ status: 503 });
  });

  it('delegates every route to one configured business service', async () => {
    const response = new Response('ok');
    const create = vi.fn(async () => response);
    configureArenaGenerationService({
      create,
      cancelRequest: vi.fn(async () => response),
      resume: vi.fn(async () => response),
      status: vi.fn(async () => response),
      cancel: vi.fn(async () => response),
    });
    await expect(registeredArenaGenerationService.create(
      new Request('https://example.test'),
    )).resolves.toBe(response);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
