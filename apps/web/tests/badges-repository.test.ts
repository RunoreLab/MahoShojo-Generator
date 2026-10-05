import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { insertUserBadgeIgnore, runBadgeOpsTransaction } from '@/lib/db/repositories/badges';
import * as schema from '@/lib/db/schema';

let sqlite: Database | null = null;

describe('badges repository', () => {
  beforeEach(() => {
    sqlite = null;
  });

  afterEach(() => {
    sqlite?.close();
  });

  test('runBadgeOpsTransaction: 直接复用当前 db，不触发 drizzle transaction', async () => {
    let transactionCalled = false;
    const db = {
      transaction: async () => {
        transactionCalled = true;
        throw new Error('不应调用 drizzle transaction');
      },
      marker: 'db',
    } as unknown as AppDrizzleDb;

    let receivedDb: AppDrizzleDb | null = null;
    await runBadgeOpsTransaction(db, async (tx) => {
      receivedDb = tx;
    });

    expect(transactionCalled).toBe(false);
    expect(receivedDb).toBe(db);
  });

  test('insertUserBadgeIgnore: 只在本次实际插入时返回 true', async () => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE user_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        badge_id TEXT NOT NULL,
        is_equipped INTEGER DEFAULT 0,
        display_order INTEGER DEFAULT 0,
        obtained_at TEXT,
        UNIQUE(user_id, badge_id)
      );
    `);
    const db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    await expect(insertUserBadgeIgnore(db, 7, 'excellent_reporter')).resolves.toBe(true);
    await expect(insertUserBadgeIgnore(db, 7, 'excellent_reporter')).resolves.toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_badges').get()).toEqual({ count: 1 });
  });
});
