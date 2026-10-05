import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const generatorPath = resolve(root, 'scripts/generate-arena-room-preset-registry.mjs');
const apiRegistryPath = resolve(root, 'apps/api/src/arena-room/generated/arena-room-preset-registry.ts');
const webCatalogPath = resolve(root, 'apps/web/lib/arena-room/generated/arena-room-preset-catalog.ts');

describe('Arena Room preset registry generation contract', () => {
  it('generates a Web-safe metadata catalog from the same source and rejects duplicate identities', () => {
    expect(existsSync(generatorPath)).toBe(true);
    expect(existsSync(apiRegistryPath)).toBe(true);
    expect(existsSync(webCatalogPath), '缺少 Web-safe preset metadata catalog').toBe(true);

    const generator = readFileSync(generatorPath, 'utf8');
    expect(generator).toContain('arena-room-preset-catalog.ts');
    expect(generator).toContain('new Set');
    expect(generator).toContain('duplicate');
    expect(generator).toContain('process.argv.includes(\'--check\')');

    const catalog = readFileSync(webCatalogPath, 'utf8');
    expect(catalog).not.toMatch(/^\s*payload\s*:/mu);
    expect(catalog).not.toContain('sourcePath');
    const match = catalog.match(/export const ARENA_ROOM_PRESET_CATALOG = (\[[\s\S]*\]) as const satisfies/u);
    expect(match, 'Web catalog must expose a generated literal catalog').not.toBeNull();
    const entries = JSON.parse(match?.[1] ?? 'null') as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThan(0);
    const identities = entries.map((entry) => `${entry.kind}\u0000${entry.id}`);
    expect(new Set(identities).size).toBe(identities.length);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['displayName', 'id', 'kind', 'sourceType', 'versionToken']);
      expect(entry.versionToken).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
  });
});
