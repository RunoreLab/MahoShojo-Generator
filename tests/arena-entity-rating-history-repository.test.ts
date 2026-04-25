import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import { listArenaEntityRatingHistory } from '@/lib/db/repositories/arena-read';

let sqlite: Database;
let db: AppDrizzleDb;

const exec = (sqlText: string) => sqlite.exec(sqlText);

describe('listArenaEntityRatingHistory', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL
      );

      CREATE TABLE battle_report_generations (
        id TEXT PRIMARY KEY NOT NULL,
        user_id INTEGER,
        username TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE battle_report_generation_combatants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generation_id TEXT NOT NULL,
        sort_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        data_card_id TEXT,
        template_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE arena_rating_events (
        id TEXT PRIMARY KEY NOT NULL,
        generation_id TEXT NOT NULL,
        queue TEXT NOT NULL,
        status TEXT NOT NULL,
        skip_reason TEXT,
        user_id INTEGER,
        ip_anonymized TEXT,
        pair_key TEXT NOT NULL,
        a_entity_type TEXT NOT NULL,
        a_entity_id TEXT NOT NULL,
        b_entity_type TEXT NOT NULL,
        b_entity_id TEXT NOT NULL,
        winner_slot INTEGER NOT NULL,
        a_before_rating INTEGER,
        a_after_rating INTEGER,
        a_delta INTEGER,
        a_before_games INTEGER,
        a_after_games INTEGER,
        b_before_rating INTEGER,
        b_after_rating INTEGER,
        b_delta INTEGER,
        b_before_games INTEGER,
        b_after_games INTEGER,
        details_json TEXT,
        created_at TEXT NOT NULL,
        applied_at TEXT
      );

      INSERT INTO users (id, username, email) VALUES
        (7, '发起者七号', 'u7@example.test'),
        (8, '发起者八号', 'u8@example.test');

      INSERT INTO battle_report_generations (id, user_id, username, created_at) VALUES
        ('gen-a', 7, '发起者七号', '2026-04-25T10:00:00.000Z'),
        ('gen-b', 8, '发起者八号', '2026-04-25T11:00:00.000Z'),
        ('gen-free', 7, '发起者七号', '2026-04-25T12:00:00.000Z'),
        ('gen-skipped', 7, '发起者七号', '2026-04-25T13:00:00.000Z');

      INSERT INTO battle_report_generation_combatants
        (generation_id, sort_index, name, data_card_id, template_id, created_at)
      VALUES
        ('gen-a', 0, '目标卡', 'card-target', NULL, '2026-04-25T10:00:00.000Z'),
        ('gen-a', 1, '对手甲', 'card-opponent-a', NULL, '2026-04-25T10:00:00.000Z'),
        ('gen-b', 0, '对手乙', 'card-opponent-b', NULL, '2026-04-25T11:00:00.000Z'),
        ('gen-b', 1, '目标卡', 'card-target', NULL, '2026-04-25T11:00:00.000Z'),
        ('gen-free', 0, '目标卡', 'card-target', NULL, '2026-04-25T12:00:00.000Z'),
        ('gen-free', 1, '对手丙', 'card-opponent-c', NULL, '2026-04-25T12:00:00.000Z'),
        ('gen-skipped', 0, '目标卡', 'card-target', NULL, '2026-04-25T13:00:00.000Z'),
        ('gen-skipped', 1, '对手丁', 'card-opponent-d', NULL, '2026-04-25T13:00:00.000Z');

      INSERT INTO arena_rating_events (
        id, generation_id, queue, status, skip_reason, user_id, ip_anonymized, pair_key,
        a_entity_type, a_entity_id, b_entity_type, b_entity_id, winner_slot,
        a_before_rating, a_after_rating, a_delta, a_before_games, a_after_games,
        b_before_rating, b_after_rating, b_delta, b_before_games, b_after_games,
        details_json, created_at, applied_at
      ) VALUES
        (
          'event-a', 'gen-a', 'strict', 'applied', NULL, 7, NULL, 'data_card:card-opponent-a|data_card:card-target',
          'data_card', 'card-target', 'data_card', 'card-opponent-a', 1,
          1000, 1018, 18, 0, 1,
          1000, 982, -18, 0, 1,
          NULL, '2026-04-25T10:00:00.000Z', '2026-04-25T10:00:01.000Z'
        ),
        (
          'event-b', 'gen-b', 'strict', 'applied', NULL, 8, NULL, 'data_card:card-opponent-b|data_card:card-target',
          'data_card', 'card-opponent-b', 'data_card', 'card-target', 1,
          1000, 1014, 14, 0, 1,
          1018, 1004, -14, 1, 2,
          NULL, '2026-04-25T11:00:00.000Z', '2026-04-25T11:00:01.000Z'
        ),
        (
          'event-free', 'gen-free', 'free', 'applied', NULL, 7, NULL, 'data_card:card-opponent-c|data_card:card-target',
          'data_card', 'card-target', 'data_card', 'card-opponent-c', 1,
          1000, 1016, 16, 0, 1,
          1000, 984, -16, 0, 1,
          NULL, '2026-04-25T12:00:00.000Z', '2026-04-25T12:00:01.000Z'
        ),
        (
          'event-skipped', 'gen-skipped', 'strict', 'skipped', 'daily-limit', 7, NULL, 'data_card:card-opponent-d|data_card:card-target',
          'data_card', 'card-target', 'data_card', 'card-opponent-d', 1,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, '2026-04-25T13:00:00.000Z', NULL
        );
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('按本卡视角返回最近 strict applied 对局并映射 A/B 两侧结果', async () => {
    const rows = await listArenaEntityRatingHistory(db, {
      entityType: 'data_card',
      entityId: 'card-target',
      queue: 'strict',
      limit: 10,
    });

    expect(rows).toEqual([
      {
        generationId: 'gen-b',
        createdAt: '2026-04-25T11:00:00.000Z',
        appliedAt: '2026-04-25T11:00:01.000Z',
        opponent: {
          entityType: 'data_card',
          entityId: 'card-opponent-b',
          displayName: '对手乙',
        },
        result: 'loss',
        delta: -14,
        afterRating: 1004,
        initiator: {
          userId: 8,
          username: '发起者八号',
        },
      },
      {
        generationId: 'gen-a',
        createdAt: '2026-04-25T10:00:00.000Z',
        appliedAt: '2026-04-25T10:00:01.000Z',
        opponent: {
          entityType: 'data_card',
          entityId: 'card-opponent-a',
          displayName: '对手甲',
        },
        result: 'win',
        delta: 18,
        afterRating: 1018,
        initiator: {
          userId: 7,
          username: '发起者七号',
        },
      },
    ]);
  });
});
