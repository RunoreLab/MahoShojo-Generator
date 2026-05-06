import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { listPublicDataCardsWithFilters } from '@/lib/db/repositories/data-cards-core';
import * as schema from '@/lib/db/schema';

let sqlite: Database;
let db: AppDrizzleDb;

const exec = (sqlText: string) => sqlite.exec(sqlText);

describe('listPublicDataCardsWithFilters', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL
      );
      CREATE TABLE data_cards (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        data TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 0,
        public_since TEXT,
        usage_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        favorite_count INTEGER DEFAULT 0,
        review_status TEXT DEFAULT 'approved',
        is_recommended INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
      );
      CREATE TABLE data_card_tags (
        data_card_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_by_user_id INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (data_card_id, tag_id)
      );

      INSERT INTO users (id, username, email) VALUES
        (1, 'alice', 'alice@example.test');

      INSERT INTO data_cards (
        id, user_id, type, name, description, data, is_public, review_status,
        is_recommended, like_count, usage_count, favorite_count, created_at, updated_at
      ) VALUES
        ('old-high-likes', 1, 'character', '高赞旧卡', '', '{}', 1, 'approved', 1, 30, 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('new-low-likes', 1, 'character', '低赞新卡', '', '{}', 1, 'approved', 1, 1, 30, 2, '2026-01-02T00:00:00.000Z', '2026-01-04T00:00:00.000Z'),
        ('middle-high-favorites', 1, 'character', '高收藏中间卡', '', '{}', 1, 'approved', 1, 2, 2, 30, '2026-01-03T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
        ('not-recommended', 1, 'character', '非推荐卡', '', '{}', 1, 'approved', 0, 99, 99, 99, '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('管理员推荐列表应保留用户选择的排序方式', async () => {
    const cases: Array<{
      sortBy: 'likes' | 'usage' | 'favorites' | 'created_at';
      expectedFirstId: string;
    }> = [
      { sortBy: 'created_at', expectedFirstId: 'middle-high-favorites' },
      { sortBy: 'likes', expectedFirstId: 'old-high-likes' },
      { sortBy: 'usage', expectedFirstId: 'new-low-likes' },
      { sortBy: 'favorites', expectedFirstId: 'middle-high-favorites' },
    ];

    for (const item of cases) {
      const rows = await listPublicDataCardsWithFilters(db, {
        limit: 10,
        offset: 0,
        type: 'character',
        recommendedOnly: true,
        sortBy: item.sortBy,
      });

      expect(rows.map((row) => row.id)).not.toContain('not-recommended');
      expect(rows[0]?.id).toBe(item.expectedFirstId);
    }
  });
});
