import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
const runtime = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('@/lib/db/drizzle', () => ({ getDrizzleDbFromRuntime: runtime.getDb }));
import { isUserInPvpMatch } from '@/lib/database/legacy-pvp-access';

describe('retired Card Duel report authorization', () => {
  afterEach(() => vi.restoreAllMocks());
  it('checks both historical match and user without writing data', async () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec("CREATE TABLE pvp_match_players (match_id TEXT, user_id INTEGER); INSERT INTO pvp_match_players VALUES ('match-1', 42), ('match-2', 7);");
      const queries: string[] = [];
      runtime.getDb.mockReturnValue(drizzle(sqlite, { logger: { logQuery: (query) => queries.push(query) } }));
      await expect(isUserInPvpMatch('match-1', 42)).resolves.toBe(true);
      await expect(isUserInPvpMatch('match-1', 7)).resolves.toBe(false);
      await expect(isUserInPvpMatch('missing', 42)).resolves.toBe(false);
      expect(queries).toHaveLength(3);
      expect(queries.every((query) => query.startsWith('select '))).toBe(true);
    } finally { sqlite.close(); }
  });
  it('fails closed when storage is missing or unavailable', async () => {
    runtime.getDb.mockReturnValueOnce(null).mockImplementationOnce(() => { throw new Error('unavailable'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(isUserInPvpMatch('match-1', 42)).resolves.toBe(false);
    await expect(isUserInPvpMatch('match-1', 42)).resolves.toBe(false);
  });
});
