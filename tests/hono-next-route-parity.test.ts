import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const routeInventory = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'config/hono-api-routes.json'),
  'utf8',
)) as {
  exitedRouteIds: string[];
  legacyRouteIds: string[];
  sharedRouteIds: string[];
};

describe('Hono/Next route ownership parity', () => {
  it('legacy 路由必须清零，且 shared/exited 互不重叠', () => {
    // 原来这里钉的是「24 shared / 6 exited」两个字面量。那是迁移进度快照，不是性质：
    // 新增任何一条 shared 路由都会让门禁变红，而那是一次纯增量的正当改动。
    // 真正要守住的是迁移**已经完成**（legacy 清零）以及两侧不重叠。
    expect(routeInventory.legacyRouteIds).toEqual([]);
    const shared = new Set(routeInventory.sharedRouteIds);
    for (const routeId of routeInventory.exitedRouteIds) {
      expect(shared.has(routeId), routeId).toBe(false);
    }
    expect(shared.size).toBe(routeInventory.sharedRouteIds.length);
  });

  it('keeps every exited capability on the apps/web Next POST surface', () => {
    for (const routeId of routeInventory.exitedRouteIds) {
      const routeFile = path.join(repositoryRoot, 'apps/web/app/api', routeId, 'route.ts');
      const source = readFileSync(routeFile, 'utf8');
      expect(source, routeId).toContain("import { appRouteHandler } from './handler';");
      expect(source, routeId).toContain('export const POST = appRouteHandler;');
    }
  });
});
