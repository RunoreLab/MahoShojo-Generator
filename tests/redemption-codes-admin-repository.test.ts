import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import {
  deleteRedemptionCodesBatch,
  estimateRedemptionCodeValueCny,
  getAdminRedemptionCodeStats,
  insertRedemptionCodesBatch,
  hasRedemptionCode,
  listRedemptionCodesPage,
  normalizeRedemptionCode,
} from '@/lib/db/repositories/redemption-codes';

let sqlite: Database.Database;
let db: AppDrizzleDb;

const exec = (sqlText: string) => sqlite.exec(sqlText);

describe('admin redemption codes repository', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        slot_count INTEGER
      );
      CREATE TABLE redemption_codes (
        code TEXT PRIMARY KEY NOT NULL,
        slot_count INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE user_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        badge_id TEXT NOT NULL,
        UNIQUE(user_id, badge_id)
      );
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('estimateRedemptionCodeValueCny follows the configured floor tiers', () => {
    expect(estimateRedemptionCodeValueCny(63)).toBe(0);
    expect(estimateRedemptionCodeValueCny(64)).toBe(5);
    expect(estimateRedemptionCodeValueCny(127)).toBe(5);
    expect(estimateRedemptionCodeValueCny(128)).toBe(12);
    expect(estimateRedemptionCodeValueCny(255)).toBe(12);
    expect(estimateRedemptionCodeValueCny(256)).toBe(24);
    expect(estimateRedemptionCodeValueCny(999)).toBe(24);
  });

  test('normalizeRedemptionCode uppercases and trims values', () => {
    expect(normalizeRedemptionCode('  a3f8-e9c2-1d4b  ')).toBe('A3F8-E9C2-1D4B');
    expect(normalizeRedemptionCode('')).toBe('');
  });

  test('lists unused codes and computes inferred redeemed slots after reporter badge exclusion', async () => {
    await insertRedemptionCodesBatch(db, [
      { code: 'AAAA-BBBB-0001', slotCount: 32 },
      { code: 'AAAA-BBBB-0002', slotCount: 128 },
      { code: 'CCCC-DDDD-0003', slotCount: 256 },
    ]);
    exec(`
      UPDATE redemption_codes SET created_at = '2026-05-01T10:00:00.000Z' WHERE code = 'AAAA-BBBB-0001';
      UPDATE redemption_codes SET created_at = '2026-05-02T10:00:00.000Z' WHERE code = 'AAAA-BBBB-0002';
      UPDATE redemption_codes SET created_at = '2026-05-03T10:00:00.000Z' WHERE code = 'CCCC-DDDD-0003';
      INSERT INTO users (id, username, email, slot_count) VALUES
        (1, 'hana', 'hana@example.test', 384),
        (2, 'mio', 'mio@example.test', 64),
        (3, 'zero', 'zero@example.test', NULL),
        (4, 'nana', 'nana@example.test', 64),
        (5, 'riko', 'riko@example.test', 64);
      INSERT INTO user_badges (user_id, badge_id) VALUES
        (1, 'excellent_reporter'),
        (1, 'hot_reporter'),
        (2, 'chief_reporter');
    `);

    const page = await listRedemptionCodesPage(db, {
      page: 1,
      limit: 2,
      search: 'AAAA',
      minSlotCount: 32,
      maxSlotCount: 200,
    });
    const stats = await getAdminRedemptionCodeStats(db);

    expect(page.total).toBe(2);
    expect(page.items).toEqual([
      {
        code: 'AAAA-BBBB-0002',
        slotCount: 128,
        estimatedValueCny: 12,
        createdAt: '2026-05-02T10:00:00.000Z',
      },
      {
        code: 'AAAA-BBBB-0001',
        slotCount: 32,
        estimatedValueCny: 0,
        createdAt: '2026-05-01T10:00:00.000Z',
      },
    ]);
    expect(stats).toMatchObject({
      unusedCodeTotal: 3,
      unusedSlotTotal: 416,
      unusedEstimatedValueCny: 36,
      reporterRewardSlotTotal: 208,
      inferredRedeemedSlotTotal: 368,
      inferredRedeemedEstimatedValueCny: 22,
      inferredRedeemedUserTotal: 4,
      inferredRedeemedAverageValueCny: 5.5,
      latestCreatedAt: '2026-05-03T10:00:00.000Z',
    });
  });

  test('deleteRedemptionCodesBatch removes only existing unused codes', async () => {
    await insertRedemptionCodesBatch(db, [
      { code: 'AAAA-BBBB-0001', slotCount: 32 },
      { code: 'AAAA-BBBB-0002', slotCount: 128 },
    ]);

    const deleted = await deleteRedemptionCodesBatch(db, ['AAAA-BBBB-0001', 'AAAA-BBBB-0001', 'NOPE']);
    const page = await listRedemptionCodesPage(db, { page: 1, limit: 10 });

    expect(deleted).toBe(1);
    expect(page.items.map((item) => item.code)).toEqual(['AAAA-BBBB-0002']);
  });

  test('hasRedemptionCode matches normalized input', async () => {
    await insertRedemptionCodesBatch(db, [{ code: 'A3F8-E9C2-1D4B', slotCount: 64 }]);

    expect(await hasRedemptionCode(db, 'a3f8-e9c2-1d4b')).toBe(true);
    expect(await hasRedemptionCode(db, 'not-exist')).toBe(false);
  });
});
