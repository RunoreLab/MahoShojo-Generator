import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeDefinitions } from '#/generated/routes';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const REPOSITORY_ROOT = path.resolve(APP_ROOT, '..', '..');

const EXITED_ROUTE_IDS = [
  'magic-tavern/generate-choices',
  'magic-tavern/generate-stream',
  'magic-tea-party/generate-choices',
  'magic-tea-party/generate-stream',
  'magic-tea-party/generate-updates',
  'me/battle-reports/[generationId]/regenerate',
] as const;

describe('Hono route manifest', () => {
  it('只挂载已经脱离 legacy Next import 的二十四条 shared capability', () => {
    expect(routeDefinitions.map((route) => route.id).sort()).toEqual([
      'arena/generate',
      'arena/generate-stream',
      'arena/generation-requests/[generationRequestId]',
      'arena/generations/[generationId]',
      'arena/generations/[generationId]/cancel',
      'arena/generations/[generationId]/stream',
      'arena/repair-combatant-meta',
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
      'hosted/dr-readiness',
    ]);
    expect(routeDefinitions).toHaveLength(24);
    expect(routeDefinitions.some((route) => route.pattern === '/api/auth/*')).toBe(false);
    expect(routeDefinitions.some((route) => route.pattern.startsWith('/api/pvp/'))).toBe(false);
    expect(routeDefinitions.find((route) => route.id === 'generate-free')?.methods).toEqual(['POST']);
    expect(routeDefinitions.find((route) => route.id === 'hosted/dr-readiness')?.methods).toEqual(['GET', 'HEAD']);
  });

  it('把常规生成 shared service 路由从 legacy Next 动态导入中移除', async () => {
    const sharedDefinitions = routeDefinitions.filter((route) => route.adapter === 'shared-service');
    expect(sharedDefinitions.map((route) => route.id).sort()).toEqual([
      'arena/generate',
      'arena/generate-stream',
      'arena/generation-requests/[generationRequestId]',
      'arena/generations/[generationId]',
      'arena/generations/[generationId]/cancel',
      'arena/generations/[generationId]/stream',
      'arena/repair-combatant-meta',
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
      'hosted/dr-readiness',
    ]);
    const routeInventory = JSON.parse(readFileSync(
      path.join(REPOSITORY_ROOT, 'config/hono-api-routes.json'),
      'utf8',
    )) as {
      exitedRouteIds?: string[];
      legacyRouteIds?: string[];
      sharedRouteIds?: string[];
      methods?: Record<string, string[]>;
    };
    expect(routeInventory.exitedRouteIds).toEqual(EXITED_ROUTE_IDS);
    expect(routeInventory.legacyRouteIds).toEqual([]);
    expect(routeInventory.sharedRouteIds?.length).toBe(24);
    for (const definition of sharedDefinitions) {
      expect(definition.methods).toEqual(routeInventory.methods?.[definition.id]);
      const routeModule = await definition.load();
      expect(routeModule.POST ?? routeModule.GET).toEqual(expect.any(Function));
    }

    const generatedSource = readFileSync(
      path.join(APP_ROOT, 'src/generated/routes.ts'),
      'utf8',
    );
    for (const routeId of sharedDefinitions.map((definition) => definition.id)) {
      expect(generatedSource).toContain(`import("../adapters/${routeId}")`);
      expect(generatedSource).not.toContain(`app/api/${routeId}/route`);
    }
    /**
     * 本条要 `await definition.load()` 把 24 条 shared 路由的模块图**真的加载一遍**，
     * 这是它比其他用例贵一个量级的原因（其余两条都在 10ms 以内）。实测：
     *
     * | 场景 | 耗时 |
     * | --- | --- |
     * | 单独跑本文件 | 2,862ms |
     * | 54 文件全量、worker=15 | 12,964ms |
     *
     * 4.5 倍差距来自同一台机器上的并发争抢，不是本条自身有 13 秒的活。因此它不能只吃
     * 套件级的 15s——那只有 1.16 倍余量，在比本机慢的 CI 上就是定时炸弹。
     *
     * 30s ≈ 已实测最差 12.96s 的 2.3 倍，给慢机器留够余量，同时仍然远小于无限等待：
     * 真的挂起时 30s 判红。**放宽的是预算不是断言**——「24 条路由都真的加载成功并导出
     * handler」这条性质一条没动。
     */
  }, 30_000);

  it('generator 与 route type 不再保留 legacy Next import 回退口', () => {
    const generatorSource = readFileSync(
      path.join(APP_ROOT, 'scripts/generate-route-manifest.mjs'),
      'utf8',
    );
    const routeTypeSource = readFileSync(
      path.join(APP_ROOT, 'src/routes/types.ts'),
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
