import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const webRoot = process.cwd();
const workspaceRoot = join(webRoot, '..', '..');
const ignoredGeneratedDirectories = new Set([
  '.next',
  '.open-next',
  '.turbo',
  '.wrangler',
  'coverage',
  'dist',
  'node_modules',
]);

const listFiles = (directory: string, accepts: (path: string) => boolean): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return ignoredGeneratedDirectories.has(entry) ? [] : listFiles(path, accepts);
    }
    return accepts(path) ? [path] : [];
  });
};

const listSourceFiles = (directory: string): string[] => (
  listFiles(directory, (path) => /\.[cm]?[jt]sx?$/u.test(path))
);

const serverSourceRoots = [
  join(webRoot, 'app'),
  join(webRoot, 'components'),
  join(webRoot, 'lib'),
  join(workspaceRoot, 'apps', 'api', 'src'),
  join(workspaceRoot, 'packages', 'hosted-api', 'src'),
  join(workspaceRoot, 'packages', 'hosted-runtime', 'src'),
];

const serverSourceFiles = (): string[] => serverSourceRoots.flatMap(listSourceFiles);

const normalizeSqlLikeSource = (source: string): string => (
  source.replace(/["'`\[\]]/gu, '').replace(/\s+/gu, ' ')
);

describe('legacy Arena stats retirement boundary', () => {
  it('removes the public route and feature-only modules', () => {
    const retiredPaths = [
      'app/api/get-stats/handler.ts',
      'app/api/get-stats/route.ts',
      'components/Leaderboard.tsx',
      'components/arena/components/ArenaStatistics.tsx',
      'lib/database/arena.ts',
      'lib/db/repositories/arena-legacy-stats.ts',
    ];

    expect(retiredPaths.filter((path) => existsSync(join(webRoot, path)))).toEqual([]);
  });

  it('removes every active config, UI, fetch and writer reference', () => {
    const retiredTokens = [
      'SHOW_STAT_DATA',
      'LEADERBOARD_MODE',
      '/api/get-stats',
      'useStatsQuery',
      'ArenaStatistics',
      'updateBattleStats',
      'recordBattleStats',
      'arena-legacy-stats',
      "from './arena'",
    ];
    const violations = serverSourceFiles().flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return retiredTokens
        .filter((token) => source.includes(token))
        .map((token) => `${relative(workspaceRoot, file)}:${token}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps retired tables read-only across every server runtime', () => {
    const sqlWriter = /\b(?:insert\s+(?:or\s+\w+\s+)?into|replace\s+into|update|delete\s+from)\s+(?:main\.)?(characters|battles)\b/giu;
    const drizzleWriter = /\.\s*(?:insert|update|delete)\s*\(\s*(characters|battles)\s*\)/giu;
    const violations = serverSourceFiles().flatMap((file) => {
      const source = normalizeSqlLikeSource(readFileSync(file, 'utf8'));
      const matches = [...source.matchAll(sqlWriter), ...source.matchAll(drizzleWriter)];
      return matches.map((match) => `${relative(workspaceRoot, file)}:${match[0]}`);
    });

    expect(violations).toEqual([]);
  });

  it('forbids destructive migrations against retained historical tables', () => {
    const sqlRoots = [
      join(workspaceRoot, 'drizzle'),
      join(workspaceRoot, 'apps'),
      join(workspaceRoot, 'packages'),
    ];
    const sqlFiles = sqlRoots.flatMap((root) => listFiles(root, (path) => path.endsWith('.sql')));
    const destructiveSql = /\b(?:drop\s+table(?:\s+if\s+exists)?|delete\s+from|truncate(?:\s+table)?)\s+(?:main\.)?(characters|battles)\b/giu;
    const violations = sqlFiles.flatMap((file) => {
      const source = normalizeSqlLikeSource(readFileSync(file, 'utf8'));
      return [...source.matchAll(destructiveSql)]
        .map((match) => `${relative(workspaceRoot, file)}:${match[0]}`);
    });

    expect(violations).toEqual([]);
  });

  it('preserves historical tables and the current rating/ranking implementation', () => {
    const legacySqlSchema = readFileSync(join(webRoot, 'lib/database/schema.sql'), 'utf8');
    const drizzleSchema = readFileSync(join(webRoot, 'lib/db/schema/business.ts'), 'utf8');

    expect(legacySqlSchema).toMatch(/CREATE TABLE IF NOT EXISTS characters/u);
    expect(legacySqlSchema).toMatch(/CREATE TABLE IF NOT EXISTS battles/u);
    expect(drizzleSchema).toContain("sqliteTable('characters'");
    expect(drizzleSchema).toContain("sqliteTable('battles'");

    expect(existsSync(join(webRoot, 'app/api/arena/leaderboard/route.ts'))).toBe(true);
    expect(existsSync(join(webRoot, 'components/arena/components/ArenaRankingModal.tsx'))).toBe(true);
    expect(existsSync(join(webRoot, 'lib/database/arena-ratings.ts'))).toBe(true);
  });
});
