import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCloudflareContext, createHttpD1ClientFromEnv, httpClient } = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  createHttpD1ClientFromEnv: vi.fn(),
  httpClient: {
    prepare: vi.fn(),
    batch: vi.fn(),
    exec: vi.fn(),
  },
}));

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext }));
vi.mock('@/lib/db/d1-http-client', () => ({ createHttpD1ClientFromEnv }));

import { getRuntimeD1Client } from '@/lib/db/drizzle';

describe('Next runtime D1 authority policy', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    getCloudflareContext.mockReset();
    createHttpD1ClientFromEnv.mockReset();
    getCloudflareContext.mockImplementation(() => {
      throw new Error('binding unavailable');
    });
    createHttpD1ClientFromEnv.mockReturnValue(httpClient);
    delete (globalThis as { __MAHOSHOJO_D1__?: unknown }).__MAHOSHOJO_D1__;
  });

  it.each(['production', 'preview'])(
    '%s target 无 binding 时不读取 HTTP Gateway/management fallback',
    (deploymentTarget) => {
      vi.stubEnv('NEXT_PUBLIC_HOSTED_API_ENVIRONMENT', deploymentTarget);

      expect(getRuntimeD1Client()).toBeNull();
      expect(createHttpD1ClientFromEnv).not.toHaveBeenCalled();
    },
  );

  it.each(['local', 'test'])(
    '%s target 可显式使用 local HTTP adapter',
    (deploymentTarget) => {
      vi.stubEnv('NEXT_PUBLIC_HOSTED_API_ENVIRONMENT', deploymentTarget);

      expect(getRuntimeD1Client()).toBe(httpClient);
      expect(createHttpD1ClientFromEnv).toHaveBeenCalledOnce();
    },
  );

  it('缺失或未知 target 时 fail closed', () => {
    vi.stubEnv('NEXT_PUBLIC_HOSTED_API_ENVIRONMENT', '');
    expect(getRuntimeD1Client()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_HOSTED_API_ENVIRONMENT', 'staging');
    expect(getRuntimeD1Client()).toBeNull();
    expect(createHttpD1ClientFromEnv).not.toHaveBeenCalled();
  });
});
