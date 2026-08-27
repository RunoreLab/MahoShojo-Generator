import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHonoApp } from '#/app';
import type { HonoServerConfig } from '#/config';
import type { RedisService } from '#/redis/runtime';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const contracts = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'config', 'user-visible-contracts.json'),
  'utf8',
)) as { sharedWithDefaultRouteIds: string[] };

const config: HonoServerConfig = {
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: null,
  redisKeyPrefix: '',
  redisRequired: false,
  d1Required: false,
  corsOrigins: ['http://localhost:3000'],
  authMode: 'hybrid',
};

const redis: RedisService = {
  connect: async () => undefined,
  close: async () => undefined,
  getStatus: () => ({ configured: false, connected: false, ready: false, lastError: null }),
  ping: async () => false,
  consumeFixedWindow: async () => null,
};

describe('Phase 2.5 user-visible shared API differential contract', () => {
  it('all default-vs-refactor shared routes preserve the default 405 body', async () => {
    const app = createHonoApp(config, redis);

    for (const routeId of contracts.sharedWithDefaultRouteIds) {
      const response = await app.request(`/api/${routeId}`, { method: 'GET' });

      expect(response.status, routeId).toBe(405);
      expect(response.headers.get('allow')?.split(',').map((method) => method.trim()), routeId)
        .toContain('POST');
      expect(await response.json(), routeId).toEqual({ error: 'Method not allowed' });
    }
  });
});
