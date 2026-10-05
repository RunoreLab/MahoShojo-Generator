import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import {
  countBattleReportGenerationsByUserId,
  countBattleReportGenerationsByUserIdSince,
  getBattleReportGenerationAccessByUserId,
  getBattleReportGenerationByIdLite,
  listBattleReportGenerationsByUserIdLite,
} from '@/lib/db/repositories/battle-report-generations';

let sqlite: ReturnType<typeof Database>;
let db: AppDrizzleDb;
let queries: Array<{ sql: string; params: unknown[] }>;

const insertGeneration = (input: {
  id: string;
  userId: number;
  startedAt: string;
  status?: string;
  pvpMatchId?: string | null;
  pvpRoomId?: string | null;
}) => {
  sqlite.prepare(`
INSERT INTO battle_report_generations (
  id, started_at, ended_at, duration_ms, status, generation_mode, endpoint,
  user_id, mode, pvp_match_id, pvp_room_id, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `.trim()).run(
    input.id,
    input.startedAt,
    input.startedAt,
    10,
    input.status ?? 'completed',
    'stream',
    'api/arena/generate-stream',
    input.userId,
    'classic',
    input.pvpMatchId ?? null,
    input.pvpRoomId ?? null,
    input.startedAt,
    input.startedAt,
  );
};

describe('battle report generation participant repository', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    queries = [];
    db = drizzle(sqlite, {
      schema,
      logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
    }) as unknown as AppDrizzleDb;
    sqlite.exec(`
CREATE TABLE battle_report_generations (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  generation_mode TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  user_id INTEGER,
  mode TEXT,
  scenario_title TEXT,
  ai_model TEXT,
  scenario_data_card_id TEXT,
  scenario_data_card_updated_at TEXT,
  language TEXT,
  selected_level TEXT,
  story_length TEXT,
  headline TEXT,
  winner TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,
  output_preview TEXT,
  output_has_sensitive_words INTEGER,
  output_has_shield_words INTEGER,
  extra_json TEXT,
  pvp_room_id TEXT,
  pvp_match_id TEXT,
  pvp_round_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_battle_report_generations_user_id ON battle_report_generations(user_id);
CREATE INDEX idx_battle_report_generations_started_at ON battle_report_generations(started_at);
CREATE INDEX idx_battle_report_generations_status ON battle_report_generations(status);
CREATE INDEX idx_battle_report_generations_mode ON battle_report_generations(mode);
CREATE INDEX idx_battle_report_generations_generation_mode ON battle_report_generations(generation_mode);
CREATE INDEX idx_battle_report_generations_pvp_match_id ON battle_report_generations(pvp_match_id);
CREATE TABLE users (id INTEGER PRIMARY KEY);
INSERT INTO users (id) VALUES (7), (8), (42), (77), (99);
    `);
    sqlite.exec(readFileSync(new URL('../../../drizzle/0017_battle_report_generation_participants.sql', import.meta.url), 'utf8'));

    insertGeneration({ id: 'owner-42', userId: 42, startedAt: '2026-09-22T10:00:00.000Z' });
    insertGeneration({ id: 'member-42', userId: 7, startedAt: '2026-09-22T09:00:00.000Z', pvpMatchId: 'member-42', pvpRoomId: 'room-1' });
    insertGeneration({ id: 'legacy-42', userId: 8, startedAt: '2026-09-22T08:00:00.000Z' });
    insertGeneration({ id: 'joined-after', userId: 8, startedAt: '2026-09-22T07:00:00.000Z' });
    insertGeneration({ id: 'unrelated', userId: 8, startedAt: '2026-09-22T06:00:00.000Z' });
    insertGeneration({ id: 'pvp-owner', userId: 8, startedAt: '2026-09-22T05:00:00.000Z', pvpMatchId: 'match-1' });

    sqlite.exec(`
INSERT INTO battle_report_generation_participants (generation_id, user_id, role) VALUES
  ('member-42', 42, 'member'),
  ('legacy-42', 42, NULL),
  ('joined-after', 99, 'member'),
  ('unrelated', 77, 'member');
    `);
  });

  afterEach(() => sqlite.close());

  it('lists and counts owner plus frozen participant rows without including later or unrelated users', async () => {
    const rows = await listBattleReportGenerationsByUserIdLite(db, 42, 50, 0);

    expect(rows.map((row) => row.id)).toEqual(['owner-42', 'member-42', 'legacy-42']);
    expect(rows.find((row) => row.id === 'member-42')).toMatchObject({
      arena_participant_generation_id: 'member-42',
      arena_participant_role: 'member',
      source_kind: 'arena-multiplayer',
    });
    expect(rows.find((row) => row.id === 'legacy-42')).toMatchObject({
      arena_participant_generation_id: 'legacy-42',
      arena_participant_role: null,
    });
    await expect(countBattleReportGenerationsByUserId(db, 42)).resolves.toBe(3);
  });

  it('keeps filters, pagination and profile counts on the same access set', async () => {
    const page = await listBattleReportGenerationsByUserIdLite(db, 42, 1, 1, {
      status: 'completed',
      sort: 'started_at_desc',
    });
    expect(page.map((row) => row.id)).toEqual(['member-42']);

    await expect(countBattleReportGenerationsByUserIdSince(db, 42, '2026-09-22T08:30:00.000Z'))
      .resolves.toEqual({ total: 2, completed: 2, aborted: 0, failed: 0 });
  });

  it('returns owner and participant provenance for the unified access resolver', async () => {
    await expect(getBattleReportGenerationAccessByUserId(db, 'owner-42', 42)).resolves.toEqual({
      generationId: 'owner-42',
      ownerUserId: 42,
      pvpMatchId: null,
      arenaParticipantGenerationId: null,
      arenaParticipantRole: null,
    });
    await expect(getBattleReportGenerationAccessByUserId(db, 'member-42', 42)).resolves.toEqual({
      generationId: 'member-42',
      ownerUserId: 7,
      pvpMatchId: 'member-42',
      arenaParticipantGenerationId: 'member-42',
      arenaParticipantRole: 'member',
    });
    await expect(getBattleReportGenerationAccessByUserId(db, 'pvp-owner', 42)).resolves.toMatchObject({
      generationId: 'pvp-owner',
      ownerUserId: 8,
      pvpMatchId: 'match-1',
      arenaParticipantGenerationId: null,
    });
  });

  it('classifies Arena independently of the viewer relation and excludes it from PVP-only queries', async () => {
    // The owner has no participant row here; another frozen participant still establishes the source.
    const ownerRows = await listBattleReportGenerationsByUserIdLite(db, 7, 50, 0);
    expect(ownerRows[0]).toMatchObject({
      source_kind: 'arena-multiplayer', arena_participant_generation_id: null,
    });
    await expect(getBattleReportGenerationByIdLite(db, 'member-42')).resolves.toMatchObject({
      source_kind: 'arena-multiplayer', pvp_match_id: 'member-42', pvp_room_id: 'room-1',
    });
    await expect(listBattleReportGenerationsByUserIdLite(db, 7, 50, 0, { pvpOnly: true })).resolves.toEqual([]);
    await expect(countBattleReportGenerationsByUserId(db, 42, { pvpOnly: true })).resolves.toBe(0);
    const pvpRows = await listBattleReportGenerationsByUserIdLite(db, 8, 50, 0, { pvpOnly: true });
    expect(pvpRows.map((row) => [row.id, row.source_kind])).toEqual([['pvp-owner', 'pvp']]);
    await expect(countBattleReportGenerationsByUserId(db, 8, { pvpOnly: true })).resolves.toBe(1);
    await expect(getBattleReportGenerationByIdLite(db, 'owner-42')).resolves.toMatchObject({ source_kind: 'solo' });
  });

  it('deduplicates owner/participant overlap while preserving pagination and status counts', async () => {
    sqlite.exec(`INSERT INTO battle_report_generation_participants VALUES ('owner-42', 42, 'host');
UPDATE battle_report_generations SET status = 'failed' WHERE id = 'member-42';
UPDATE battle_report_generations SET status = 'aborted' WHERE id = 'legacy-42';`);
    const rows = await listBattleReportGenerationsByUserIdLite(db, 42, 2, 1, { sort: 'started_at_asc' });
    expect(rows.map((row) => row.id)).toEqual(['member-42', 'owner-42']);
    await expect(countBattleReportGenerationsByUserId(db, 42)).resolves.toBe(3);
    await expect(countBattleReportGenerationsByUserIdSince(db, 42, '2026-09-22T00:00:00.000Z'))
      .resolves.toEqual({ total: 3, completed: 1, aborted: 1, failed: 1 });
  });

  it('uses user indexes and generation lookups for list, count and profile queries', async () => {
    await listBattleReportGenerationsByUserIdLite(db, 42, 3, 0);
    await listBattleReportGenerationsByUserIdLite(db, 42, 10, 1, { pvpOnly: true, status: 'completed' });
    await countBattleReportGenerationsByUserId(db, 42);
    await countBattleReportGenerationsByUserId(db, 42, { pvpOnly: true });
    await countBattleReportGenerationsByUserIdSince(db, 42, '2026-09-22T08:30:00.000Z');

    expect(queries).toHaveLength(5);
    for (const query of queries) {
      const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params) as Array<{ detail: string }>;
      const details = plan.map((row) => row.detail).join('\n');
      expect(details).not.toMatch(/SCAN battle_report_generations\b/u);
      expect(details).toMatch(/SEARCH battle_report_generations USING .*INDEX idx_battle_report_generations_user_id/u);
      expect(details).toMatch(/SEARCH battle_report_generation_participants USING .*INDEX idx_battle_report_generation_participants_user_generation/u);
    }
  });

  it('keeps the old owner reader working after migration 0017 and cascades participant cleanup', async () => {
    expect(sqlite.prepare('SELECT id FROM battle_report_generations WHERE user_id = ?').all(42))
      .toEqual([{ id: 'owner-42' }]);
    sqlite.prepare('DELETE FROM battle_report_generations WHERE id = ?').run('member-42');
    await expect(countBattleReportGenerationsByUserId(db, 42)).resolves.toBe(2);
    expect(sqlite.prepare('SELECT user_id FROM battle_report_generation_participants WHERE generation_id = ?').all('member-42'))
      .toEqual([]);
  });
});
