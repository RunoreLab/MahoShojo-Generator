import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();

describe('Hosted DR schema baseline gate', () => {
  it('records the real schema sources and keeps the physical D1 probe explicit', () => {
    const configPath = path.join(repositoryRoot, 'config/hosted-dr-schema.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      schemaVersion: number;
      status: string;
      physicalProbe: { status: string; requires: string };
      sources: Array<{ path: string; kind: string }>;
      requiredTables: Array<{ name: string; columns: string[] }>;
    };

    expect(config.schemaVersion).toBe(1);
    expect(config.status).toBe('external-baseline-required');
    expect(config.physicalProbe).toMatchObject({
      status: 'deferred',
      requires: 'isolated-preview-d1',
      activation: 'require-external-evidence',
    });
    expect(config.sources.length).toBeGreaterThanOrEqual(2);
    for (const source of config.sources) {
      expect(existsSync(path.join(repositoryRoot, source.path)), source.path).toBe(true);
    }
    expect(config.requiredTables.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'battle_report_generations',
      'battle_report_generation_combatants',
      'large_objects',
      'arena_ratings',
      'arena_rating_events',
    ]));
  });

  it('在没有物理 D1 证据时只报告可复核的 DEFERRED，而不是伪报 PASS', () => {
    const result = spawnSync(process.execPath, [
      path.join(repositoryRoot, 'scripts/check-hosted-dr-schema.mjs'),
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('physical D1 probe DEFERRED');
  });

  it('把 schema baseline gate 纳入 Hosted DR contract entrypoint', () => {
    const packageJson = JSON.parse(readFileSync(
      path.join(repositoryRoot, 'package.json'),
      'utf8',
    )) as { scripts: Record<string, string> };
    expect(packageJson.scripts['check:hosted-dr:schema']).toBe(
      'node scripts/check-hosted-dr-schema.mjs',
    );
    expect(packageJson.scripts['check:hosted-dr']).toContain('check:hosted-dr:schema');
  });
});
