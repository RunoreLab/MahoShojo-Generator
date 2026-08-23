import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeDefinitions } from '@/server/generated/routes';

describe('Hono route manifest', () => {
  it('只挂载已经脱离 legacy Next import 的十条 shared capability', () => {
    expect(routeDefinitions.map((route) => route.id).sort()).toEqual([
      'creator/generate',
      'creator/generate-stream',
      'generate-canshou',
      'generate-canshou-stream',
      'generate-free',
      'generate-free-stream',
      'generate-game-card',
      'generate-magical-girl',
      'generate-scenario',
      'generate-scenario-stream',
    ]);
    expect(routeDefinitions).toHaveLength(10);
    expect(routeDefinitions.some((route) => route.pattern === '/api/auth/*')).toBe(false);
    expect(routeDefinitions.some((route) => route.pattern.startsWith('/api/pvp/'))).toBe(false);
  });

  it('把常规生成 shared service 路由从 legacy Next 动态导入中移除', async () => {
    const sharedDefinitions = routeDefinitions.filter((route) => route.adapter === 'shared-service');
    expect(sharedDefinitions.map((route) => route.id).sort()).toEqual([
      'creator/generate',
      'creator/generate-stream',
      'generate-canshou',
      'generate-canshou-stream',
      'generate-free',
      'generate-free-stream',
      'generate-game-card',
      'generate-magical-girl',
      'generate-scenario',
      'generate-scenario-stream',
    ]);
    expect(routeDefinitions.filter((route) => route.adapter === 'legacy-next')).toHaveLength(0);

    const routeInventory = JSON.parse(readFileSync(
      path.join(process.cwd(), 'config/hono-api-routes.json'),
      'utf8',
    )) as { legacyRouteIds?: string[]; sharedRouteIds?: string[] };
    expect(routeInventory.legacyRouteIds).toEqual([]);
    expect(routeInventory.sharedRouteIds?.length).toBe(10);

    for (const definition of sharedDefinitions) {
      const routeModule = await definition.load();
      expect(routeModule.POST).toEqual(expect.any(Function));
    }

    const generatedSource = readFileSync(
      path.join(process.cwd(), 'server/generated/routes.ts'),
      'utf8',
    );
    for (const routeId of sharedDefinitions.map((definition) => definition.id)) {
      expect(generatedSource).toContain(`import("../adapters/${routeId}")`);
      expect(generatedSource).not.toContain(`app/api/${routeId}/route`);
    }
  });
});
