import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { increaseBusinessUserSlotCountById } from '@/lib/db/repositories/business-users';
import * as schema from '@/lib/db/schema';

let sqlite: Database;
let db: AppDrizzleDb;

describe('business user slot count', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        slot_count INTEGER,
        updated_at TEXT
      );
      INSERT INTO users (id, slot_count) VALUES (1, NULL), (2, 50), (3, 0), (4, -5);
    `);
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;
  });

  afterEach(() => sqlite.close());

  test('NULL/非正槽位从默认容量起算，已有覆盖值继续累加', async () => {
    await expect(increaseBusinessUserSlotCountById(db, 1, 128, 20)).resolves.toBe(1);
    await expect(increaseBusinessUserSlotCountById(db, 2, 10, 20)).resolves.toBe(1);
    await expect(increaseBusinessUserSlotCountById(db, 3, 5, 20)).resolves.toBe(1);
    await expect(increaseBusinessUserSlotCountById(db, 4, 5, 20)).resolves.toBe(1);

    const rows = sqlite.prepare('SELECT id, slot_count FROM users ORDER BY id').all();
    expect(rows).toEqual([
      { id: 1, slot_count: 148 },
      { id: 2, slot_count: 60 },
      { id: 3, slot_count: 25 },
      { id: 4, slot_count: 25 },
    ]);
  });
});
