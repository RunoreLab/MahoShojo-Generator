import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateHonoRouteManifest } from '../scripts/generate-route-manifest.mjs';

const fixtureRoots: string[] = [];

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mahoshojo-hono-routes-'));
  fixtureRoots.push(root);
  await Promise.all([
    mkdir(path.join(root, 'src/adapters/retained'), { recursive: true }),
    mkdir(path.join(root, 'config'), { recursive: true }),
  ]);
  await writeFile(
    path.join(root, 'src/adapters/retained/one.ts'),
    'export const POST = () => {};\n',
  );
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
      methods: { 'retained/one': ['POST'] },
    });

    await generateHonoRouteManifest(root, {
      inventoryFile: path.join(root, 'config/hono-api-routes.json'),
      log: () => {},
    });

    const generated = await readFile(path.join(root, 'src/generated/routes.ts'), 'utf8');
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
      methods: { 'retained/one': ['POST'] },
    });
    const options = {
      inventoryFile: path.join(root, 'config/hono-api-routes.json'),
      log: () => {},
    };
    await expect(generateHonoRouteManifest(root, options))
      .rejects.toThrow('legacyRouteIds 必须为空');

    await writeInventory(root, {
      exitedRouteIds: ['retained/one'],
      legacyRouteIds: [],
      sharedRouteIds: ['retained/one'],
      methods: { 'retained/one': ['POST'] },
    });
    await expect(generateHonoRouteManifest(root, options))
      .rejects.toThrow('不得重复或重叠');

    await writeInventory(root, {
      exitedRouteIds: [],
      legacyRouteIds: [],
    });
    await expect(generateHonoRouteManifest(root, options))
      .rejects.toThrow('必须提供 exitedRouteIds、legacyRouteIds 与 sharedRouteIds 数组');
  });

  it('fails closed when a shared adapter is missing or a routeId can escape ownership', async () => {
    const root = await createFixture();
    const options = {
      inventoryFile: path.join(root, 'config/hono-api-routes.json'),
      log: () => {},
    };

    await writeInventory(root, {
      exitedRouteIds: ['exited/one'],
      legacyRouteIds: [],
      sharedRouteIds: ['retained/no-adapter'],
      methods: { 'retained/no-adapter': ['POST'] },
    });
    await expect(generateHonoRouteManifest(root, options))
      .rejects.toThrow('共享 Hono route adapter 不存在');

    await writeInventory(root, {
      exitedRouteIds: ['exited/one'],
      legacyRouteIds: [],
      sharedRouteIds: ['../outside'],
      methods: { '../outside': ['POST'] },
    });
    await expect(generateHonoRouteManifest(root, options))
      .rejects.toThrow('sharedRouteIds 包含非法 routeId');
  });

  it('fails closed when the canonical route inventory omits or adds methods', async () => {
    const root = await createFixture();
    const options = {
      inventoryFile: path.join(root, 'config/hono-api-routes.json'),
      log: () => {},
    };

    await writeInventory(root, {
      exitedRouteIds: [],
      legacyRouteIds: [],
      sharedRouteIds: ['retained/one'],
      methods: {},
    });
    await expect(generateHonoRouteManifest(root, options))
      .rejects.toThrow('共享 Hono route 缺少 methods：retained/one');

    await writeInventory(root, {
      exitedRouteIds: [],
      legacyRouteIds: [],
      sharedRouteIds: ['retained/one'],
      methods: {
        'retained/one': ['POST'],
        'unknown/route': ['GET'],
      },
    });
    await expect(generateHonoRouteManifest(root, options))
      .rejects.toThrow('methods 包含非 shared route：unknown/route');
  });
});
