import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const generatorPath = resolve(root, 'scripts/generate-arena-room-preset-registry.mjs');
const apiRegistryPath = resolve(root, 'apps/api/src/arena-room/generated/arena-room-preset-registry.ts');
const webCatalogPath = resolve(root, 'apps/web/lib/arena-room/generated/arena-room-preset-catalog.ts');

describe('Arena Room preset registry generation contract', () => {
  it('derives every identity, canonical token and signed payload from the content authority, including legacy files', () => {
    const registry = readFileSync(apiRegistryPath, 'utf8');
    const match = registry.match(/export const GENERATED_ARENA_ROOM_PRESETS = (\[[\s\S]*\]) as const satisfies/u);
    expect(match).not.toBeNull();
    const entries = JSON.parse(match?.[1] ?? 'null') as Array<{
      id: string; kind: string; sourcePath: string; versionToken: string; payload: unknown;
    }>;
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
          .map(([key, child]) => [key, canonicalize(child)]),
      );
      return value;
    };
    const expectedIdentities: string[] = [];
    for (const [directory, kind] of [['presets', 'character'], ['scenario-presets', 'scenario']]) {
      const files = readdirSync(resolve(root, 'content', directory)).sort();
      for (const id of files) {
        const entry = entries.find((candidate) => candidate.id === id && candidate.kind === kind);
        const sourcePath = `content/${directory}/${id}`;
        expect(entry, sourcePath).toBeDefined();
        const payload = JSON.parse(readFileSync(resolve(root, sourcePath), 'utf8'));
        expect(entry?.sourcePath).toBe(sourcePath);
        expect(entry?.payload).toEqual(payload);
        expect(entry?.versionToken).toBe(`sha256:${createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex')}`);
        expectedIdentities.push(`${kind}:${id}`);
      }
    }
    expect(entries.map((entry) => `${entry.kind}:${entry.id}`).sort()).toEqual(expectedIdentities.sort());
    expect(entries.some((entry) => entry.id === 'M01_centaurea_legacy.json')).toBe(true);
    const authority = readFileSync(resolve(root, 'packages/hosted-runtime/src/arena-generation/generated/arena-preset-authority.ts'), 'utf8');
    const authorityMatch = authority.match(/export const ARENA_PRESET_AUTHORITY = (\[[\s\S]*\]) as const satisfies/u);
    expect(JSON.parse(authorityMatch?.[1] ?? 'null')).toEqual(entries.map(({ id, kind, versionToken }) => ({ id, kind, versionToken })));
    const catalog = readFileSync(webCatalogPath, 'utf8');
    const catalogMatch = catalog.match(/export const ARENA_ROOM_PRESET_CATALOG = (\[[\s\S]*\]) as const satisfies/u);
    const metadata = JSON.parse(catalogMatch?.[1] ?? 'null') as Array<{ id: string; kind: string; versionToken: string }>;
    expect(metadata.map(({ id, kind, versionToken }) => ({ id, kind, versionToken })))
      .toEqual(entries.map(({ id, kind, versionToken }) => ({ id, kind, versionToken })));
  });

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
