import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDefaultNodeD1Client } = vi.hoisted(() => ({
  getDefaultNodeD1Client: vi.fn(),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/d1-client', () => ({
  getDefaultNodeD1Client,
}));

import {
  getHonoPrimaryD1Client,
  honoPrimaryDatabaseProvider,
} from '#/d1/provider';

describe('Hono D1 provider composition', () => {
  beforeEach(() => {
    getDefaultNodeD1Client.mockReset();
  });

  it('从统一 primary provider 暴露现有 Node D1 client', () => {
    const client = { prepare: vi.fn() };
    getDefaultNodeD1Client.mockReturnValue(client);

    expect(honoPrimaryDatabaseProvider.id).toBe('hono-d1-primary');
    expect(getHonoPrimaryD1Client()).toBe(client);
    expect(getDefaultNodeD1Client).toHaveBeenCalledTimes(1);
  });

  it('client 缺失时返回 null', () => {
    getDefaultNodeD1Client.mockReturnValue(null);
    expect(getHonoPrimaryD1Client()).toBeNull();
  });
});
