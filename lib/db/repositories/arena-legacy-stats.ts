import { asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { battles, characters } from '@/lib/db/schema';

export type CharacterStatsRow = {
  name: string;
  is_preset: number;
  wins: number;
  losses: number;
  participations: number;
};

export type BattleRow = {
  id: number;
  winner_name: string;
  participants_json: string;
  created_at: string;
};

export type BattleStatsParticipantInput = {
  name: string;
  isPreset: boolean;
  isWinner: boolean;
  isLoser: boolean;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const normalizeLimit = (value: number, fallback: number, max: number): number => {
  const n = toInt(value, fallback);
  return Math.max(1, Math.min(max, n));
};

export const getCharacterByName = async (db: AppDrizzleDb, name: string): Promise<CharacterStatsRow | null> => {
  const rows = await db
    .select({
      name: characters.name,
      isPreset: characters.isPreset,
      wins: characters.wins,
      losses: characters.losses,
      participations: characters.participations,
    })
    .from(characters)
    .where(eq(characters.name, name))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    name: row.name,
    is_preset: row.isPreset ? 1 : 0,
    wins: toInt(row.wins, 0),
    losses: toInt(row.losses, 0),
    participations: toInt(row.participations, 0),
  };
};

export const ensureCharacterExists = async (
  db: AppDrizzleDb,
  name: string,
  isPreset: boolean,
): Promise<void> => {
  await db
    .insert(characters)
    .values({
      name,
      isPreset,
      wins: 0,
      losses: 0,
      participations: 0,
    })
    .onConflictDoNothing({
      target: characters.name,
    });
};

export const incrementCharacterStats = async (
  db: AppDrizzleDb,
  name: string,
  options: { won: boolean; countedAsLoss: boolean },
): Promise<boolean> => {
  const setPayload: {
    participations: SQL;
    wins?: SQL;
    losses?: SQL;
  } = {
    participations: sql`${characters.participations} + 1`,
  };

  if (options.won) {
    setPayload.wins = sql`${characters.wins} + 1`;
  } else if (options.countedAsLoss) {
    setPayload.losses = sql`${characters.losses} + 1`;
  }

  const updated = await db
    .update(characters)
    .set(setPayload)
    .where(eq(characters.name, name))
    .returning({
      name: characters.name,
    });

  return updated.length > 0;
};

export const createBattleRecord = async (
  db: AppDrizzleDb,
  winnerName: string,
  participantsJson: string,
  createdAtIso: string,
): Promise<number | null> => {
  const inserted = await db
    .insert(battles)
    .values({
      winnerName,
      participantsJson,
      createdAt: createdAtIso,
    })
    .returning({
      id: battles.id,
    });

  const id = inserted[0]?.id;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
};

export const listCharacterLeaderboardRows = async (
  db: AppDrizzleDb,
  limit = 10,
): Promise<CharacterStatsRow[]> => {
  const rows = await db
    .select({
      name: characters.name,
      isPreset: characters.isPreset,
      wins: characters.wins,
      losses: characters.losses,
      participations: characters.participations,
    })
    .from(characters)
    .orderBy(desc(characters.wins), desc(characters.participations), asc(characters.name))
    .limit(normalizeLimit(limit, 10, 200));

  return rows.map((row) => ({
    name: row.name,
    is_preset: row.isPreset ? 1 : 0,
    wins: toInt(row.wins, 0),
    losses: toInt(row.losses, 0),
    participations: toInt(row.participations, 0),
  }));
};

export const listRecentBattleRows = async (
  db: AppDrizzleDb,
  limit = 20,
): Promise<BattleRow[]> => {
  const rows = await db
    .select({
      id: battles.id,
      winnerName: battles.winnerName,
      participantsJson: battles.participantsJson,
      createdAt: battles.createdAt,
    })
    .from(battles)
    .orderBy(desc(battles.createdAt), desc(battles.id))
    .limit(normalizeLimit(limit, 20, 500));

  return rows
    .filter((row) => typeof row.id === 'number')
    .map((row) => ({
      id: row.id,
      winner_name: row.winnerName,
      participants_json: row.participantsJson,
      created_at: row.createdAt,
    }));
};

export const recordBattleStats = async (
  db: AppDrizzleDb,
  winnerName: string,
  participants: BattleStatsParticipantInput[],
): Promise<void> => {
  for (const participant of participants) {
    const normalizedName = participant.name.trim();
    if (!normalizedName) continue;

    await ensureCharacterExists(db, normalizedName, participant.isPreset);
    await incrementCharacterStats(db, normalizedName, {
      won: participant.isWinner,
      countedAsLoss: participant.isLoser,
    });
  }

  const participantNames = participants
    .map((item) => item.name.trim())
    .filter(Boolean);
  await createBattleRecord(db, winnerName, JSON.stringify(participantNames), new Date().toISOString());
};
