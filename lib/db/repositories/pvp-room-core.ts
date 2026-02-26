import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  dataCards,
  pvpRoomCardSnapshots,
  pvpRoomChatMessages,
  pvpRoomHands,
  pvpRoomPlayers,
  pvpRooms,
  pvpRoomSubmissions,
  pvpRoundChoices,
  pvpRounds,
  users,
} from '@/lib/db/schema';

type PvpRoomMemberRole = 'player' | 'spectator';
type PvpRoomStatus = 'open' | 'closed';

export type PvpRoomDbRow = {
  id: string;
  host_user_id: number;
  status: PvpRoomStatus;
  phase: string;
  rules_json: string;
  current_match_id: string | null;
  join_code_hash: string | null;
  join_code_salt: string | null;
  version: number;
  expires_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PvpRoomPlayerDbRow = {
  room_id: string;
  user_id: number;
  role: PvpRoomMemberRole;
  seat: number | null;
  joined_at: string;
  username?: string;
  prefix?: string | null;
};

export type PvpRoomBrowseDbRow = PvpRoomDbRow & {
  host_username: string;
  host_prefix: string | null;
  player_count: number;
};

export type PvpRoomSubmissionDbRow = {
  room_id: string;
  user_id: number;
  submission_json: string;
  created_at: string;
  updated_at: string;
};

export type PvpRoomHandDbRow = {
  room_id: string;
  user_id: number;
  hand_json: string;
  created_at: string;
  updated_at: string;
};

export type PvpCardSnapshotDbRow = {
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

export type PvpEligibleDataCardDbRow = {
  id: string;
  user_id: number;
  type: string;
  name: string;
  description: string | null;
  data: string;
  is_public: number;
  usage_count: number | null;
  like_count: number | null;
  favorite_count: number | null;
  review_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  username: string;
  prefix: string | null;
  author_is_banned: string | null;
};

type PvpRoomBrowseInput = {
  query?: string;
  mode?: string;
  password?: 'any' | 'yes' | 'no';
  phase?: 'any' | 'waiting' | 'submitting';
  phaseScope?: 'joinable' | 'open';
  limit?: number;
  offset?: number;
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

const cardLikeModePattern = (mode: string): string => `%\"mode\":\"${mode}\"%`;

const playerCountExpr = sql<number>`(
  SELECT COUNT(*)
  FROM pvp_room_players p
  WHERE p.room_id = ${pvpRooms.id} AND p.role = 'player'
)`;

const mapRoomRow = (row: {
  id: string;
  hostUserId: number;
  status: string;
  phase: string;
  rulesJson: string;
  currentMatchId: string | null;
  joinCodeHash: string | null;
  joinCodeSalt: string | null;
  version: number;
  expiresAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}): PvpRoomDbRow => ({
  id: row.id,
  host_user_id: toInt(row.hostUserId, 0),
  status: row.status === 'closed' ? 'closed' : 'open',
  phase: row.phase,
  rules_json: row.rulesJson,
  current_match_id: typeof row.currentMatchId === 'string' ? row.currentMatchId : null,
  join_code_hash: typeof row.joinCodeHash === 'string' ? row.joinCodeHash : null,
  join_code_salt: typeof row.joinCodeSalt === 'string' ? row.joinCodeSalt : null,
  version: toInt(row.version, 0),
  expires_at: typeof row.expiresAt === 'string' ? row.expiresAt : null,
  last_activity_at: typeof row.lastActivityAt === 'string' ? row.lastActivityAt : null,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export const insertPvpRoomWithHostPlayer = async (
  db: AppDrizzleDb,
  payload: {
    roomId: string;
    hostUserId: number;
    status: PvpRoomStatus;
    phase: string;
    rulesJson: string;
    joinCodeHash?: string | null;
    joinCodeSalt?: string | null;
    expiresAt?: string | null;
    nowIso: string;
  },
): Promise<boolean> => {
  const inserted = await db
    .insert(pvpRooms)
    .values({
      id: payload.roomId,
      hostUserId: payload.hostUserId,
      status: payload.status,
      phase: payload.phase,
      rulesJson: payload.rulesJson,
      currentMatchId: null,
      joinCodeHash: payload.joinCodeHash ?? null,
      joinCodeSalt: payload.joinCodeSalt ?? null,
      version: 0,
      expiresAt: payload.expiresAt ?? null,
      lastActivityAt: payload.nowIso,
      createdAt: payload.nowIso,
      updatedAt: payload.nowIso,
    })
    .returning({
      id: pvpRooms.id,
    });

  if (inserted.length === 0) return false;

  await db
    .insert(pvpRoomPlayers)
    .values({
      roomId: payload.roomId,
      userId: payload.hostUserId,
      role: 'player',
      seat: 0,
      joinedAt: payload.nowIso,
    })
    .onConflictDoNothing();

  return true;
};

export const getPvpRoomByIdRow = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<PvpRoomDbRow | null> => {
  const rows = await db
    .select({
      id: pvpRooms.id,
      hostUserId: pvpRooms.hostUserId,
      status: pvpRooms.status,
      phase: pvpRooms.phase,
      rulesJson: pvpRooms.rulesJson,
      currentMatchId: pvpRooms.currentMatchId,
      joinCodeHash: pvpRooms.joinCodeHash,
      joinCodeSalt: pvpRooms.joinCodeSalt,
      version: pvpRooms.version,
      expiresAt: pvpRooms.expiresAt,
      lastActivityAt: pvpRooms.lastActivityAt,
      createdAt: pvpRooms.createdAt,
      updatedAt: pvpRooms.updatedAt,
    })
    .from(pvpRooms)
    .where(eq(pvpRooms.id, roomId))
    .limit(1);

  if (rows.length === 0) return null;
  return mapRoomRow(rows[0]);
};

export const listPvpRoomPlayersByRole = async (
  db: AppDrizzleDb,
  roomId: string,
  role: PvpRoomMemberRole,
): Promise<PvpRoomPlayerDbRow[]> => {
  const rows = await db
    .select({
      roomId: pvpRoomPlayers.roomId,
      userId: pvpRoomPlayers.userId,
      role: pvpRoomPlayers.role,
      seat: pvpRoomPlayers.seat,
      joinedAt: pvpRoomPlayers.joinedAt,
      username: users.username,
      prefix: users.prefix,
    })
    .from(pvpRoomPlayers)
    .innerJoin(users, eq(users.id, pvpRoomPlayers.userId))
    .where(and(eq(pvpRoomPlayers.roomId, roomId), eq(pvpRoomPlayers.role, role)))
    .orderBy(asc(pvpRoomPlayers.seat), asc(pvpRoomPlayers.joinedAt));

  return rows.map((row) => ({
    room_id: row.roomId,
    user_id: toInt(row.userId, 0),
    role: row.role === 'spectator' ? 'spectator' : 'player',
    seat: toIntOrNull(row.seat),
    joined_at: row.joinedAt,
    username: row.username,
    prefix: typeof row.prefix === 'string' ? row.prefix : null,
  }));
};

export const listPvpRoomMembers = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<PvpRoomPlayerDbRow[]> => {
  const rows = await db
    .select({
      roomId: pvpRoomPlayers.roomId,
      userId: pvpRoomPlayers.userId,
      role: pvpRoomPlayers.role,
      seat: pvpRoomPlayers.seat,
      joinedAt: pvpRoomPlayers.joinedAt,
      username: users.username,
      prefix: users.prefix,
    })
    .from(pvpRoomPlayers)
    .innerJoin(users, eq(users.id, pvpRoomPlayers.userId))
    .where(eq(pvpRoomPlayers.roomId, roomId))
    .orderBy(
      sql`CASE WHEN ${pvpRoomPlayers.role} = 'player' THEN 0 ELSE 1 END`,
      asc(pvpRoomPlayers.seat),
      asc(pvpRoomPlayers.joinedAt),
    );

  return rows.map((row) => ({
    room_id: row.roomId,
    user_id: toInt(row.userId, 0),
    role: row.role === 'spectator' ? 'spectator' : 'player',
    seat: toIntOrNull(row.seat),
    joined_at: row.joinedAt,
    username: row.username,
    prefix: typeof row.prefix === 'string' ? row.prefix : null,
  }));
};

export const listPvpRoomBrowseRows = async (
  db: AppDrizzleDb,
  input: PvpRoomBrowseInput,
): Promise<PvpRoomBrowseDbRow[]> => {
  const conditions: SQL[] = [eq(pvpRooms.status, 'open')];

  const phaseScope = input.phaseScope ?? 'joinable';
  const phase = input.phase ?? 'any';
  if (phase === 'waiting' || phase === 'submitting') {
    conditions.push(eq(pvpRooms.phase, phase));
  } else if (phaseScope === 'joinable') {
    conditions.push(inArray(pvpRooms.phase, ['waiting', 'submitting']));
  } else {
    conditions.push(ne(pvpRooms.phase, 'closed'));
  }

  const nowIso = new Date().toISOString();
  conditions.push(or(isNull(pvpRooms.expiresAt), gt(pvpRooms.expiresAt, nowIso))!);

  const password = input.password ?? 'any';
  if (password === 'yes') conditions.push(isNotNull(pvpRooms.joinCodeHash));
  if (password === 'no') conditions.push(isNull(pvpRooms.joinCodeHash));

  const q = typeof input.query === 'string' ? input.query.trim() : '';
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(like(pvpRooms.id, pattern), like(users.username, pattern))!);
  }

  const mode = typeof input.mode === 'string' ? input.mode.trim() : '';
  if (mode && mode !== 'all') {
    conditions.push(sql`${pvpRooms.rulesJson} LIKE ${cardLikeModePattern(mode)}`);
  }

  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(200, Math.floor(input.limit as number))) : 50;
  const offset = Number.isFinite(input.offset) ? Math.max(0, Math.floor(input.offset as number)) : 0;

  const rows = await db
    .select({
      id: pvpRooms.id,
      hostUserId: pvpRooms.hostUserId,
      status: pvpRooms.status,
      phase: pvpRooms.phase,
      rulesJson: pvpRooms.rulesJson,
      currentMatchId: pvpRooms.currentMatchId,
      joinCodeHash: pvpRooms.joinCodeHash,
      joinCodeSalt: pvpRooms.joinCodeSalt,
      version: pvpRooms.version,
      expiresAt: pvpRooms.expiresAt,
      lastActivityAt: pvpRooms.lastActivityAt,
      createdAt: pvpRooms.createdAt,
      updatedAt: pvpRooms.updatedAt,
      hostUsername: users.username,
      hostPrefix: users.prefix,
      playerCount: playerCountExpr,
    })
    .from(pvpRooms)
    .innerJoin(users, eq(users.id, pvpRooms.hostUserId))
    .where(and(...conditions))
    .orderBy(desc(sql`COALESCE(${pvpRooms.lastActivityAt}, ${pvpRooms.updatedAt})`))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    ...mapRoomRow(row),
    host_username: row.hostUsername,
    host_prefix: typeof row.hostPrefix === 'string' ? row.hostPrefix : null,
    player_count: toInt(row.playerCount, 0),
  }));
};

export const insertPvpRoomPlayerIgnore = async (
  db: AppDrizzleDb,
  payload: {
    roomId: string;
    userId: number;
    seat: number | null;
    role: PvpRoomMemberRole;
    joinedAt: string;
  },
): Promise<void> => {
  await db
    .insert(pvpRoomPlayers)
    .values({
      roomId: payload.roomId,
      userId: payload.userId,
      role: payload.role,
      seat: payload.seat,
      joinedAt: payload.joinedAt,
    })
    .onConflictDoNothing();
};

export const updatePvpRoomMember = async (
  db: AppDrizzleDb,
  input: {
    roomId: string;
    userId: number;
    role: PvpRoomMemberRole;
    seat: number | null;
  },
): Promise<number> => {
  const updated = await db
    .update(pvpRoomPlayers)
    .set({
      role: input.role,
      seat: input.seat,
    })
    .where(and(eq(pvpRoomPlayers.roomId, input.roomId), eq(pvpRoomPlayers.userId, input.userId)))
    .returning({
      roomId: pvpRoomPlayers.roomId,
    });

  return updated.length;
};

export const deletePvpRoomPlayer = async (
  db: AppDrizzleDb,
  roomId: string,
  userId: number,
): Promise<void> => {
  await db
    .delete(pvpRoomPlayers)
    .where(and(eq(pvpRoomPlayers.roomId, roomId), eq(pvpRoomPlayers.userId, userId)));
};

export const updatePvpRoomByCas = async (
  db: AppDrizzleDb,
  input: {
    roomId: string;
    expectedVersion: number;
    patch: {
      status?: string;
      phase?: string;
      rulesJson?: string;
      currentMatchId?: string | null;
      joinCodeHash?: string | null;
      joinCodeSalt?: string | null;
      expiresAt?: string | null;
      lastActivityAt?: string | null;
    };
    nowIso: string;
  },
): Promise<number> => {
  const setPayload: {
    status?: string;
    phase?: string;
    rulesJson?: string;
    currentMatchId?: string | null;
    joinCodeHash?: string | null;
    joinCodeSalt?: string | null;
    expiresAt?: string | null;
    lastActivityAt?: string | null;
    updatedAt: string;
    version: SQL;
  } = {
    updatedAt: input.nowIso,
    version: sql`${pvpRooms.version} + 1`,
  };

  if (input.patch.status !== undefined) setPayload.status = input.patch.status;
  if (input.patch.phase !== undefined) setPayload.phase = input.patch.phase;
  if (input.patch.rulesJson !== undefined) setPayload.rulesJson = input.patch.rulesJson;
  if (input.patch.currentMatchId !== undefined) setPayload.currentMatchId = input.patch.currentMatchId;
  if (input.patch.joinCodeHash !== undefined) setPayload.joinCodeHash = input.patch.joinCodeHash;
  if (input.patch.joinCodeSalt !== undefined) setPayload.joinCodeSalt = input.patch.joinCodeSalt;
  if (input.patch.expiresAt !== undefined) setPayload.expiresAt = input.patch.expiresAt;
  if (input.patch.lastActivityAt !== undefined) setPayload.lastActivityAt = input.patch.lastActivityAt;

  const updated = await db
    .update(pvpRooms)
    .set(setPayload)
    .where(and(eq(pvpRooms.id, input.roomId), eq(pvpRooms.version, input.expectedVersion)))
    .returning({
      id: pvpRooms.id,
    });

  return updated.length;
};

export const upsertPvpRoomSubmission = async (
  db: AppDrizzleDb,
  input: {
    roomId: string;
    userId: number;
    submissionJson: string;
    nowIso: string;
  },
): Promise<void> => {
  await db
    .insert(pvpRoomSubmissions)
    .values({
      roomId: input.roomId,
      userId: input.userId,
      submissionJson: input.submissionJson,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    })
    .onConflictDoUpdate({
      target: [pvpRoomSubmissions.roomId, pvpRoomSubmissions.userId],
      set: {
        submissionJson: input.submissionJson,
        updatedAt: input.nowIso,
      },
    });
};

export const listPvpRoomSubmissionsByRoomId = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<PvpRoomSubmissionDbRow[]> => {
  const rows = await db
    .select({
      roomId: pvpRoomSubmissions.roomId,
      userId: pvpRoomSubmissions.userId,
      submissionJson: pvpRoomSubmissions.submissionJson,
      createdAt: pvpRoomSubmissions.createdAt,
      updatedAt: pvpRoomSubmissions.updatedAt,
    })
    .from(pvpRoomSubmissions)
    .where(eq(pvpRoomSubmissions.roomId, roomId))
    .orderBy(asc(pvpRoomSubmissions.updatedAt));

  return rows.map((row) => ({
    room_id: row.roomId,
    user_id: toInt(row.userId, 0),
    submission_json: row.submissionJson,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));
};

export const deletePvpRoomSubmission = async (
  db: AppDrizzleDb,
  roomId: string,
  userId: number,
): Promise<void> => {
  await db
    .delete(pvpRoomSubmissions)
    .where(and(eq(pvpRoomSubmissions.roomId, roomId), eq(pvpRoomSubmissions.userId, userId)));
};

const selectPvpEligibleDataCardRow = async (
  db: AppDrizzleDb,
  cardId: string,
  requestUserId: number,
  scenarioOnly: boolean,
): Promise<PvpEligibleDataCardDbRow | null> => {
  const rows = await db
    .select({
      id: dataCards.id,
      userId: dataCards.userId,
      type: dataCards.type,
      name: dataCards.name,
      description: dataCards.description,
      data: dataCards.data,
      isPublic: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      usageCount: dataCards.usageCount,
      likeCount: dataCards.likeCount,
      favoriteCount: dataCards.favoriteCount,
      reviewStatus: dataCards.reviewStatus,
      createdAt: dataCards.createdAt,
      updatedAt: dataCards.updatedAt,
      deletedAt: dataCards.deletedAt,
      username: users.username,
      prefix: users.prefix,
      authorIsBanned: users.isBanned,
    })
    .from(dataCards)
    .innerJoin(users, eq(users.id, dataCards.userId))
    .where(
      and(
        eq(dataCards.id, cardId),
        scenarioOnly ? eq(dataCards.type, 'scenario') : undefined,
        isNull(dataCards.deletedAt),
        sql`${dataCards.isPublic} != -1`,
        scenarioOnly
          ? eq(dataCards.reviewStatus, 'approved')
          : inArray(dataCards.reviewStatus, ['approved', 'pending']),
        or(eq(dataCards.userId, requestUserId), sql`${dataCards.isPublic} = 1`)!,
        or(isNull(users.isBanned), eq(users.isBanned, ''))!,
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    user_id: toInt(row.userId, 0),
    type: row.type,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : null,
    data: row.data,
    is_public: toInt(row.isPublic, 0),
    usage_count: toIntOrNull(row.usageCount),
    like_count: toIntOrNull(row.likeCount),
    favorite_count: toIntOrNull(row.favoriteCount),
    review_status: typeof row.reviewStatus === 'string' ? row.reviewStatus : null,
    created_at: typeof row.createdAt === 'string' ? row.createdAt : null,
    updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    deleted_at: typeof row.deletedAt === 'string' ? row.deletedAt : null,
    username: row.username,
    prefix: typeof row.prefix === 'string' ? row.prefix : null,
    author_is_banned: typeof row.authorIsBanned === 'string' ? row.authorIsBanned : null,
  };
};

export const getPvpEligibleDataCardById = async (
  db: AppDrizzleDb,
  cardId: string,
  requestUserId: number,
): Promise<PvpEligibleDataCardDbRow | null> => {
  return selectPvpEligibleDataCardRow(db, cardId, requestUserId, false);
};

export const getPvpEligibleScenarioDataCardById = async (
  db: AppDrizzleDb,
  cardId: string,
  requestUserId: number,
): Promise<PvpEligibleDataCardDbRow | null> => {
  return selectPvpEligibleDataCardRow(db, cardId, requestUserId, true);
};

export const clearPvpRoomMatchStateByRoomId = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<void> => {
  await db.delete(pvpRoomHands).where(eq(pvpRoomHands.roomId, roomId));
  await db.delete(pvpRoomSubmissions).where(eq(pvpRoomSubmissions.roomId, roomId));
  await db.delete(pvpRoomCardSnapshots).where(eq(pvpRoomCardSnapshots.roomId, roomId));
};

export const clearPvpRoomEphemeralStateByRoomId = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<void> => {
  await clearPvpRoomMatchStateByRoomId(db, roomId);
  await db.delete(pvpRoomChatMessages).where(eq(pvpRoomChatMessages.roomId, roomId));

  const roundIdSubquery = db
    .select({
      id: pvpRounds.id,
    })
    .from(pvpRounds)
    .where(eq(pvpRounds.roomId, roomId));

  await db
    .delete(pvpRoundChoices)
    .where(inArray(pvpRoundChoices.roundId, roundIdSubquery));
};

export const upsertPvpRoomHand = async (
  db: AppDrizzleDb,
  input: {
    roomId: string;
    userId: number;
    handJson: string;
    nowIso: string;
  },
): Promise<void> => {
  await db
    .insert(pvpRoomHands)
    .values({
      roomId: input.roomId,
      userId: input.userId,
      handJson: input.handJson,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    })
    .onConflictDoUpdate({
      target: [pvpRoomHands.roomId, pvpRoomHands.userId],
      set: {
        handJson: input.handJson,
        updatedAt: input.nowIso,
      },
    });
};

export const deletePvpRoomHand = async (
  db: AppDrizzleDb,
  roomId: string,
  userId: number,
): Promise<void> => {
  await db
    .delete(pvpRoomHands)
    .where(and(eq(pvpRoomHands.roomId, roomId), eq(pvpRoomHands.userId, userId)));
};

export const listPvpRoomHandsByRoomId = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<PvpRoomHandDbRow[]> => {
  const rows = await db
    .select({
      roomId: pvpRoomHands.roomId,
      userId: pvpRoomHands.userId,
      handJson: pvpRoomHands.handJson,
      createdAt: pvpRoomHands.createdAt,
      updatedAt: pvpRoomHands.updatedAt,
    })
    .from(pvpRoomHands)
    .where(eq(pvpRoomHands.roomId, roomId));

  return rows.map((row) => ({
    room_id: row.roomId,
    user_id: toInt(row.userId, 0),
    hand_json: row.handJson,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));
};

export const insertPvpCardSnapshot = async (
  db: AppDrizzleDb,
  input: {
    snapshotId: string;
    roomId: string;
    ownerUserId: number;
    refJson: string;
    cardType: string;
    name: string;
    dataJson: string;
    sourceUpdatedAt?: string | null;
    createdAt: string;
  },
): Promise<boolean> => {
  const inserted = await db
    .insert(pvpRoomCardSnapshots)
    .values({
      id: input.snapshotId,
      roomId: input.roomId,
      ownerUserId: input.ownerUserId,
      refJson: input.refJson,
      cardType: input.cardType,
      name: input.name,
      dataJson: input.dataJson,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      createdAt: input.createdAt,
    })
    .returning({
      id: pvpRoomCardSnapshots.id,
    });

  return inserted.length > 0;
};

export const listPvpCardSnapshotsByRoomId = async (
  db: AppDrizzleDb,
  roomId: string,
): Promise<PvpCardSnapshotDbRow[]> => {
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
    .where(eq(pvpRoomCardSnapshots.roomId, roomId))
    .orderBy(asc(pvpRoomCardSnapshots.createdAt));

  return rows.map((row) => ({
    id: row.id,
    room_id: row.roomId,
    owner_user_id: toInt(row.ownerUserId, 0),
    ref_json: row.refJson,
    card_type: row.cardType,
    name: row.name,
    data_json: row.dataJson,
    source_updated_at: typeof row.sourceUpdatedAt === 'string' ? row.sourceUpdatedAt : null,
    created_at: row.createdAt,
  }));
};
