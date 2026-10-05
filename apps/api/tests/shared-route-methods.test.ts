import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHonoApp } from '#/app';
import type { HonoServerConfig } from '#/config';
import { routeDefinitions } from '#/generated/routes';
import type { RedisService } from '#/redis/runtime';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const routeInventory = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'config', 'hono-api-routes.json'),
  'utf8',
)) as { sharedRouteIds: string[] };

const config: HonoServerConfig = {
  arenaMultiplayerEnabled: false,
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: null,
  redisKeyPrefix: '',
  redisRequired: false,
  d1Required: false,
  corsOrigins: ['http://localhost:3000'],
  arenaRoomAllowedOrigins: ['http://localhost:3000'],
  authMode: 'hybrid',
};

const redis: RedisService = {
  connect: async () => undefined,
  close: async () => undefined,
  getStatus: () => ({ configured: false, connected: false, ready: false, lastError: null }),
  ping: async () => false,
  consumeFixedWindow: async () => null,
};

describe('shared route method handling', () => {
  it('all shared POST routes reject GET with the canonical 405 response', async () => {
    const app = createHonoApp(config, redis);
    const sharedRouteIds = new Set(routeInventory.sharedRouteIds);
    const postRoutes = routeDefinitions.filter((route) => (
      sharedRouteIds.has(route.id)
      && route.methods.includes('POST')
      && !route.methods.includes('GET')
      && !route.methods.includes('HEAD')
    ));

    expect(postRoutes.length).toBeGreaterThan(0);
    for (const route of postRoutes) {
      const requestPath = route.pattern.replace(/:[^/]+/gu, 'test-id');
      const response = await app.request(requestPath, { method: 'GET' });

      expect(response.status, route.id).toBe(405);
      expect(response.headers.get('allow')?.split(',').map((method) => method.trim()), route.id)
        .toContain('POST');
      expect(await response.json(), route.id).toEqual({ error: 'Method not allowed' });
    }
  });
});
