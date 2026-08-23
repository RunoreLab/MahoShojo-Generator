import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateHonoRouteManifest } from '../../scripts/generate-hono-route-manifest.mjs';

const fixtureRoots: string[] = [];

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mahoshojo-hono-routes-'));
  fixtureRoots.push(root);
  await Promise.all([
    mkdir(path.join(root, 'app/api/retained/one'), { recursive: true }),
    mkdir(path.join(root, 'app/api/exited/one'), { recursive: true }),
    mkdir(path.join(root, 'app/api/retained/no-adapter'), { recursive: true }),
    mkdir(path.join(root, 'server/adapters/retained'), { recursive: true }),
    mkdir(path.join(root, 'config'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, 'app/api/retained/one/route.ts'), 'export const POST = () => {};\n'),
    writeFile(path.join(root, 'app/api/exited/one/route.ts'), 'export const POST = () => {};\n'),
    writeFile(path.join(root, 'app/api/retained/no-adapter/route.ts'), 'export const POST = () => {};\n'),
    writeFile(path.join(root, 'server/adapters/retained/one.ts'), 'export const POST = () => {};\n'),
  ]);
  return root;
}

async function writeInventory(root: string, payload: unknown): Promise<void> {
  await writeFile(
    path.join(root, 'config/hono-api-routes.json'),
    `${JSON.stringify(payload)}\n`,
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Hono route manifest generator', () => {
  it('generates only shared adapters for a valid retained/exited inventory', async () => {
    const root = await createFixture();
    await writeInventory(root, {
      exitedRouteIds: ['exited/one'],
      legacyRouteIds: [],
      sharedRouteIds: ['retained/one'],
    });

    await generateHonoRouteManifest(root, { log: () => {} });

    const generated = await readFile(path.join(root, 'server/generated/routes.ts'), 'utf8');
    expect(generated).toContain('import("../adapters/retained/one")');
    expect(generated).not.toContain('app/api');
    expect(generated).not.toContain('legacy-next');
  });

  it('fails closed for non-empty legacy, overlapping, and incomplete inventories', async () => {
    const root = await createFixture();

    await writeInventory(root, {
      exitedRouteIds: ['exited/one'],
      legacyRouteIds: ['legacy/one'],
      sharedRouteIds: ['retained/one'],
    });
    await expect(generateHonoRouteManifest(root, { log: () => {} }))
      .rejects.toThrow('legacyRouteIds 必须为空');

    await writeInventory(root, {
      exitedRouteIds: ['retained/one'],
      legacyRouteIds: [],
      sharedRouteIds: ['retained/one'],
    });
    await expect(generateHonoRouteManifest(root, { log: () => {} }))
      .rejects.toThrow('不得重复或重叠');

    await writeInventory(root, {
      exitedRouteIds: [],
      legacyRouteIds: [],
    });
    await expect(generateHonoRouteManifest(root, { log: () => {} }))
      .rejects.toThrow('必须提供 exitedRouteIds、legacyRouteIds 与 sharedRouteIds 数组');
  });

  it('fails closed when an inventory route or shared adapter is missing', async () => {
    const root = await createFixture();

    await writeInventory(root, {
      exitedRouteIds: ['exited/missing'],
      legacyRouteIds: [],
      sharedRouteIds: ['retained/one'],
    });
    await expect(generateHonoRouteManifest(root, { log: () => {} }))
      .rejects.toThrow('包含不存在的 routeId：exited/missing');

    await writeInventory(root, {
      exitedRouteIds: ['exited/one'],
      legacyRouteIds: [],
      sharedRouteIds: ['retained/no-adapter'],
    });
    await expect(generateHonoRouteManifest(root, { log: () => {} }))
      .rejects.toThrow('共享 Hono route adapter 不存在');
  });
});
