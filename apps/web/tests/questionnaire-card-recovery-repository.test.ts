import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  removeStrictArenaRatingForDataCard,
} from '@/lib/db/repositories/arena-ratings-write';
import { repairQuestionnaireDataCardType } from '@/lib/db/repositories/data-cards-core';
import * as schema from '@/lib/db/schema';

let sqlite: Database;
let db: AppDrizzleDb;

describe('questionnaire data-card recovery repositories', () => {
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
      CREATE TABLE arena_ratings (
        entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, queue TEXT NOT NULL,
        rating INTEGER NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL,
        losses INTEGER NOT NULL, draws INTEGER NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  });

  afterEach(() => sqlite.close());

  test('恢复错标问卷时原子地撤销 nativeAllowed', async () => {
    sqlite.prepare(`
      INSERT INTO data_cards (id, user_id, type, name, data, deleted_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `).run(
      'legacy-questionnaire',
      7,
      'character',
      '历史问卷',
      JSON.stringify({
        id: 'legacy-questionnaire',
        kind: 'magical-girl',
        title: '测试问卷',
        questions: [{ id: 'q1', question: '代号是什么？' }],
        nativeAllowed: true,
      }),
    );

    await expect(repairQuestionnaireDataCardType(db, {
      id: 'legacy-questionnaire',
      userId: 7,
    })).resolves.toBe(1);

    const row = sqlite.prepare('SELECT type, data FROM data_cards WHERE id = ?')
      .get('legacy-questionnaire') as { type: string; data: string };
    expect(row.type).toBe('questionnaire');
    expect(JSON.parse(row.data)).toMatchObject({ nativeAllowed: false });
  });

  test('移除错标卡遗留的 strict rating，但保留其他队列和历史卡状态', async () => {
    sqlite.prepare(`
      INSERT INTO arena_ratings
        (entity_type, entity_id, queue, rating, games, wins, losses, draws, created_at, updated_at)
      VALUES (?, ?, ?, 1200, 3, 2, 1, 0, ?, ?)
    `).run('data_card', 'legacy-questionnaire', 'strict', '2026-09-18', '2026-09-18');
    sqlite.prepare(`
      INSERT INTO arena_ratings
        (entity_type, entity_id, queue, rating, games, wins, losses, draws, created_at, updated_at)
      VALUES (?, ?, ?, 1200, 3, 2, 1, 0, ?, ?)
    `).run('data_card', 'legacy-questionnaire', 'free', '2026-09-18', '2026-09-18');
    sqlite.prepare(`
      INSERT INTO arena_ratings
        (entity_type, entity_id, queue, rating, games, wins, losses, draws, created_at, updated_at)
      VALUES (?, ?, ?, 1200, 3, 2, 1, 0, ?, ?)
    `).run('data_card', 'other-card', 'strict', '2026-09-18', '2026-09-18');

    await removeStrictArenaRatingForDataCard(db, 'legacy-questionnaire');

    const rows = sqlite.prepare(`
      SELECT entity_id, queue FROM arena_ratings ORDER BY entity_id, queue
    `).all() as Array<{ entity_id: string; queue: string }>;
    expect(rows).toEqual([
      { entity_id: 'legacy-questionnaire', queue: 'free' },
      { entity_id: 'other-card', queue: 'strict' },
    ]);
  });
});
