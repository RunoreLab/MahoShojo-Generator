import { generateUUID } from './core';

export type PvpRoomStatus = 'open' | 'closed';
export type PvpRoomPhase =
  | 'waiting'
  | 'submitting'
  | 'dealing'
  | 'choosing'
  | 'voting'
  | 'reviewing'
  | 'resolving'
  | 'advancing'
  | 'finished'
  | 'aborted'
  | 'closed';

export type PvpRoomMemberRole = 'player' | 'spectator';

export interface PvpRoomRow {
  id: string;
  host_user_id: number;
  status: PvpRoomStatus;
  phase: PvpRoomPhase;
  rules_json: string;
  current_match_id: string | null;
  join_code_hash: string | null;
  join_code_salt: string | null;
  version: number;
  expires_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PvpRoomPlayerRow {
  room_id: string;
  user_id: number;
  role: PvpRoomMemberRole;
  seat: number | null;
  joined_at: string;
  username?: string;
  prefix?: string | null;
}

export type PvpRoomBrowseRow = PvpRoomRow & {
  host_username: string;
  host_prefix: string | null;
  player_count: number;
};

export type PvpRoundStatus = 'pending' | 'resolving' | 'completed' | 'aborted';

export interface CreatePvpRoomInput {
  hostUserId: number;
  rulesJson: string;
  joinCodeHash?: string | null;
  joinCodeSalt?: string | null;
  expiresAt?: string | null;
}

type PvpRoomCoreRepoBundle = {
  db: unknown;
  insertPvpRoomWithHostPlayer: (
    db: unknown,
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
  ) => Promise<boolean>;
  getPvpRoomByIdRow: (db: unknown, roomId: string) => Promise<PvpRoomRow | null>;
  listPvpRoomPlayersByRole: (db: unknown, roomId: string, role: PvpRoomMemberRole) => Promise<PvpRoomPlayerRow[]>;
  listPvpRoomMembers: (db: unknown, roomId: string) => Promise<PvpRoomPlayerRow[]>;
  listPvpRoomBrowseRows: (
    db: unknown,
    input: {
      query?: string;
      mode?: string;
      password?: 'any' | 'yes' | 'no';
      phase?: 'any' | 'waiting' | 'submitting';
      phaseScope?: 'joinable' | 'open';
      limit?: number;
      offset?: number;
    },
  ) => Promise<PvpRoomBrowseRow[]>;
  insertPvpRoomPlayerIgnore: (
    db: unknown,
    payload: {
      roomId: string;
      userId: number;
      seat: number | null;
      role: PvpRoomMemberRole;
      joinedAt: string;
    },
  ) => Promise<void>;
  updatePvpRoomMember: (
    db: unknown,
    input: {
      roomId: string;
      userId: number;
      role: PvpRoomMemberRole;
      seat: number | null;
    },
  ) => Promise<number>;
  deletePvpRoomPlayer: (db: unknown, roomId: string, userId: number) => Promise<void>;
  updatePvpRoomByCas: (
    db: unknown,
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
  ) => Promise<number>;
  upsertPvpRoomSubmission: (
    db: unknown,
    input: {
      roomId: string;
      userId: number;
      submissionJson: string;
      nowIso: string;
    },
  ) => Promise<void>;
  listPvpRoomSubmissionsByRoomId: (db: unknown, roomId: string) => Promise<PvpRoomSubmissionRow[]>;
  deletePvpRoomSubmission: (db: unknown, roomId: string, userId: number) => Promise<void>;
  getPvpEligibleDataCardById: (db: unknown, cardId: string, requestUserId: number) => Promise<PvpEligibleDataCardRow | null>;
  getPvpEligibleScenarioDataCardById: (db: unknown, cardId: string, requestUserId: number) => Promise<PvpEligibleDataCardRow | null>;
  clearPvpRoomMatchStateByRoomId: (db: unknown, roomId: string) => Promise<void>;
  clearPvpRoomEphemeralStateByRoomId: (db: unknown, roomId: string) => Promise<void>;
  upsertPvpRoomHand: (
    db: unknown,
    input: {
      roomId: string;
      userId: number;
      handJson: string;
      nowIso: string;
    },
  ) => Promise<void>;
  deletePvpRoomHand: (db: unknown, roomId: string, userId: number) => Promise<void>;
  listPvpRoomHandsByRoomId: (db: unknown, roomId: string) => Promise<PvpRoomHandRow[]>;
  insertPvpCardSnapshot: (
    db: unknown,
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
  ) => Promise<boolean>;
  listPvpCardSnapshotsByRoomId: (db: unknown, roomId: string) => Promise<PvpCardSnapshotRow[]>;
};

const readPvpRoomCoreRepoBundle = async (): Promise<PvpRoomCoreRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/pvp-room-core'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      insertPvpRoomWithHostPlayer: repo.insertPvpRoomWithHostPlayer as PvpRoomCoreRepoBundle['insertPvpRoomWithHostPlayer'],
      getPvpRoomByIdRow: repo.getPvpRoomByIdRow as PvpRoomCoreRepoBundle['getPvpRoomByIdRow'],
      listPvpRoomPlayersByRole: repo.listPvpRoomPlayersByRole as PvpRoomCoreRepoBundle['listPvpRoomPlayersByRole'],
      listPvpRoomMembers: repo.listPvpRoomMembers as PvpRoomCoreRepoBundle['listPvpRoomMembers'],
      listPvpRoomBrowseRows: repo.listPvpRoomBrowseRows as PvpRoomCoreRepoBundle['listPvpRoomBrowseRows'],
      insertPvpRoomPlayerIgnore: repo.insertPvpRoomPlayerIgnore as PvpRoomCoreRepoBundle['insertPvpRoomPlayerIgnore'],
      updatePvpRoomMember: repo.updatePvpRoomMember as PvpRoomCoreRepoBundle['updatePvpRoomMember'],
      deletePvpRoomPlayer: repo.deletePvpRoomPlayer as PvpRoomCoreRepoBundle['deletePvpRoomPlayer'],
      updatePvpRoomByCas: repo.updatePvpRoomByCas as PvpRoomCoreRepoBundle['updatePvpRoomByCas'],
      upsertPvpRoomSubmission: repo.upsertPvpRoomSubmission as PvpRoomCoreRepoBundle['upsertPvpRoomSubmission'],
      listPvpRoomSubmissionsByRoomId: repo.listPvpRoomSubmissionsByRoomId as PvpRoomCoreRepoBundle['listPvpRoomSubmissionsByRoomId'],
      deletePvpRoomSubmission: repo.deletePvpRoomSubmission as PvpRoomCoreRepoBundle['deletePvpRoomSubmission'],
      getPvpEligibleDataCardById: repo.getPvpEligibleDataCardById as PvpRoomCoreRepoBundle['getPvpEligibleDataCardById'],
      getPvpEligibleScenarioDataCardById: repo.getPvpEligibleScenarioDataCardById as PvpRoomCoreRepoBundle['getPvpEligibleScenarioDataCardById'],
      clearPvpRoomMatchStateByRoomId: repo.clearPvpRoomMatchStateByRoomId as PvpRoomCoreRepoBundle['clearPvpRoomMatchStateByRoomId'],
      clearPvpRoomEphemeralStateByRoomId: repo.clearPvpRoomEphemeralStateByRoomId as PvpRoomCoreRepoBundle['clearPvpRoomEphemeralStateByRoomId'],
      upsertPvpRoomHand: repo.upsertPvpRoomHand as PvpRoomCoreRepoBundle['upsertPvpRoomHand'],
      deletePvpRoomHand: repo.deletePvpRoomHand as PvpRoomCoreRepoBundle['deletePvpRoomHand'],
      listPvpRoomHandsByRoomId: repo.listPvpRoomHandsByRoomId as PvpRoomCoreRepoBundle['listPvpRoomHandsByRoomId'],
      insertPvpCardSnapshot: repo.insertPvpCardSnapshot as PvpRoomCoreRepoBundle['insertPvpCardSnapshot'],
      listPvpCardSnapshotsByRoomId: repo.listPvpCardSnapshotsByRoomId as PvpRoomCoreRepoBundle['listPvpCardSnapshotsByRoomId'],
    };
  } catch {
    return null;
  }
};

type PvpMatchRoundChatRepoBundle = {
  db: unknown;
  insertPvpRound: (
    db: unknown,
    input: {
      roundId: string;
      roomId: string;
      matchId?: string | null;
      roundIndex: number;
      status: PvpRoundStatus;
      publicSnapshotJson?: string | null;
      createdAt: string;
    },
  ) => Promise<boolean>;
  getPvpRoundByIdRow: (db: unknown, roundId: string) => Promise<PvpRoundRow | null>;
  getLatestPvpRoundByRoomId: (db: unknown, roomId: string) => Promise<PvpRoundRow | null>;
  getLatestPvpRoundByMatchId: (db: unknown, matchId: string) => Promise<PvpRoundRow | null>;
  listPvpRoundsByRoomId: (db: unknown, roomId: string) => Promise<PvpRoundRow[]>;
  listPvpRoundsByMatchId: (db: unknown, matchId: string) => Promise<PvpRoundRow[]>;
  updatePvpRoundPatch: (
    db: unknown,
    roundId: string,
    patch: {
      status?: PvpRoundStatus;
      battleGenerationId?: string | null;
      publicSnapshotJson?: string | null;
      resultJson?: string | null;
      winnerUserId?: number | null;
      winnerName?: string | null;
    },
  ) => Promise<number>;
  upsertPvpRoundChoice: (
    db: unknown,
    input: {
      roundId: string;
      userId: number;
      choiceRefJson: string;
      nowIso: string;
    },
  ) => Promise<void>;
  listPvpRoundChoicesByRoundId: (db: unknown, roundId: string) => Promise<PvpRoundChoiceRow[]>;
  getPvpCardSnapshotByIdRow: (db: unknown, snapshotId: string) => Promise<PvpCardSnapshotRow | null>;
  listPvpUserSummariesByUserIds: (db: unknown, userIds: number[]) => Promise<PvpUserSummaryRow[]>;
  listPvpMatchesByUserId: (db: unknown, userId: number, limit: number, offset: number) => Promise<PvpMatchRow[]>;
  listPvpMatchPlayersByMatchIds: (db: unknown, matchIds: string[]) => Promise<PvpMatchPlayerRow[]>;
  listPvpMatchRoundOutcomeSummariesByMatchIds: (
    db: unknown,
    matchIds: string[],
    userId: number,
  ) => Promise<PvpMatchRoundOutcomeSummary[]>;
  countPvpMatchesByUserId: (db: unknown, userId: number) => Promise<number>;
  hasPvpMatchPlayer: (db: unknown, matchId: string, userId: number) => Promise<boolean>;
  listPvpMatchPlayersByMatchId: (db: unknown, matchId: string) => Promise<PvpMatchPlayerRow[]>;
  insertPvpMatch: (
    db: unknown,
    input: {
      id: string;
      roomId: string;
      rulesJson: string;
      participants: number;
      startedAt: string;
      nowIso: string;
    },
  ) => Promise<boolean>;
  upsertPvpMatchPlayers: (
    db: unknown,
    matchId: string,
    players: Array<{ userId: number; seat: number; username: string | null; userPrefix: string | null; joinedAt: string }>,
  ) => Promise<void>;
  updatePvpMatchPatch: (
    db: unknown,
    matchId: string,
    patch: { status?: PvpMatchStatus; endedAt?: string | null; winnerUserId?: number | null; resultJson?: string | null },
    nowIso: string,
  ) => Promise<number>;
  getPvpMatchByIdRow: (db: unknown, matchId: string) => Promise<PvpMatchRow | null>;
  listPvpRoomChatMessages: (
    db: unknown,
    input: { roomId: string; limit: number; afterId: number | null },
  ) => Promise<PvpRoomChatMessageRow[]>;
  getLatestPvpRoomChatMessageBySender: (
    db: unknown,
    input: { roomId: string; userId: number },
  ) => Promise<{ id: number; created_at: string } | null>;
  insertPvpRoomChatMessage: (
    db: unknown,
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
  ) => Promise<number | null>;
};

const readPvpMatchRoundChatRepoBundle = async (): Promise<PvpMatchRoundChatRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/pvp-match-round-chat'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      insertPvpRound: repo.insertPvpRound as PvpMatchRoundChatRepoBundle['insertPvpRound'],
      getPvpRoundByIdRow: repo.getPvpRoundByIdRow as PvpMatchRoundChatRepoBundle['getPvpRoundByIdRow'],
      getLatestPvpRoundByRoomId: repo.getLatestPvpRoundByRoomId as PvpMatchRoundChatRepoBundle['getLatestPvpRoundByRoomId'],
      getLatestPvpRoundByMatchId: repo.getLatestPvpRoundByMatchId as PvpMatchRoundChatRepoBundle['getLatestPvpRoundByMatchId'],
      listPvpRoundsByRoomId: repo.listPvpRoundsByRoomId as PvpMatchRoundChatRepoBundle['listPvpRoundsByRoomId'],
      listPvpRoundsByMatchId: repo.listPvpRoundsByMatchId as PvpMatchRoundChatRepoBundle['listPvpRoundsByMatchId'],
      updatePvpRoundPatch: repo.updatePvpRoundPatch as PvpMatchRoundChatRepoBundle['updatePvpRoundPatch'],
      upsertPvpRoundChoice: repo.upsertPvpRoundChoice as PvpMatchRoundChatRepoBundle['upsertPvpRoundChoice'],
      listPvpRoundChoicesByRoundId: repo.listPvpRoundChoicesByRoundId as PvpMatchRoundChatRepoBundle['listPvpRoundChoicesByRoundId'],
      getPvpCardSnapshotByIdRow: repo.getPvpCardSnapshotByIdRow as PvpMatchRoundChatRepoBundle['getPvpCardSnapshotByIdRow'],
      listPvpUserSummariesByUserIds: repo.listPvpUserSummariesByUserIds as PvpMatchRoundChatRepoBundle['listPvpUserSummariesByUserIds'],
      listPvpMatchesByUserId: repo.listPvpMatchesByUserId as PvpMatchRoundChatRepoBundle['listPvpMatchesByUserId'],
      listPvpMatchPlayersByMatchIds: repo.listPvpMatchPlayersByMatchIds as PvpMatchRoundChatRepoBundle['listPvpMatchPlayersByMatchIds'],
      listPvpMatchRoundOutcomeSummariesByMatchIds: repo.listPvpMatchRoundOutcomeSummariesByMatchIds as PvpMatchRoundChatRepoBundle['listPvpMatchRoundOutcomeSummariesByMatchIds'],
      countPvpMatchesByUserId: repo.countPvpMatchesByUserId as PvpMatchRoundChatRepoBundle['countPvpMatchesByUserId'],
      hasPvpMatchPlayer: repo.hasPvpMatchPlayer as PvpMatchRoundChatRepoBundle['hasPvpMatchPlayer'],
      listPvpMatchPlayersByMatchId: repo.listPvpMatchPlayersByMatchId as PvpMatchRoundChatRepoBundle['listPvpMatchPlayersByMatchId'],
      insertPvpMatch: repo.insertPvpMatch as PvpMatchRoundChatRepoBundle['insertPvpMatch'],
      upsertPvpMatchPlayers: repo.upsertPvpMatchPlayers as PvpMatchRoundChatRepoBundle['upsertPvpMatchPlayers'],
      updatePvpMatchPatch: repo.updatePvpMatchPatch as PvpMatchRoundChatRepoBundle['updatePvpMatchPatch'],
      getPvpMatchByIdRow: repo.getPvpMatchByIdRow as PvpMatchRoundChatRepoBundle['getPvpMatchByIdRow'],
      listPvpRoomChatMessages: repo.listPvpRoomChatMessages as PvpMatchRoundChatRepoBundle['listPvpRoomChatMessages'],
      getLatestPvpRoomChatMessageBySender: repo.getLatestPvpRoomChatMessageBySender as PvpMatchRoundChatRepoBundle['getLatestPvpRoomChatMessageBySender'],
      insertPvpRoomChatMessage: repo.insertPvpRoomChatMessage as PvpMatchRoundChatRepoBundle['insertPvpRoomChatMessage'],
    };
  } catch {
    return null;
  }
};

export async function createPvpRoom(input: CreatePvpRoomInput): Promise<{ roomId: string } | null> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return null;
    const roomId = generateUUID();
    const now = new Date().toISOString();
    const status: PvpRoomStatus = 'open';
    const phase: PvpRoomPhase = 'waiting';

    const ok = await bundle.insertPvpRoomWithHostPlayer(bundle.db, {
      roomId,
      hostUserId: input.hostUserId,
      status,
      phase,
      rulesJson: input.rulesJson,
      joinCodeHash: input.joinCodeHash ?? null,
      joinCodeSalt: input.joinCodeSalt ?? null,
      expiresAt: input.expiresAt ?? null,
      nowIso: now,
    });

    if (ok) {
      return { roomId };
    }
    return null;
  } catch (error) {
    console.error('创建 pvp_rooms 失败:', error);
    return null;
  }
}

export async function getPvpRoomById(roomId: string): Promise<PvpRoomRow | null> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return null;
    return await bundle.getPvpRoomByIdRow(bundle.db, roomId);
  } catch (error) {
    console.error('读取 pvp_rooms 失败:', error);
    return null;
  }
}

export async function getPvpRoomPlayers(roomId: string): Promise<PvpRoomPlayerRow[]> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoomPlayersByRole(bundle.db, roomId, 'player');
  } catch (error) {
    console.error('读取 pvp_room_players 失败:', error);
    return [];
  }
}

export async function getPvpRoomBrowseRows(input: {
  query?: string;
  mode?: string;
  password?: 'any' | 'yes' | 'no';
  phase?: 'any' | 'waiting' | 'submitting';
  phaseScope?: 'joinable' | 'open';
  limit?: number;
  offset?: number;
}): Promise<PvpRoomBrowseRow[]> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoomBrowseRows(bundle.db, input);
  } catch (error) {
    console.error('读取 pvp_rooms 浏览列表失败:', error);
    return [];
  }
}

export async function getPvpRoomMembers(roomId: string): Promise<PvpRoomPlayerRow[]> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoomMembers(bundle.db, roomId);
  } catch (error) {
    console.error('读取 pvp_room_players(含观众) 失败:', error);
    return [];
  }
}

export async function addPvpRoomPlayer(
  roomId: string,
  userId: number,
  seat: number | null,
  role: PvpRoomMemberRole = 'player'
): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    const now = new Date().toISOString();
    await bundle.insertPvpRoomPlayerIgnore(bundle.db, {
      roomId,
      userId,
      seat,
      role,
      joinedAt: now,
    });
    return true;
  } catch (error) {
    console.error('写入 pvp_room_players 失败:', error);
    return false;
  }
}

export async function updatePvpRoomMember(input: {
  roomId: string;
  userId: number;
  role: PvpRoomMemberRole;
  seat: number | null;
}): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    const changed = await bundle.updatePvpRoomMember(bundle.db, input);
    return changed > 0;
  } catch (error) {
    console.error('更新 pvp_room_players 失败:', error);
    return false;
  }
}

export async function removePvpRoomPlayer(roomId: string, userId: number): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    await bundle.deletePvpRoomPlayer(bundle.db, roomId, userId);
    return true;
  } catch (error) {
    console.error('删除 pvp_room_players 失败:', error);
    return false;
  }
}

export async function updatePvpRoomCas(
  roomId: string,
  expectedVersion: number,
  patch: Partial<
    Pick<
      PvpRoomRow,
      'status' | 'phase' | 'rules_json' | 'current_match_id' | 'join_code_hash' | 'join_code_salt' | 'expires_at' | 'last_activity_at'
    >
  >
): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    const changed = await bundle.updatePvpRoomByCas(bundle.db, {
      roomId,
      expectedVersion,
      patch: {
        status: patch.status,
        phase: patch.phase,
        rulesJson: patch.rules_json,
        currentMatchId: patch.current_match_id,
        joinCodeHash: patch.join_code_hash,
        joinCodeSalt: patch.join_code_salt,
        expiresAt: patch.expires_at,
        lastActivityAt: patch.last_activity_at,
      },
      nowIso: new Date().toISOString(),
    });
    return changed > 0;
  } catch (error) {
    console.error('CAS 更新 pvp_rooms 失败:', error);
    return false;
  }
}

export async function upsertPvpRoomSubmission(roomId: string, userId: number, submissionJson: string): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    await bundle.upsertPvpRoomSubmission(bundle.db, {
      roomId,
      userId,
      submissionJson,
      nowIso: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('写入 pvp_room_submissions 失败:', error);
    return false;
  }
}

export interface PvpRoomSubmissionRow {
  room_id: string;
  user_id: number;
  submission_json: string;
  created_at: string;
  updated_at: string;
}

export async function getPvpRoomSubmissions(roomId: string): Promise<PvpRoomSubmissionRow[]> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoomSubmissionsByRoomId(bundle.db, roomId);
  } catch (error) {
    console.error('读取 pvp_room_submissions 失败:', error);
    return [];
  }
}

export async function deletePvpRoomSubmission(roomId: string, userId: number): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    await bundle.deletePvpRoomSubmission(bundle.db, roomId, userId);
    return true;
  } catch (error) {
    console.error('删除 pvp_room_submissions 失败:', error);
    return false;
  }
}

export interface PvpEligibleDataCardRow {
  id: string;
  user_id: number;
  type: string;
  name: string;
  description: string | null;
  data: string;
  is_public: number;
  usage_count?: number | null;
  like_count?: number | null;
  favorite_count?: number | null;
  review_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  username: string;
  prefix?: string | null;
  author_is_banned?: string | null;
}

export async function getPvpEligibleDataCard(cardId: string, requestUserId: number): Promise<PvpEligibleDataCardRow | null> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return null;
    return await bundle.getPvpEligibleDataCardById(bundle.db, cardId, requestUserId);
  } catch (error) {
    console.error('读取 PVP 可用 data_cards 失败:', error);
    return null;
  }
}

/**
 * PVP 情景专用：只允许使用“已通过审查”且“未封禁”的情景数据卡。
 * - 仅允许 dc.type='scenario'
 * - 仅允许 review_status='approved'
 * - 禁止 is_public=-1（封禁）
 * - 允许房主私有卡（dc.user_id=requestUserId）或已公开卡（dc.is_public=1）
 * - 禁止作者账号已被封禁
 */
export async function getPvpEligibleScenarioDataCard(cardId: string, requestUserId: number): Promise<PvpEligibleDataCardRow | null> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return null;
    return await bundle.getPvpEligibleScenarioDataCardById(bundle.db, cardId, requestUserId);
  } catch (error) {
    console.error('读取 PVP 可用 scenario data_card 失败:', error);
    return null;
  }
}

export async function clearPvpRoomMatchState(roomId: string): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    await bundle.clearPvpRoomMatchStateByRoomId(bundle.db, roomId);
    return true;
  } catch (error) {
    console.error('清理 PVP 对局状态失败:', error);
    return false;
  }
}

export async function clearPvpRoomRuntimeState(roomId: string): Promise<boolean> {
  return clearPvpRoomMatchState(roomId);
}

/**
 * 结束对局后清理“非战绩必要”的房间临时数据。
 * - 目标：不影响 /api/me/pvp 战绩、个人资料卡等读取。
 * - 注意：由于 schema 中 pvp_matches / pvp_rounds 仍通过 room_id 关联到 pvp_rooms（且可能存在级联），这里不删除 pvp_rooms 行本身。
 */
export async function clearPvpRoomEphemeralState(roomId: string): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    await bundle.clearPvpRoomEphemeralStateByRoomId(bundle.db, roomId);
    return true;
  } catch (error) {
    console.error('清理 PVP 房间临时数据失败:', error);
    return false;
  }
}

export async function upsertPvpRoomHand(roomId: string, userId: number, handJson: string): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    await bundle.upsertPvpRoomHand(bundle.db, {
      roomId,
      userId,
      handJson,
      nowIso: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('写入 pvp_room_hands 失败:', error);
    return false;
  }
}

export async function deletePvpRoomHand(roomId: string, userId: number): Promise<boolean> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return false;
    await bundle.deletePvpRoomHand(bundle.db, roomId, userId);
    return true;
  } catch (error) {
    console.error('删除 pvp_room_hands 失败:', error);
    return false;
  }
}

export interface PvpRoomHandRow {
  room_id: string;
  user_id: number;
  hand_json: string;
  created_at: string;
  updated_at: string;
}

export async function getPvpRoomHands(roomId: string): Promise<PvpRoomHandRow[]> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoomHandsByRoomId(bundle.db, roomId);
  } catch (error) {
    console.error('读取 pvp_room_hands 失败:', error);
    return [];
  }
}

export interface CreatePvpCardSnapshotInput {
  roomId: string;
  ownerUserId: number;
  refJson: string;
  cardType: string;
  name: string;
  dataJson: string;
  sourceUpdatedAt?: string | null;
}

export async function createPvpCardSnapshot(input: CreatePvpCardSnapshotInput): Promise<string | null> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return null;
    const snapshotId = generateUUID();
    const now = new Date().toISOString();
    const ok = await bundle.insertPvpCardSnapshot(bundle.db, {
      snapshotId,
      roomId: input.roomId,
      ownerUserId: input.ownerUserId,
      refJson: input.refJson,
      cardType: input.cardType,
      name: input.name,
      dataJson: input.dataJson,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      createdAt: now,
    });
    return ok ? snapshotId : null;
  } catch (error) {
    console.error('写入 pvp_room_card_snapshots 失败:', error);
    return null;
  }
}

export interface PvpCardSnapshotRow {
  id: string;
  room_id: string;
  owner_user_id: number;
  ref_json: string;
  card_type: string;
  name: string;
  data_json: string;
  source_updated_at: string | null;
  created_at: string;
}

export async function getPvpCardSnapshots(roomId: string): Promise<PvpCardSnapshotRow[]> {
  try {
    const bundle = await readPvpRoomCoreRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpCardSnapshotsByRoomId(bundle.db, roomId);
  } catch (error) {
    console.error('读取 pvp_room_card_snapshots 失败:', error);
    return [];
  }
}

export interface CreatePvpRoundInput {
  roomId: string;
  matchId?: string | null;
  roundIndex: number;
  status?: PvpRoundStatus;
  publicSnapshotJson?: string | null;
}

export async function createPvpRound(input: CreatePvpRoundInput): Promise<string | null> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return null;
    const roundId = generateUUID();
    const now = new Date().toISOString();
    const status: PvpRoundStatus = input.status ?? 'pending';
    const ok = await bundle.insertPvpRound(bundle.db, {
      roundId,
      roomId: input.roomId,
      matchId: input.matchId ?? null,
      roundIndex: input.roundIndex,
      status,
      publicSnapshotJson: input.publicSnapshotJson ?? null,
      createdAt: now,
    });
    return ok ? roundId : null;
  } catch (error) {
    console.error('写入 pvp_rounds 失败:', error);
    return null;
  }
}

export interface PvpRoundRow {
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
}

export async function getPvpRoundById(roundId: string): Promise<PvpRoundRow | null> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return null;
    return await bundle.getPvpRoundByIdRow(bundle.db, roundId);
  } catch (error) {
    console.error('读取 pvp_rounds 失败:', error);
    return null;
  }
}

export async function getLatestPvpRoundByRoom(roomId: string): Promise<PvpRoundRow | null> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return null;
    return await bundle.getLatestPvpRoundByRoomId(bundle.db, roomId);
  } catch (error) {
    console.error('读取 pvp_rounds(最新) 失败:', error);
    return null;
  }
}

export async function getLatestPvpRoundByMatch(matchId: string): Promise<PvpRoundRow | null> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return null;
    return await bundle.getLatestPvpRoundByMatchId(bundle.db, matchId);
  } catch (error) {
    console.error('读取 pvp_rounds(最新, match) 失败:', error);
    return null;
  }
}

export async function getPvpRoundsByRoom(roomId: string): Promise<PvpRoundRow[]> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoundsByRoomId(bundle.db, roomId);
  } catch (error) {
    console.error('读取 pvp_rounds(列表) 失败:', error);
    return [];
  }
}

export async function getPvpRoundsByMatch(matchId: string): Promise<PvpRoundRow[]> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoundsByMatchId(bundle.db, matchId);
  } catch (error) {
    console.error('读取 pvp_rounds(列表, match) 失败:', error);
    return [];
  }
}

export interface UpdatePvpRoundPatch {
  status?: PvpRoundStatus;
  battleGenerationId?: string | null;
  publicSnapshotJson?: string | null;
  resultJson?: string | null;
  winnerUserId?: number | null;
  winnerName?: string | null;
}

export async function updatePvpRound(roundId: string, patch: UpdatePvpRoundPatch): Promise<boolean> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return false;
    const changed = await bundle.updatePvpRoundPatch(bundle.db, roundId, patch);
    return changed > 0;
  } catch (error) {
    console.error('更新 pvp_rounds 失败:', error);
    return false;
  }
}

export async function upsertPvpRoundChoice(roundId: string, userId: number, choiceRefJson: string): Promise<boolean> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return false;
    await bundle.upsertPvpRoundChoice(bundle.db, {
      roundId,
      userId,
      choiceRefJson,
      nowIso: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('写入 pvp_round_choices 失败:', error);
    return false;
  }
}

export interface PvpRoundChoiceRow {
  round_id: string;
  user_id: number;
  choice_ref_json: string;
  created_at: string;
  updated_at: string;
}

export async function getPvpRoundChoices(roundId: string): Promise<PvpRoundChoiceRow[]> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoundChoicesByRoundId(bundle.db, roundId);
  } catch (error) {
    console.error('读取 pvp_round_choices 失败:', error);
    return [];
  }
}

export async function getPvpCardSnapshotById(snapshotId: string): Promise<PvpCardSnapshotRow | null> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return null;
    return await bundle.getPvpCardSnapshotByIdRow(bundle.db, snapshotId);
  } catch (error) {
    console.error('读取 pvp_room_card_snapshots(id) 失败:', error);
    return null;
  }
}

export type PvpMatchStatus = 'active' | 'completed' | 'aborted';

export interface PvpMatchRow {
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
}

export interface PvpMatchPlayerRow {
  match_id: string;
  user_id: number;
  seat: number;
  username: string | null;
  user_prefix: string | null;
  joined_at: string;
}

export interface PvpUserSummaryRow {
  user_id: number;
  completed_matches: number;
  wins: number;
  losses: number;
  draws: number;
  aborted_matches: number;
  last_played_at: string | null;
}

export async function getPvpUserSummariesByUserIds(userIds: number[]): Promise<PvpUserSummaryRow[]> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpUserSummariesByUserIds(bundle.db, userIds);
  } catch (error) {
    console.error('读取 PVP 用户战绩摘要失败:', error);
    return [];
  }
}

export async function getPvpMatchesByUserId(
  userId: number,
  limit: number,
  offset = 0
): Promise<{ matches: PvpMatchRow[]; players: PvpMatchPlayerRow[] }> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return { matches: [], players: [] };
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const matches = await bundle.listPvpMatchesByUserId(bundle.db, userId, safeLimit, safeOffset);

    if (matches.length <= 0) return { matches: [], players: [] };

    const matchIds = matches.map((m) => m.id);
    const players = await bundle.listPvpMatchPlayersByMatchIds(bundle.db, matchIds);

    return { matches, players };
  } catch (error) {
    console.error('读取 PVP 对战列表失败:', error);
    return { matches: [], players: [] };
  }
}

export type PvpMatchRoundOutcomeSummary = {
  match_id: string;
  total_rounds: number;
  wins: number;
  losses: number;
  draws: number;
};

export async function getPvpMatchRoundOutcomeSummariesByMatchIds(
  matchIds: string[],
  userId: number
): Promise<PvpMatchRoundOutcomeSummary[]> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpMatchRoundOutcomeSummariesByMatchIds(bundle.db, matchIds, userId);
  } catch (error) {
    console.error('读取 PVP 回合胜负统计失败:', error);
    return [];
  }
}

export async function countPvpMatchesByUserId(userId: number): Promise<number> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return 0;
    return await bundle.countPvpMatchesByUserId(bundle.db, userId);
  } catch (error) {
    console.error('统计 pvp_matches(user) 失败:', error);
    return 0;
  }
}

export async function isUserInPvpMatch(matchId: string, userId: number): Promise<boolean> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return false;
    return await bundle.hasPvpMatchPlayer(bundle.db, matchId, userId);
  } catch (error) {
    console.error('检查 pvp_match_players 失败:', error);
    return false;
  }
}

export async function getPvpMatchPlayersByMatchId(matchId: string): Promise<PvpMatchPlayerRow[]> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpMatchPlayersByMatchId(bundle.db, matchId);
  } catch (error) {
    console.error('读取 pvp_match_players(match) 失败:', error);
    return [];
  }
}

export async function createPvpMatch(input: {
  id: string;
  roomId: string;
  rulesJson: string;
  participants: number;
  startedAt: string;
}): Promise<boolean> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return false;
    return await bundle.insertPvpMatch(bundle.db, {
      id: input.id,
      roomId: input.roomId,
      rulesJson: input.rulesJson,
      participants: input.participants,
      startedAt: input.startedAt,
      nowIso: new Date().toISOString(),
    });
  } catch (error) {
    console.error('写入 pvp_matches 失败:', error);
    return false;
  }
}

export async function createPvpMatchPlayers(
  matchId: string,
  players: Array<{ userId: number; seat: number; username: string | null; userPrefix: string | null; joinedAt: string }>
): Promise<boolean> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return false;
    await bundle.upsertPvpMatchPlayers(bundle.db, matchId, players);
    return true;
  } catch (error) {
    console.error('写入 pvp_match_players 失败:', error);
    return false;
  }
}

export async function updatePvpMatch(matchId: string, patch: { status?: PvpMatchStatus; endedAt?: string | null; winnerUserId?: number | null; resultJson?: string | null }): Promise<boolean> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return false;
    const changed = await bundle.updatePvpMatchPatch(bundle.db, matchId, patch, new Date().toISOString());
    return changed > 0;
  } catch (error) {
    console.error('更新 pvp_matches 失败:', error);
    return false;
  }
}

export async function getPvpMatchById(matchId: string): Promise<PvpMatchRow | null> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return null;
    return await bundle.getPvpMatchByIdRow(bundle.db, matchId);
  } catch (error) {
    console.error('读取 pvp_matches 失败:', error);
    return null;
  }
}

export interface PvpRoomChatMessageRow {
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
}

export async function getPvpRoomChatMessages(input: {
  roomId: string;
  limit?: number;
  afterId?: number | null;
}): Promise<PvpRoomChatMessageRow[]> {
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(100, Math.floor(input.limit as number))) : 50;
  const afterId = Number.isFinite(input.afterId) ? Math.max(0, Math.floor(input.afterId as number)) : null;

  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return [];
    return await bundle.listPvpRoomChatMessages(bundle.db, {
      roomId: input.roomId,
      limit,
      afterId,
    });
  } catch (error) {
    console.error('读取 pvp_room_chat_messages 失败:', error);
    return [];
  }
}

export async function getLatestPvpRoomChatMessageBySender(input: {
  roomId: string;
  userId: number;
}): Promise<{ id: number; created_at: string } | null> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return null;
    return await bundle.getLatestPvpRoomChatMessageBySender(bundle.db, input);
  } catch (error) {
    console.error('读取 pvp_room_chat_messages(最新发送) 失败:', error);
    return null;
  }
}

export async function createPvpRoomChatMessage(input: {
  roomId: string;
  senderUserId: number;
  senderRole: PvpRoomMemberRole;
  senderUsername: string;
  senderPrefix?: string | null;
  contentJson: string;
  renderedText?: string | null;
  stickerId?: string | null;
  emojiText?: string | null;
}): Promise<number | null> {
  try {
    const bundle = await readPvpMatchRoundChatRepoBundle();
    if (!bundle) return null;
    return await bundle.insertPvpRoomChatMessage(bundle.db, {
      roomId: input.roomId,
      senderUserId: input.senderUserId,
      senderRole: input.senderRole,
      senderUsername: input.senderUsername,
      senderPrefix: input.senderPrefix ?? null,
      contentJson: input.contentJson,
      renderedText: input.renderedText ?? null,
      stickerId: input.stickerId ?? null,
      emojiText: input.emojiText ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('写入 pvp_room_chat_messages 失败:', error);
    return null;
  }
}
