import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeDefinitions } from '@/server/generated/routes';

const EXITED_ROUTE_IDS = [
  'arena/generate',
  'arena/generate-stream',
  'arena/session/generate-next',
  'generate-battle-story',
  'generate-magical-girl-details',
  'generate-magical-girl-details-stream',
  'generate-sublimation',
  'generate-sublimation-stream',
  'magic-tavern/generate-choices',
  'magic-tavern/generate-stream',
  'magic-tea-party/generate-choices',
  'magic-tea-party/generate-stream',
  'magic-tea-party/generate-updates',
  'me/battle-reports/[generationId]/regenerate',
] as const;

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
    )) as {
      exitedRouteIds?: string[];
      legacyRouteIds?: string[];
      sharedRouteIds?: string[];
    };
    expect(routeInventory.exitedRouteIds).toEqual(EXITED_ROUTE_IDS);
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

  it('退出 Hono 的 capability 继续保留 Next POST surface', () => {
    for (const routeId of EXITED_ROUTE_IDS) {
      const routeFile = path.join(process.cwd(), 'app', 'api', routeId, 'route.ts');
      const source = readFileSync(routeFile, 'utf8');
      expect(source).toContain("import { appRouteHandler } from './handler';");
      expect(source).toContain('export const POST = appRouteHandler;');
    }
  });

  it('generator 与 route type 不再保留 legacy Next import 回退口', () => {
    const generatorSource = readFileSync(
      path.join(process.cwd(), 'scripts/generate-hono-route-manifest.mjs'),
      'utf8',
    );
    const routeTypeSource = readFileSync(
      path.join(process.cwd(), 'server/routes/types.ts'),
      'utf8',
    );

    expect(generatorSource).toMatch(
      /if \(legacyRouteIds\.length > 0\) \{\s*throw new Error\('Phase 2\.5B 结构退出后 legacyRouteIds 必须为空'\);/u,
    );
    expect(generatorSource).not.toContain('../../app/api/');
    expect(generatorSource).not.toContain("'legacy-next'");
    expect(routeTypeSource).not.toContain("'legacy-next'");
  });
});
