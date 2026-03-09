import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  pvpMatchPlayers,
  pvpMatches,
  pvpRoomCardSnapshots,
  pvpRoomChatMessages,
  pvpRoundChoices,
  pvpRounds,
} from '@/lib/db/schema';

type PvpRoundStatus = 'pending' | 'resolving' | 'completed' | 'aborted';
type PvpMatchStatus = 'active' | 'completed' | 'aborted';
type PvpRoomMemberRole = 'player' | 'spectator';

export type PvpRoundDbRow = {
  id: string;
  room_id: string;
  match_id: string | null;
  round_index: number;
  status: PvpRoundStatus;
  battle_generation_id: string | null;
  public_snapshot_json: string | null;
  result_json: string | null;
  winner_user_id: number | null;
  winner_name: string | null;
  created_at: string;
};

export type PvpRoundChoiceDbRow = {
  round_id: string;
  user_id: number;
  choice_ref_json: string;
  created_at: string;
  updated_at: string;
};

type PvpCardSnapshotDbRow = {
  id: string;
  room_id: string;
  owner_user_id: number;
  ref_json: string;
  card_type: string;
  name: string;
  data_json: string;
  source_updated_at: string | null;
  created_at: string;
};

export type PvpMatchDbRow = {
  id: string;
  room_id: string;
  status: PvpMatchStatus;
  rules_json: string;
  participants: number;
  started_at: string;
  ended_at: string | null;
  winner_user_id: number | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
};

export type PvpMatchPlayerDbRow = {
  match_id: string;
  user_id: number;
  seat: number;
  username: string | null;
  user_prefix: string | null;
  joined_at: string;
};

export type PvpUserSummaryDbRow = {
  user_id: number;
  completed_matches: number;
  wins: number;
  losses: number;
  draws: number;
  aborted_matches: number;
  last_played_at: string | null;
};

export type PvpMatchRoundOutcomeSummaryDbRow = {
  match_id: string;
  total_rounds: number;
  wins: number;
  losses: number;
  draws: number;
};

export type PvpRoomChatMessageDbRow = {
  id: number;
  room_id: string;
  sender_user_id: number;
  sender_role: PvpRoomMemberRole;
  sender_username: string;
  sender_prefix: string | null;
  content_json: string;
  rendered_text: string | null;
  sticker_id: string | null;
  emoji_text: string | null;
  created_at: string;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toIntOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

const mapPvpRoundRow = (row: {
  id: string;
  roomId: string;
  matchId: string | null;
  roundIndex: number;
  status: string;
  battleGenerationId: string | null;
  publicSnapshotJson: string | null;
  resultJson: string | null;
  winnerUserId: number | null;
  winnerName: string | null;
  createdAt: string;
}): PvpRoundDbRow => ({
  id: row.id,
  room_id: row.roomId,
  match_id: typeof row.matchId === 'string' ? row.matchId : null,
  round_index: toInt(row.roundIndex, 0),
  status:
    row.status === 'resolving' || row.status === 'completed' || row.status === 'aborted'
      ? row.status
      : 'pending',
  battle_generation_id: typeof row.battleGenerationId === 'string' ? row.battleGenerationId : null,
  public_snapshot_json: typeof row.publicSnapshotJson === 'string' ? row.publicSnapshotJson : null,
  result_json: typeof row.resultJson === 'string' ? row.resultJson : null,
  winner_user_id: toIntOrNull(row.winnerUserId),
  winner_name: typeof row.winnerName === 'string' ? row.winnerName : null,
  created_at: row.createdAt,
});

const mapPvpMatchRow = (row: {
  id: string;
  roomId: string;
  status: string;
  rulesJson: string;
  participants: number;
  startedAt: string;
  endedAt: string | null;
  winnerUserId: number | null;
  resultJson: string | null;
  createdAt: string;
  updatedAt: string;
}): PvpMatchDbRow => ({
  id: row.id,
  room_id: row.roomId,
  status: row.status === 'completed' || row.status === 'aborted' ? row.status : 'active',
  rules_json: row.rulesJson,
  participants: toInt(row.participants, 0),
  started_at: row.startedAt,
  ended_at: typeof row.endedAt === 'string' ? row.endedAt : null,
  winner_user_id: toIntOrNull(row.winnerUserId),
  result_json: typeof row.resultJson === 'string' ? row.resultJson : null,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export const insertPvpRound = async (
  db: AppDrizzleDb,
  input: {
    roundId: string;
    roomId: string;
    matchId?: string | null;
    roundIndex: number;
    status: PvpRoundStatus;
    publicSnapshotJson?: string | null;
    createdAt: string;
  },
): Promise<boolean> => {
  const inserted = await db
    .insert(pvpRounds)
    .values({
      id: input.roundId,
      roomId: input.roomId,
      matchId: input.matchId ?? null,
      roundIndex: input.roundIndex,
      status: input.status,
      publicSnapshotJson: input.publicSnapshotJson ?? null,
      createdAt: input.createdAt,
    })
    .returning({
      id: pvpRounds.id,
    });

  return inserted.length > 0;
};

export const getPvpRoundByIdRow = async (
  db: AppDrizzleDb,
  roundId: string,
): Promise<PvpRoundDbRow | null> => {
  const rows = await db
    .select({
      id: pvpRounds.id,
      roomId: pvpRounds.roomId,
      matchId: pvpRounds.matchId,
      roundIndex: pvpRounds.roundIndex,
      status: pvpRounds.status,
      battleGenerationId: pvpRounds.battleGenerationId,
      publicSnapshotJson: pvpRounds.publicSnapshotJson,
      resultJson: pvpRounds.resultJson,
      winnerUserId: pvpRounds.winnerUserId,
      winnerName: pvpRounds.winnerName,
      createdAt: pvpRounds.createdAt,
    })
    .from(pvpRounds)
    .where(eq(pvpRounds.id, roundId))
    .limit(1);

  if (rows.length === 0) return null;
  return mapPvpRoundRow(rows[0]);
};

export const getLatestPvpRoundByRoomId = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<PvpRoundDbRow | null> => {
  const rows = await db
    .select({
      id: pvpRounds.id,
      roomId: pvpRounds.roomId,
      matchId: pvpRounds.matchId,
      roundIndex: pvpRounds.roundIndex,
      status: pvpRounds.status,
      battleGenerationId: pvpRounds.battleGenerationId,
      publicSnapshotJson: pvpRounds.publicSnapshotJson,
      resultJson: pvpRounds.resultJson,
      winnerUserId: pvpRounds.winnerUserId,
      winnerName: pvpRounds.winnerName,
      createdAt: pvpRounds.createdAt,
    })
    .from(pvpRounds)
    .where(eq(pvpRounds.roomId, roomId))
    .orderBy(desc(pvpRounds.roundIndex))
    .limit(1);

  if (rows.length === 0) return null;
  return mapPvpRoundRow(rows[0]);
};

export const getLatestPvpRoundByMatchId = async (
  db: AppDrizzleDb,
  matchId: string,
): Promise<PvpRoundDbRow | null> => {
  const rows = await db
    .select({
      id: pvpRounds.id,
      roomId: pvpRounds.roomId,
      matchId: pvpRounds.matchId,
      roundIndex: pvpRounds.roundIndex,
      status: pvpRounds.status,
      battleGenerationId: pvpRounds.battleGenerationId,
      publicSnapshotJson: pvpRounds.publicSnapshotJson,
      resultJson: pvpRounds.resultJson,
      winnerUserId: pvpRounds.winnerUserId,
      winnerName: pvpRounds.winnerName,
      createdAt: pvpRounds.createdAt,
    })
    .from(pvpRounds)
    .where(eq(pvpRounds.matchId, matchId))
    .orderBy(desc(pvpRounds.roundIndex))
    .limit(1);

  if (rows.length === 0) return null;
  return mapPvpRoundRow(rows[0]);
};

export const listPvpRoundsByRoomId = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<PvpRoundDbRow[]> => {
  const rows = await db
    .select({
      id: pvpRounds.id,
      roomId: pvpRounds.roomId,
      matchId: pvpRounds.matchId,
      roundIndex: pvpRounds.roundIndex,
      status: pvpRounds.status,
      battleGenerationId: pvpRounds.battleGenerationId,
      publicSnapshotJson: pvpRounds.publicSnapshotJson,
      resultJson: pvpRounds.resultJson,
      winnerUserId: pvpRounds.winnerUserId,
      winnerName: pvpRounds.winnerName,
      createdAt: pvpRounds.createdAt,
    })
    .from(pvpRounds)
    .where(eq(pvpRounds.roomId, roomId))
    .orderBy(asc(pvpRounds.roundIndex));

  return rows.map(mapPvpRoundRow);
};

export const listPvpRoundsByMatchId = async (
  db: AppDrizzleDb,
  matchId: string,
): Promise<PvpRoundDbRow[]> => {
  const rows = await db
    .select({
      id: pvpRounds.id,
      roomId: pvpRounds.roomId,
      matchId: pvpRounds.matchId,
      roundIndex: pvpRounds.roundIndex,
      status: pvpRounds.status,
      battleGenerationId: pvpRounds.battleGenerationId,
      publicSnapshotJson: pvpRounds.publicSnapshotJson,
      resultJson: pvpRounds.resultJson,
      winnerUserId: pvpRounds.winnerUserId,
      winnerName: pvpRounds.winnerName,
      createdAt: pvpRounds.createdAt,
    })
    .from(pvpRounds)
    .where(eq(pvpRounds.matchId, matchId))
    .orderBy(asc(pvpRounds.roundIndex));

  return rows.map(mapPvpRoundRow);
};

export const updatePvpRoundPatch = async (
  db: AppDrizzleDb,
  roundId: string,
  patch: {
    status?: PvpRoundStatus;
    battleGenerationId?: string | null;
    publicSnapshotJson?: string | null;
    resultJson?: string | null;
    winnerUserId?: number | null;
    winnerName?: string | null;
  },
): Promise<number> => {
  const setPayload: {
    status?: PvpRoundStatus;
    battleGenerationId?: string | null;
    publicSnapshotJson?: string | null;
    resultJson?: string | null;
    winnerUserId?: number | null;
    winnerName?: string | null;
  } = {};

  if (patch.status !== undefined) setPayload.status = patch.status;
  if (patch.battleGenerationId !== undefined) setPayload.battleGenerationId = patch.battleGenerationId;
  if (patch.publicSnapshotJson !== undefined) setPayload.publicSnapshotJson = patch.publicSnapshotJson;
  if (patch.resultJson !== undefined) setPayload.resultJson = patch.resultJson;
  if (patch.winnerUserId !== undefined) setPayload.winnerUserId = patch.winnerUserId;
  if (patch.winnerName !== undefined) setPayload.winnerName = patch.winnerName;

  if (Object.keys(setPayload).length === 0) return 0;

  const updated = await db
    .update(pvpRounds)
    .set(setPayload)
    .where(eq(pvpRounds.id, roundId))
    .returning({
      id: pvpRounds.id,
    });

  return updated.length;
};

export const upsertPvpRoundChoice = async (
  db: AppDrizzleDb,
  input: {
    roundId: string;
    userId: number;
    choiceRefJson: string;
    nowIso: string;
  },
): Promise<void> => {
  await db
    .insert(pvpRoundChoices)
    .values({
      roundId: input.roundId,
      userId: input.userId,
      choiceRefJson: input.choiceRefJson,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    })
    .onConflictDoUpdate({
      target: [pvpRoundChoices.roundId, pvpRoundChoices.userId],
      set: {
        choiceRefJson: input.choiceRefJson,
        updatedAt: input.nowIso,
      },
    });
};

export const listPvpRoundChoicesByRoundId = async (
  db: AppDrizzleDb,
  roundId: string,
): Promise<PvpRoundChoiceDbRow[]> => {
  const rows = await db
    .select({
      roundId: pvpRoundChoices.roundId,
      userId: pvpRoundChoices.userId,
      choiceRefJson: pvpRoundChoices.choiceRefJson,
      createdAt: pvpRoundChoices.createdAt,
      updatedAt: pvpRoundChoices.updatedAt,
    })
    .from(pvpRoundChoices)
    .where(eq(pvpRoundChoices.roundId, roundId));

  return rows.map((row) => ({
    round_id: row.roundId,
    user_id: toInt(row.userId, 0),
    choice_ref_json: row.choiceRefJson,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));
};

export const getPvpCardSnapshotByIdRow = async (
  db: AppDrizzleDb,
  snapshotId: string,
): Promise<PvpCardSnapshotDbRow | null> => {
  const rows = await db
    .select({
      id: pvpRoomCardSnapshots.id,
      roomId: pvpRoomCardSnapshots.roomId,
      ownerUserId: pvpRoomCardSnapshots.ownerUserId,
      refJson: pvpRoomCardSnapshots.refJson,
      cardType: pvpRoomCardSnapshots.cardType,
      name: pvpRoomCardSnapshots.name,
      dataJson: pvpRoomCardSnapshots.dataJson,
      sourceUpdatedAt: pvpRoomCardSnapshots.sourceUpdatedAt,
      createdAt: pvpRoomCardSnapshots.createdAt,
    })
    .from(pvpRoomCardSnapshots)
    .where(eq(pvpRoomCardSnapshots.id, snapshotId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    room_id: row.roomId,
    owner_user_id: toInt(row.ownerUserId, 0),
    ref_json: row.refJson,
    card_type: row.cardType,
    name: row.name,
    data_json: row.dataJson,
    source_updated_at: typeof row.sourceUpdatedAt === 'string' ? row.sourceUpdatedAt : null,
    created_at: row.createdAt,
  };
};

export const listPvpUserSummariesByUserIds = async (
  db: AppDrizzleDb,
  userIds: number[],
): Promise<PvpUserSummaryDbRow[]> => {
  const ids = Array.from(new Set(userIds.filter((n) => Number.isFinite(n)).map((n) => Math.floor(n)).filter((n) => n > 0)));
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      userId: pvpMatchPlayers.userId,
      completedMatches: sql<number>`SUM(CASE WHEN ${pvpMatches.status} = 'completed' THEN 1 ELSE 0 END)`,
      wins: sql<number>`SUM(CASE WHEN ${pvpMatches.status} = 'completed' AND ${pvpMatches.winnerUserId} = ${pvpMatchPlayers.userId} THEN 1 ELSE 0 END)`,
      draws: sql<number>`SUM(CASE WHEN ${pvpMatches.status} = 'completed' AND ${pvpMatches.winnerUserId} IS NULL THEN 1 ELSE 0 END)`,
      losses: sql<number>`SUM(CASE WHEN ${pvpMatches.status} = 'completed' AND ${pvpMatches.winnerUserId} IS NOT NULL AND ${pvpMatches.winnerUserId} != ${pvpMatchPlayers.userId} THEN 1 ELSE 0 END)`,
      abortedMatches: sql<number>`SUM(CASE WHEN ${pvpMatches.status} = 'aborted' THEN 1 ELSE 0 END)`,
      lastPlayedAt: sql<string | null>`MAX(${pvpMatches.startedAt})`,
    })
    .from(pvpMatchPlayers)
    .innerJoin(pvpMatches, eq(pvpMatches.id, pvpMatchPlayers.matchId))
    .where(inArray(pvpMatchPlayers.userId, ids))
    .groupBy(pvpMatchPlayers.userId);

  return rows.map((row) => ({
    user_id: toInt(row.userId, 0),
    completed_matches: toInt(row.completedMatches, 0),
    wins: toInt(row.wins, 0),
    losses: toInt(row.losses, 0),
    draws: toInt(row.draws, 0),
    aborted_matches: toInt(row.abortedMatches, 0),
    last_played_at: typeof row.lastPlayedAt === 'string' ? row.lastPlayedAt : null,
  }));
};

export const listPvpMatchesByUserId = async (
  db: AppDrizzleDb,
  userId: number,
  limit: number,
  offset: number,
): Promise<PvpMatchDbRow[]> => {
  const rows = await db
    .select({
      id: pvpMatches.id,
      roomId: pvpMatches.roomId,
      status: pvpMatches.status,
      rulesJson: pvpMatches.rulesJson,
      participants: pvpMatches.participants,
      startedAt: pvpMatches.startedAt,
      endedAt: pvpMatches.endedAt,
      winnerUserId: pvpMatches.winnerUserId,
      resultJson: pvpMatches.resultJson,
      createdAt: pvpMatches.createdAt,
      updatedAt: pvpMatches.updatedAt,
    })
    .from(pvpMatchPlayers)
    .innerJoin(pvpMatches, eq(pvpMatches.id, pvpMatchPlayers.matchId))
    .where(eq(pvpMatchPlayers.userId, userId))
    .orderBy(desc(pvpMatches.startedAt))
    .limit(limit)
    .offset(offset);

  return rows.map(mapPvpMatchRow);
};

export const listPvpMatchPlayersByMatchIds = async (
  db: AppDrizzleDb,
  matchIds: string[],
): Promise<PvpMatchPlayerDbRow[]> => {
  const ids = Array.from(new Set(matchIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)));
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      matchId: pvpMatchPlayers.matchId,
      userId: pvpMatchPlayers.userId,
      seat: pvpMatchPlayers.seat,
      username: pvpMatchPlayers.username,
      userPrefix: pvpMatchPlayers.userPrefix,
      joinedAt: pvpMatchPlayers.joinedAt,
    })
    .from(pvpMatchPlayers)
    .where(inArray(pvpMatchPlayers.matchId, ids))
    .orderBy(asc(pvpMatchPlayers.matchId), asc(pvpMatchPlayers.seat));

  return rows.map((row) => ({
    match_id: row.matchId,
    user_id: toInt(row.userId, 0),
    seat: toInt(row.seat, 0),
    username: typeof row.username === 'string' ? row.username : null,
    user_prefix: typeof row.userPrefix === 'string' ? row.userPrefix : null,
    joined_at: row.joinedAt,
  }));
};

export const listPvpMatchRoundOutcomeSummariesByMatchIds = async (
  db: AppDrizzleDb,
  matchIds: string[],
  userId: number,
): Promise<PvpMatchRoundOutcomeSummaryDbRow[]> => {
  const ids = Array.from(new Set(matchIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)));
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      matchId: pvpRounds.matchId,
      totalRounds: sql<number>`COUNT(1)`,
      wins: sql<number>`SUM(CASE WHEN ${pvpRounds.winnerUserId} = ${userId} THEN 1 ELSE 0 END)`,
      losses: sql<number>`SUM(CASE WHEN ${pvpRounds.winnerUserId} IS NOT NULL AND ${pvpRounds.winnerUserId} != ${userId} THEN 1 ELSE 0 END)`,
      draws: sql<number>`SUM(CASE WHEN ${pvpRounds.winnerUserId} IS NULL THEN 1 ELSE 0 END)`,
    })
    .from(pvpRounds)
    .where(and(inArray(pvpRounds.matchId, ids), eq(pvpRounds.status, 'completed')))
    .groupBy(pvpRounds.matchId);

  return rows
    .filter((row) => typeof row.matchId === 'string' && row.matchId.length > 0)
    .map((row) => ({
      match_id: row.matchId as string,
      total_rounds: toInt(row.totalRounds, 0),
      wins: toInt(row.wins, 0),
      losses: toInt(row.losses, 0),
      draws: toInt(row.draws, 0),
    }));
};

export const countPvpMatchesByUserId = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number> => {
  const rows = await db
    .select({
      total: sql<number>`COUNT(1)`,
    })
    .from(pvpMatchPlayers)
    .where(eq(pvpMatchPlayers.userId, userId));

  return Math.max(0, toInt(rows[0]?.total, 0));
};

export const hasPvpMatchPlayer = async (
  db: AppDrizzleDb,
  matchId: string,
  userId: number,
): Promise<boolean> => {
  const rows = await db
    .select({
      ok: sql<number>`1`,
    })
    .from(pvpMatchPlayers)
    .where(and(eq(pvpMatchPlayers.matchId, matchId), eq(pvpMatchPlayers.userId, userId)))
    .limit(1);

  return rows.length > 0;
};

export const listPvpMatchPlayersByMatchId = async (
  db: AppDrizzleDb,
  matchId: string,
): Promise<PvpMatchPlayerDbRow[]> => {
  const rows = await db
    .select({
      matchId: pvpMatchPlayers.matchId,
      userId: pvpMatchPlayers.userId,
      seat: pvpMatchPlayers.seat,
      username: pvpMatchPlayers.username,
      userPrefix: pvpMatchPlayers.userPrefix,
      joinedAt: pvpMatchPlayers.joinedAt,
    })
    .from(pvpMatchPlayers)
    .where(eq(pvpMatchPlayers.matchId, matchId))
    .orderBy(asc(pvpMatchPlayers.seat));

  return rows.map((row) => ({
    match_id: row.matchId,
    user_id: toInt(row.userId, 0),
    seat: toInt(row.seat, 0),
    username: typeof row.username === 'string' ? row.username : null,
    user_prefix: typeof row.userPrefix === 'string' ? row.userPrefix : null,
    joined_at: row.joinedAt,
  }));
};

export const insertPvpMatch = async (
  db: AppDrizzleDb,
  input: {
    id: string;
    roomId: string;
    rulesJson: string;
    participants: number;
    startedAt: string;
    nowIso: string;
  },
): Promise<boolean> => {
  const inserted = await db
    .insert(pvpMatches)
    .values({
      id: input.id,
      roomId: input.roomId,
      status: 'active',
      rulesJson: input.rulesJson,
      participants: input.participants,
      startedAt: input.startedAt,
      endedAt: null,
      winnerUserId: null,
      resultJson: null,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    })
    .returning({
      id: pvpMatches.id,
    });

  return inserted.length > 0;
};

export const upsertPvpMatchPlayers = async (
  db: AppDrizzleDb,
  matchId: string,
  players: Array<{ userId: number; seat: number; username: string | null; userPrefix: string | null; joinedAt: string }>,
): Promise<void> => {
  for (const p of players) {
    await db
      .insert(pvpMatchPlayers)
      .values({
        matchId,
        userId: p.userId,
        seat: p.seat,
        username: p.username,
        userPrefix: p.userPrefix,
        joinedAt: p.joinedAt,
      })
      .onConflictDoUpdate({
        target: [pvpMatchPlayers.matchId, pvpMatchPlayers.userId],
        set: {
          seat: p.seat,
          username: p.username,
          userPrefix: p.userPrefix,
          joinedAt: p.joinedAt,
        },
      });
  }
};

export const updatePvpMatchPatch = async (
  db: AppDrizzleDb,
  matchId: string,
  patch: { status?: PvpMatchStatus; endedAt?: string | null; winnerUserId?: number | null; resultJson?: string | null },
  nowIso: string,
): Promise<number> => {
  const setPayload: {
    status?: PvpMatchStatus;
    endedAt?: string | null;
    winnerUserId?: number | null;
    resultJson?: string | null;
    updatedAt: string;
  } = {
    updatedAt: nowIso,
  };

  if (patch.status !== undefined) setPayload.status = patch.status;
  if (patch.endedAt !== undefined) setPayload.endedAt = patch.endedAt;
  if (patch.winnerUserId !== undefined) setPayload.winnerUserId = patch.winnerUserId;
  if (patch.resultJson !== undefined) setPayload.resultJson = patch.resultJson;
  if (Object.keys(setPayload).length <= 1) return 0;

  const updated = await db
    .update(pvpMatches)
    .set(setPayload)
    .where(eq(pvpMatches.id, matchId))
    .returning({
      id: pvpMatches.id,
    });

  return updated.length;
};

export const getPvpMatchByIdRow = async (
  db: AppDrizzleDb,
  matchId: string,
): Promise<PvpMatchDbRow | null> => {
  const rows = await db
    .select({
      id: pvpMatches.id,
      roomId: pvpMatches.roomId,
      status: pvpMatches.status,
      rulesJson: pvpMatches.rulesJson,
      participants: pvpMatches.participants,
      startedAt: pvpMatches.startedAt,
      endedAt: pvpMatches.endedAt,
      winnerUserId: pvpMatches.winnerUserId,
      resultJson: pvpMatches.resultJson,
      createdAt: pvpMatches.createdAt,
      updatedAt: pvpMatches.updatedAt,
    })
    .from(pvpMatches)
    .where(eq(pvpMatches.id, matchId))
    .limit(1);

  if (rows.length === 0) return null;
  return mapPvpMatchRow(rows[0]);
};

export const listPvpRoomChatMessages = async (
  db: AppDrizzleDb,
  input: {
    roomId: string;
    limit: number;
    afterId: number | null;
  },
): Promise<PvpRoomChatMessageDbRow[]> => {
  const baseSelect = {
    id: pvpRoomChatMessages.id,
    roomId: pvpRoomChatMessages.roomId,
    senderUserId: pvpRoomChatMessages.senderUserId,
    senderRole: pvpRoomChatMessages.senderRole,
    senderUsername: pvpRoomChatMessages.senderUsername,
    senderPrefix: pvpRoomChatMessages.senderPrefix,
    contentJson: pvpRoomChatMessages.contentJson,
    renderedText: pvpRoomChatMessages.renderedText,
    stickerId: pvpRoomChatMessages.stickerId,
    emojiText: pvpRoomChatMessages.emojiText,
    createdAt: pvpRoomChatMessages.createdAt,
  };

  const rows = input.afterId !== null && input.afterId > 0
    ? await db
        .select(baseSelect)
        .from(pvpRoomChatMessages)
        .where(and(eq(pvpRoomChatMessages.roomId, input.roomId), gt(pvpRoomChatMessages.id, input.afterId)))
        .orderBy(asc(pvpRoomChatMessages.id))
        .limit(input.limit)
    : await db
        .select(baseSelect)
        .from(pvpRoomChatMessages)
        .where(eq(pvpRoomChatMessages.roomId, input.roomId))
        .orderBy(desc(pvpRoomChatMessages.id))
        .limit(input.limit);

  const mapped = rows.map((row) => {
    const senderRole: PvpRoomMemberRole = row.senderRole === 'spectator' ? 'spectator' : 'player';
    return {
      id: toInt(row.id, 0),
      room_id: row.roomId,
      sender_user_id: toInt(row.senderUserId, 0),
      sender_role: senderRole,
      sender_username: row.senderUsername,
      sender_prefix: typeof row.senderPrefix === 'string' ? row.senderPrefix : null,
      content_json: row.contentJson,
      rendered_text: typeof row.renderedText === 'string' ? row.renderedText : null,
      sticker_id: typeof row.stickerId === 'string' ? row.stickerId : null,
      emoji_text: typeof row.emojiText === 'string' ? row.emojiText : null,
      created_at: row.createdAt,
    };
  });

  if (input.afterId !== null && input.afterId > 0) return mapped;
  return mapped.slice().reverse();
};

export const getLatestPvpRoomChatMessageBySender = async (
  db: AppDrizzleDb,
  input: {
    roomId: string;
    userId: number;
  },
): Promise<{ id: number; created_at: string } | null> => {
  const rows = await db
    .select({
      id: pvpRoomChatMessages.id,
      createdAt: pvpRoomChatMessages.createdAt,
    })
    .from(pvpRoomChatMessages)
    .where(and(eq(pvpRoomChatMessages.roomId, input.roomId), eq(pvpRoomChatMessages.senderUserId, input.userId)))
    .orderBy(desc(pvpRoomChatMessages.id))
    .limit(1);

  if (rows.length === 0) return null;
  return {
    id: toInt(rows[0].id, 0),
    created_at: rows[0].createdAt,
  };
};

export const insertPvpRoomChatMessage = async (
  db: AppDrizzleDb,
  input: {
    roomId: string;
    senderUserId: number;
    senderRole: PvpRoomMemberRole;
    senderUsername: string;
    senderPrefix?: string | null;
    contentJson: string;
    renderedText?: string | null;
    stickerId?: string | null;
    emojiText?: string | null;
    createdAt: string;
  },
): Promise<number | null> => {
  const inserted = await db
    .insert(pvpRoomChatMessages)
    .values({
      roomId: input.roomId,
      senderUserId: input.senderUserId,
      senderRole: input.senderRole,
      senderUsername: input.senderUsername,
      senderPrefix: input.senderPrefix ?? null,
      contentJson: input.contentJson,
      renderedText: input.renderedText ?? null,
      stickerId: input.stickerId ?? null,
      emojiText: input.emojiText ?? null,
      createdAt: input.createdAt,
    })
    .returning({
      id: pvpRoomChatMessages.id,
    });

  if (inserted.length === 0) return null;
  return toInt(inserted[0].id, 0);
};
