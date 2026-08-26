import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  adaptRuntimeD1ClientForNodeDataPorts,
  getRuntimeD1Client,
  getRuntimeD1ClientWithoutHttpFallback,
} = vi.hoisted(() => ({
  adaptRuntimeD1ClientForNodeDataPorts: vi.fn((client) => ({ adapted: client })),
  getRuntimeD1Client: vi.fn(),
  getRuntimeD1ClientWithoutHttpFallback: vi.fn(),
}));

vi.mock('@/lib/db/drizzle', () => ({
  getRuntimeD1Client,
  getRuntimeD1ClientWithoutHttpFallback,
}));
vi.mock('@/lib/db/node-data-port-adapter', () => ({
  adaptRuntimeD1ClientForNodeDataPorts,
}));

import {
  cloudflareDrDatabaseProvider,
  getCloudflareDrD1Client,
  getNextHostedD1Client,
} from '@/lib/hosted-dr/database-provider';

describe('Next/OpenNext Hosted DR D1 provider', () => {
  beforeEach(() => {
    getRuntimeD1ClientWithoutHttpFallback.mockReset();
    getRuntimeD1Client.mockReset();
    adaptRuntimeD1ClientForNodeDataPorts.mockClear();
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

  it('production 只接受 binding，非 production 可显式保留旧 HTTP local adapter', () => {
    getRuntimeD1ClientWithoutHttpFallback.mockReturnValue(null);
    getRuntimeD1Client.mockReturnValue({ prepare: vi.fn() });

    expect(getNextHostedD1Client({ executionEnvironment: 'production' })).toBeNull();
    expect(getRuntimeD1Client).not.toHaveBeenCalled();

    expect(getNextHostedD1Client({ executionEnvironment: 'development' })).toEqual({
      adapted: getRuntimeD1Client.mock.results.at(-1)?.value,
    });
    expect(adaptRuntimeD1ClientForNodeDataPorts).toHaveBeenCalledOnce();
  });
});
