import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeDefinitions } from '@/server/generated/routes';

describe('Hono route manifest', () => {
  it('挂载全部生成类 API 白名单且不扩大路由面', () => {
    expect(routeDefinitions.map((route) => route.id).sort()).toEqual([
      'arena/generate',
      'arena/generate-stream',
      'arena/session/generate-next',
      'creator/generate',
      'creator/generate-stream',
      'generate-battle-story',
      'generate-canshou',
      'generate-canshou-stream',
      'generate-free',
      'generate-free-stream',
      'generate-game-card',
      'generate-magical-girl',
      'generate-magical-girl-details',
      'generate-magical-girl-details-stream',
      'generate-scenario',
      'generate-scenario-stream',
      'generate-sublimation',
      'generate-sublimation-stream',
      'magic-tavern/generate-choices',
      'magic-tavern/generate-stream',
      'magic-tea-party/generate-choices',
      'magic-tea-party/generate-stream',
      'magic-tea-party/generate-updates',
      'me/battle-reports/[generationId]/regenerate',
    ]);
    expect(routeDefinitions).toHaveLength(24);
    expect(routeDefinitions.some((route) => route.pattern === '/api/auth/*')).toBe(false);
    expect(routeDefinitions.some((route) => route.pattern.startsWith('/api/pvp/'))).toBe(false);
  });

  it('把首条共享 service 路由从 legacy Next 动态导入中移除', async () => {
    const sharedDefinitions = routeDefinitions.filter((route) => route.adapter === 'shared-service');
    expect(sharedDefinitions.map((route) => route.id)).toEqual(['generate-magical-girl']);
    expect(routeDefinitions.filter((route) => route.adapter === 'legacy-next')).toHaveLength(23);

    const routeModule = await sharedDefinitions[0]?.load();
    expect(Object.keys(routeModule ?? {}).sort()).toEqual([
      'DELETE',
      'GET',
      'HEAD',
      'OPTIONS',
      'PATCH',
      'POST',
      'PUT',
    ]);

    const generatedSource = readFileSync(
      path.join(process.cwd(), 'server/generated/routes.ts'),
      'utf8',
    );
    expect(generatedSource).toContain('import("../adapters/generate-magical-girl")');
    expect(generatedSource).not.toContain('app/api/generate-magical-girl/route');
  });
});
