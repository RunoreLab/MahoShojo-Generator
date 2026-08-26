import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getRuntimeD1ClientWithoutHttpFallback } = vi.hoisted(() => ({
  getRuntimeD1ClientWithoutHttpFallback: vi.fn(),
}));

vi.mock('@/lib/db/drizzle', () => ({
  getRuntimeD1ClientWithoutHttpFallback,
}));

import {
  cloudflareDrDatabaseProvider,
  getCloudflareDrD1Client,
} from '@/lib/hosted-dr/database-provider';

describe('Next/OpenNext Hosted DR D1 provider', () => {
  beforeEach(() => {
    getRuntimeD1ClientWithoutHttpFallback.mockReset();
  });

  it('只使用 native binding + Sessions，不读取 HTTP fallback', () => {
    const sessionClient = {
      getBookmark: vi.fn(() => null),
      prepare: vi.fn(),
    };
    const binding = {
      withSession: vi.fn(() => sessionClient),
    };
    getRuntimeD1ClientWithoutHttpFallback.mockReturnValue(binding);

    expect(cloudflareDrDatabaseProvider.id).toBe('cloudflare-d1-binding');
    expect(getCloudflareDrD1Client()).not.toBeNull();
    expect(binding.withSession).toHaveBeenCalledWith('first-primary');
    expect(getRuntimeD1ClientWithoutHttpFallback).toHaveBeenCalledTimes(1);
  });

  it('binding 或 Sessions 缺失时 fail closed', () => {
    getRuntimeD1ClientWithoutHttpFallback.mockReturnValue(null);
    expect(getCloudflareDrD1Client()).toBeNull();

    getRuntimeD1ClientWithoutHttpFallback.mockReturnValue({ prepare: vi.fn() });
    expect(getCloudflareDrD1Client()).toBeNull();
  });
});
