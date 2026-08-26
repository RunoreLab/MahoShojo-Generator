import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const webRoot = process.cwd();
const workspaceRoot = join(webRoot, '..', '..');

const listSourceFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.[cm]?[jt]sx?$/u.test(path) ? [path] : [];
  });
};

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
    const sourceFiles = [
      ...listSourceFiles(join(webRoot, 'app')),
      ...listSourceFiles(join(webRoot, 'components')),
      ...listSourceFiles(join(webRoot, 'lib')),
      ...listSourceFiles(join(workspaceRoot, 'packages', 'hosted-runtime', 'src')),
    ];
    const violations = sourceFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return retiredTokens
        .filter((token) => source.includes(token))
        .map((token) => `${relative(workspaceRoot, file)}:${token}`);
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
