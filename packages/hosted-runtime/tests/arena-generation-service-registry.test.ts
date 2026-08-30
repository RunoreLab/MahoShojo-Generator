import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureArenaGenerationService,
  registeredArenaGenerationService,
} from '../src/arena-generation/service-registry';

afterEach(() => configureArenaGenerationService(null));

describe('Arena generation service registry', () => {
  it('fails closed until the runtime adapter configures a service', async () => {
    await expect(registeredArenaGenerationService.createSubscription(
      new Request('https://example.test'),
    )).resolves.toMatchObject({ status: 503 });
    await expect(registeredArenaGenerationService.create(
      new Request('https://example.test'),
    )).resolves.toMatchObject({ status: 503 });
  });

  it('delegates every route to one configured business service', async () => {
    const response = new Response('ok');
    const createSubscription = vi.fn(async () => response);
    const create = vi.fn(async () => response);
    const lookup = vi.fn(async () => response);
    configureArenaGenerationService({
      createSubscription,
      create,
      cancelRequest: vi.fn(async () => response),
      lookup,
      resume: vi.fn(async () => response),
      status: vi.fn(async () => response),
      cancel: vi.fn(async () => response),
    });
    await expect(registeredArenaGenerationService.createSubscription(
      new Request('https://example.test'),
    )).resolves.toBe(response);
    expect(createSubscription).toHaveBeenCalledTimes(1);
    await expect(registeredArenaGenerationService.create(
      new Request('https://example.test'),
    )).resolves.toBe(response);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(registeredArenaGenerationService.lookup(
      new Request('https://example.test'),
      { generationRequestId: 'request-1' },
    )).resolves.toBe(response);
    expect(lookup).toHaveBeenCalledWith(expect.any(Request), {
      generationRequestId: 'request-1',
    });
  });
});
