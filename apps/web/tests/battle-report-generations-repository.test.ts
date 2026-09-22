import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import {
  countBattleReportGenerationsByUserId,
  countBattleReportGenerationsByUserIdSince,
  getBattleReportGenerationAccessByUserId,
  listBattleReportGenerationsByUserIdLite,
} from '@/lib/db/repositories/battle-report-generations';

let sqlite: ReturnType<typeof Database>;
let db: AppDrizzleDb;

const insertGeneration = (input: {
  id: string;
  userId: number;
  startedAt: string;
  status?: string;
  pvpMatchId?: string | null;
}) => {
  sqlite.prepare(`
INSERT INTO battle_report_generations (
  id, started_at, ended_at, duration_ms, status, generation_mode, endpoint,
  user_id, mode, pvp_match_id, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    input.startedAt,
    input.startedAt,
  );
};

describe('battle report generation participant repository', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;
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
CREATE TABLE battle_report_generation_participants (
  generation_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT,
  PRIMARY KEY (generation_id, user_id)
);
CREATE INDEX idx_battle_report_generation_participants_user_generation
  ON battle_report_generation_participants(user_id, generation_id);
    `);

    insertGeneration({ id: 'owner-42', userId: 42, startedAt: '2026-09-22T10:00:00.000Z' });
    insertGeneration({ id: 'member-42', userId: 7, startedAt: '2026-09-22T09:00:00.000Z' });
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
    });
    expect(rows.find((row) => row.id === 'legacy-42')).toMatchObject({
      arena_participant_generation_id: 'legacy-42',
      arena_participant_role: null,
    });
    await expect(countBattleReportGenerationsByUserId(db, 42)).resolves.toBe(3);
  });

  it('keeps filters, pagination and profile counts on the same owner-or-participant predicate', async () => {
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
      pvpMatchId: null,
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
});
