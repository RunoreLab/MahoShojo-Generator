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
  it('keeps the accepted 24 shared / 6 exited / 0 legacy inventory', () => {
    expect(routeInventory.sharedRouteIds).toHaveLength(24);
    expect(routeInventory.exitedRouteIds).toHaveLength(6);
    expect(routeInventory.legacyRouteIds).toEqual([]);
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
