import { afterEach, describe, expect, test, vi } from 'vitest';

describe('worker-safe logger', () => {
  afterEach(() => {
    vi.doUnmock('pino');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  test('does not require pino when imported', async () => {
    vi.doMock('pino', () => {
      throw new Error('pino should not be imported by the worker-safe logger');
    });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { getLogger, log } = await import('@/lib/logger');

    getLogger('cloudflare-page').info('rendered', { route: '/battle' });
    log.warn('diagnostic warning');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
