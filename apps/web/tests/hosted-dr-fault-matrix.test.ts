import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import { withNextDrCapability } from '@/lib/hosted-dr/capability-guard';

const readyProvider: DatabaseProvider = {
  id: 'cloudflare-d1-binding',
  openSession: ({ consistency }) => ({
    consistency,
    initialBookmark: null,
    getBookmark: () => null,
    client: { prepare: vi.fn() },
  }),
};

const baseOptions = {
  executionEnvironment: 'production',
  environment: {
    HONO_CORS_ORIGINS: 'https://app.example.test',
  } as Record<string, string | undefined>,
  provider: readyProvider,
  logUnavailable: vi.fn(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('G25E-2 Hosted DR fault matrix: Next safety gates', () => {
  it('G25E2-DR-SECRET-MISSING：缺 required secret 时在 handler 前固定 503', async () => {
    const handler = vi.fn(async () => new Response('must-not-run'));
    const guarded = withNextDrCapability('creator/generate', handler, baseOptions);

    const response = await guarded(new Request(
      'https://dr.test/api/creator/generate',
      { method: 'POST' },
    ));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
      error: 'Hosted DR capability unavailable',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(baseOptions.logUnavailable.mock.calls)).not.toContain('secret-value-canary');
  });

  it('G25E2-D1-UNAVAILABLE：Cloudflare binding/session 不可用时不 fallback 到 handler 或 Hono Gateway', async () => {
    const handler = vi.fn(async () => new Response('must-not-run'));
    const guarded = withNextDrCapability('generate-free', handler, {
      ...baseOptions,
      provider: {
        id: 'cloudflare-d1-binding',
        openSession: () => null,
      },
    });

    const response = await guarded(new Request(
      'https://dr.test/api/generate-free',
      { method: 'POST' },
    ));

    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(baseOptions.logUnavailable).toHaveBeenCalledWith({
      capabilityId: 'generate-free',
      category: 'database-provider',
    });
  });
});
