import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { countUserUsedDataCardSlots } from '@/lib/db/repositories/data-cards-core';
import * as schema from '@/lib/db/schema';

let sqlite: Database;
let db: AppDrizzleDb;

describe('countUserUsedDataCardSlots', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;
    sqlite.exec(`
      CREATE TABLE data_cards (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT, data TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 0, public_since TEXT,
        usage_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0,
        favorite_count INTEGER DEFAULT 0, review_status TEXT,
        is_recommended INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE data_card_updates (
        id TEXT PRIMARY KEY, data_card_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
        name TEXT, description TEXT, data TEXT, created_at TEXT, updated_at TEXT
      );
    `);

    const insert = sqlite.prepare(`
      INSERT INTO data_cards (id, user_id, type, name, data, usage_count, favorite_count, deleted_at)
      VALUES (?, 1, 'character', ?, ?, ?, ?, ?)
    `);
    insert.run('small', 'small', 'a'.repeat(100 * 1024), 0, 0, null);
    insert.run('large', 'large', 'a'.repeat(700 * 1024), 0, 0, null);
    insert.run('hot-large', 'hot-large', 'a'.repeat(700 * 1024), 31, 11, null);
    insert.run('pending', 'pending', 'a'.repeat(100 * 1024), 0, 0, null);
    insert.run('utf8', 'utf8', '中'.repeat(110 * 1024), 0, 0, null);
    insert.run('deleted', 'deleted', 'a'.repeat(900 * 1024), 0, 0, '2026-09-11T00:00:00Z');
    sqlite.prepare(`INSERT INTO data_card_updates (id, data_card_id, user_id, data) VALUES (?, ?, 1, ?)`)
      .run('pending-update', 'pending', 'a'.repeat(700 * 1024));
  });

  afterEach(() => sqlite.close());

  test('按 UTF-8 字节、待审最大版本和热门减一槽计算总占用', async () => {
    await expect(countUserUsedDataCardSlots(db, 1)).resolves.toBe(11);
  });

  test('可排除当前卡以校验替换后的容量', async () => {
    await expect(countUserUsedDataCardSlots(db, 1, 'large')).resolves.toBe(8);
  });
});
