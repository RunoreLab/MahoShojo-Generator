import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationPath = new URL('../../../drizzle/0014_arena_multiplayer_rooms.sql', import.meta.url);

describe('Arena Room directory isolated D1 migration', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users (id) VALUES (101), (202);');
  });

  afterEach(() => sqlite.close());

  it('migration 可重复应用并完成 public/unlisted CRUD round-trip', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    sqlite.exec(migration);
    sqlite.exec(migration);
    const insert = sqlite.prepare(`
      INSERT INTO arena_multiplayer_rooms (
        id, room_epoch, host_user_id, title, visibility, status, created_at, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
    `);
    insert.run('room-public', 'epoch-public', 101, 'Public', 'public',
      '2026-08-28T08:00:00.000Z', '2026-08-28T08:10:00.000Z');
    insert.run('room-unlisted', 'epoch-unlisted', 202, 'Unlisted', 'unlisted',
      '2026-08-28T08:01:00.000Z', '2026-08-28T08:11:00.000Z');

    expect(sqlite.prepare(`
      SELECT id FROM arena_multiplayer_rooms
      WHERE visibility = 'public' AND status = 'open'
      ORDER BY last_activity_at DESC, id DESC
      LIMIT 20
    `).all()).toEqual([{ id: 'room-public' }]);
    expect(sqlite.prepare(
      'DELETE FROM arena_multiplayer_rooms WHERE id = ? AND room_epoch = ?',
    ).run('room-public', 'wrong-epoch').changes).toBe(0);
    expect(sqlite.prepare(
      'DELETE FROM arena_multiplayer_rooms WHERE id = ? AND room_epoch = ?',
    ).run('room-public', 'epoch-public').changes).toBe(1);
  });

  it('schema 不含 presence/story，实际分页查询命中 bounded discovery indexes', () => {
    sqlite.exec(readFileSync(migrationPath, 'utf8'));
    const columns = sqlite.prepare('PRAGMA table_info(arena_multiplayer_rooms)').all()
      .map((row) => (row as { name: string }).name);
    expect(columns).not.toEqual(expect.arrayContaining([
      'presence',
      'connection_count',
      'story_chunk',
      'shared_config',
    ]));
    const indexes = sqlite.prepare('PRAGMA index_list(arena_multiplayer_rooms)').all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_arena_multiplayer_rooms_public_page',
      'idx_arena_multiplayer_rooms_host_page',
      'idx_arena_multiplayer_rooms_reconcile_page',
    ]));
    const publicPlan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id FROM arena_multiplayer_rooms
      WHERE visibility = 'public' AND status = 'open'
      ORDER BY last_activity_at DESC, id DESC
      LIMIT 20
    `).all().map((row) => String((row as { detail: string }).detail)).join('\n');
    expect(publicPlan).toContain('idx_arena_multiplayer_rooms_public_page');
    const reconcilePlan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id FROM arena_multiplayer_rooms
      WHERE status = 'open' AND last_activity_at <= '2026-08-28T09:00:00.000Z'
      ORDER BY last_activity_at DESC, id DESC
      LIMIT 50
    `).all().map((row) => String((row as { detail: string }).detail)).join('\n');
    expect(reconcilePlan).toContain('idx_arena_multiplayer_rooms_reconcile_page');
  });
});
