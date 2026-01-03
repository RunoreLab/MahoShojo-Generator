import { generateUUID, queryFromD1 } from './core';

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

export async function createPvpRoom(input: CreatePvpRoomInput): Promise<{ roomId: string } | null> {
  try {
    const roomId = generateUUID();
    const now = new Date().toISOString();
    const status: PvpRoomStatus = 'open';
    const phase: PvpRoomPhase = 'waiting';

    const result = await queryFromD1(
      `INSERT INTO pvp_rooms (
        id, host_user_id, status, phase, rules_json, current_match_id,
        join_code_hash, join_code_salt,
        version, expires_at, last_activity_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        roomId,
        input.hostUserId,
        status,
        phase,
        input.rulesJson,
        null,
        input.joinCodeHash ?? null,
        input.joinCodeSalt ?? null,
        input.expiresAt ?? null,
        now,
        now,
        now,
      ]
    ) as any;

    if (result.success) {
      await queryFromD1(
        'INSERT OR IGNORE INTO pvp_room_players (room_id, user_id, seat, joined_at) VALUES (?, ?, ?, ?)',
        [roomId, input.hostUserId, 0, now]
      );
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
    const result = await queryFromD1('SELECT * FROM pvp_rooms WHERE id = ?', [roomId]) as any;
    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as PvpRoomRow;
    }
    return null;
  } catch (error) {
    console.error('读取 pvp_rooms 失败:', error);
    return null;
  }
}

export async function getPvpRoomPlayers(roomId: string): Promise<PvpRoomPlayerRow[]> {
  try {
    const result = await queryFromD1(
      `SELECT p.*, u.username, u.prefix
       FROM pvp_room_players p
       JOIN users u ON u.id = p.user_id
       WHERE p.room_id = ? AND p.role = 'player'
       ORDER BY p.seat ASC, p.joined_at ASC`,
      [roomId]
    ) as any;

    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpRoomPlayerRow[];
    }
    return [];
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
    const where: string[] = [];
    const params: any[] = [];

    where.push('r.status = ?');
    params.push('open');

    const phaseScope = input.phaseScope ?? 'joinable';
    const phase = input.phase ?? 'any';
    if (phase === 'waiting' || phase === 'submitting') {
      where.push('r.phase = ?');
      params.push(phase);
    } else if (phaseScope === 'joinable') {
      where.push('r.phase IN (?, ?)');
      params.push('waiting', 'submitting');
    } else {
      where.push('r.phase != ?');
      params.push('closed');
    }

    const nowIso = new Date().toISOString();
    where.push('(r.expires_at IS NULL OR r.expires_at > ?)');
    params.push(nowIso);

    const password = input.password ?? 'any';
    if (password === 'yes') where.push('r.join_code_hash IS NOT NULL');
    if (password === 'no') where.push('r.join_code_hash IS NULL');

    const q = typeof input.query === 'string' ? input.query.trim() : '';
    if (q) {
      where.push('(r.id LIKE ? OR u.username LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like);
    }

    const mode = typeof input.mode === 'string' ? input.mode.trim() : '';
    if (mode && mode !== 'all') {
      where.push('r.rules_json LIKE ?');
      params.push(`%\"mode\":\"${mode}\"%`);
    }

    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(200, Math.floor(input.limit as number))) : 50;
    const offset = Number.isFinite(input.offset) ? Math.max(0, Math.floor(input.offset as number)) : 0;

    const sql = `
      SELECT
        r.*,
        u.username AS host_username,
        u.prefix AS host_prefix,
        COUNT(p.user_id) AS player_count
      FROM pvp_rooms r
      JOIN users u ON u.id = r.host_user_id
      LEFT JOIN pvp_room_players p ON p.room_id = r.id AND p.role = 'player'
      WHERE ${where.join(' AND ')}
      GROUP BY r.id
      ORDER BY COALESCE(r.last_activity_at, r.updated_at) DESC
      LIMIT ? OFFSET ?`;

    const result = await queryFromD1(sql, [...params, limit, offset]) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpRoomBrowseRow[];
    }
    return [];
  } catch (error) {
    console.error('读取 pvp_rooms 浏览列表失败:', error);
    return [];
  }
}

export async function getPvpRoomMembers(roomId: string): Promise<PvpRoomPlayerRow[]> {
  try {
    const result = await queryFromD1(
      `SELECT p.*, u.username, u.prefix
       FROM pvp_room_players p
       JOIN users u ON u.id = p.user_id
       WHERE p.room_id = ?
       ORDER BY
         CASE WHEN p.role = 'player' THEN 0 ELSE 1 END ASC,
         p.seat ASC,
         p.joined_at ASC`,
      [roomId]
    ) as any;

    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpRoomPlayerRow[];
    }
    return [];
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
    const now = new Date().toISOString();
    const result = await queryFromD1(
      'INSERT OR IGNORE INTO pvp_room_players (room_id, user_id, role, seat, joined_at) VALUES (?, ?, ?, ?, ?)',
      [roomId, userId, role, seat, now]
    ) as any;
    return Boolean(result.success);
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
    const result = await queryFromD1(
      'UPDATE pvp_room_players SET role = ?, seat = ? WHERE room_id = ? AND user_id = ?',
      [input.role, input.seat, input.roomId, input.userId]
    ) as any;
    return Boolean(result.success && result.result?.[0]?.meta?.changes > 0);
  } catch (error) {
    console.error('更新 pvp_room_players 失败:', error);
    return false;
  }
}

export async function removePvpRoomPlayer(roomId: string, userId: number): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'DELETE FROM pvp_room_players WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    ) as any;
    return Boolean(result.success);
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
  const fields: string[] = [];
  const params: any[] = [];

  if (patch.status !== undefined) {
    fields.push('status = ?');
    params.push(patch.status);
  }
  if (patch.phase !== undefined) {
    fields.push('phase = ?');
    params.push(patch.phase);
  }
  if (patch.rules_json !== undefined) {
    fields.push('rules_json = ?');
    params.push(patch.rules_json);
  }
  if (patch.current_match_id !== undefined) {
    fields.push('current_match_id = ?');
    params.push(patch.current_match_id);
  }
  if (patch.join_code_hash !== undefined) {
    fields.push('join_code_hash = ?');
    params.push(patch.join_code_hash);
  }
  if (patch.join_code_salt !== undefined) {
    fields.push('join_code_salt = ?');
    params.push(patch.join_code_salt);
  }
  if (patch.expires_at !== undefined) {
    fields.push('expires_at = ?');
    params.push(patch.expires_at);
  }
  if (patch.last_activity_at !== undefined) {
    fields.push('last_activity_at = ?');
    params.push(patch.last_activity_at);
  }

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  params.push(now);

  // 乐观锁 + version 自增
  fields.push('version = version + 1');

  if (fields.length <= 0) return false;

  try {
    const result = await queryFromD1(
      `UPDATE pvp_rooms SET ${fields.join(', ')} WHERE id = ? AND version = ?`,
      [...params, roomId, expectedVersion]
    ) as any;

    return Boolean(result.success && result.result?.[0]?.meta?.changes > 0);
  } catch (error) {
    console.error('CAS 更新 pvp_rooms 失败:', error);
    return false;
  }
}

export async function upsertPvpRoomSubmission(roomId: string, userId: number, submissionJson: string): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const result = await queryFromD1(
      `INSERT INTO pvp_room_submissions (room_id, user_id, submission_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET
         submission_json = excluded.submission_json,
         updated_at = excluded.updated_at`,
      [roomId, userId, submissionJson, now, now]
    ) as any;
    return Boolean(result.success);
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
    const result = await queryFromD1(
      'SELECT * FROM pvp_room_submissions WHERE room_id = ? ORDER BY updated_at ASC',
      [roomId]
    ) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpRoomSubmissionRow[];
    }
    return [];
  } catch (error) {
    console.error('读取 pvp_room_submissions 失败:', error);
    return [];
  }
}

export async function deletePvpRoomSubmission(roomId: string, userId: number): Promise<boolean> {
  try {
    const result = await queryFromD1('DELETE FROM pvp_room_submissions WHERE room_id = ? AND user_id = ?', [roomId, userId]) as any;
    return Boolean(result?.success);
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
    const result = await queryFromD1(
      `SELECT
        dc.*,
        u.username,
        u.prefix,
        u.is_banned AS author_is_banned
      FROM data_cards dc
      JOIN users u ON u.id = dc.user_id
      WHERE
        dc.id = ?
        AND dc.deleted_at IS NULL
        AND dc.is_public != -1
        AND dc.review_status IN ('approved', 'pending')
        AND (dc.user_id = ? OR dc.is_public = 1)
        AND (u.is_banned IS NULL OR u.is_banned = '')`,
      [cardId, requestUserId]
    ) as any;

    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as PvpEligibleDataCardRow;
    }
    return null;
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
    const result = await queryFromD1(
      `SELECT
        dc.*,
        u.username,
        u.prefix,
        u.is_banned AS author_is_banned
      FROM data_cards dc
      JOIN users u ON u.id = dc.user_id
      WHERE
        dc.id = ?
        AND dc.type = 'scenario'
        AND dc.deleted_at IS NULL
        AND dc.is_public != -1
        AND dc.review_status = 'approved'
        AND (dc.user_id = ? OR dc.is_public = 1)
        AND (u.is_banned IS NULL OR u.is_banned = '')`,
      [cardId, requestUserId]
    ) as any;

    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as PvpEligibleDataCardRow;
    }
    return null;
  } catch (error) {
    console.error('读取 PVP 可用 scenario data_card 失败:', error);
    return null;
  }
}

export async function clearPvpRoomMatchState(roomId: string): Promise<boolean> {
  try {
    await queryFromD1('DELETE FROM pvp_room_hands WHERE room_id = ?', [roomId]);
    await queryFromD1('DELETE FROM pvp_room_submissions WHERE room_id = ?', [roomId]);
    await queryFromD1('DELETE FROM pvp_room_card_snapshots WHERE room_id = ?', [roomId]);

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
    await queryFromD1('DELETE FROM pvp_room_hands WHERE room_id = ?', [roomId]);
    await queryFromD1('DELETE FROM pvp_room_submissions WHERE room_id = ?', [roomId]);
    await queryFromD1('DELETE FROM pvp_room_card_snapshots WHERE room_id = ?', [roomId]);
    await queryFromD1('DELETE FROM pvp_room_chat_messages WHERE room_id = ?', [roomId]);
    await queryFromD1(
      'DELETE FROM pvp_round_choices WHERE round_id IN (SELECT id FROM pvp_rounds WHERE room_id = ?)',
      [roomId]
    );
    return true;
  } catch (error) {
    console.error('清理 PVP 房间临时数据失败:', error);
    return false;
  }
}

export async function upsertPvpRoomHand(roomId: string, userId: number, handJson: string): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const result = await queryFromD1(
      `INSERT INTO pvp_room_hands (room_id, user_id, hand_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET
         hand_json = excluded.hand_json,
         updated_at = excluded.updated_at`,
      [roomId, userId, handJson, now, now]
    ) as any;
    return Boolean(result.success);
  } catch (error) {
    console.error('写入 pvp_room_hands 失败:', error);
    return false;
  }
}

export async function deletePvpRoomHand(roomId: string, userId: number): Promise<boolean> {
  try {
    const result = await queryFromD1('DELETE FROM pvp_room_hands WHERE room_id = ? AND user_id = ?', [roomId, userId]) as any;
    return Boolean(result?.success);
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
    const result = await queryFromD1(
      'SELECT * FROM pvp_room_hands WHERE room_id = ?',
      [roomId]
    ) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpRoomHandRow[];
    }
    return [];
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
    const snapshotId = generateUUID();
    const now = new Date().toISOString();
    const result = await queryFromD1(
      `INSERT INTO pvp_room_card_snapshots (
        id, room_id, owner_user_id, ref_json, card_type, name, data_json, source_updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshotId,
        input.roomId,
        input.ownerUserId,
        input.refJson,
        input.cardType,
        input.name,
        input.dataJson,
        input.sourceUpdatedAt ?? null,
        now,
      ]
    ) as any;
    return result.success ? snapshotId : null;
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
    const result = await queryFromD1(
      'SELECT * FROM pvp_room_card_snapshots WHERE room_id = ? ORDER BY created_at ASC',
      [roomId]
    ) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpCardSnapshotRow[];
    }
    return [];
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
    const roundId = generateUUID();
    const now = new Date().toISOString();
    const status: PvpRoundStatus = input.status ?? 'pending';
    const result = await queryFromD1(
      `INSERT INTO pvp_rounds (id, room_id, match_id, round_index, status, public_snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [roundId, input.roomId, input.matchId ?? null, input.roundIndex, status, input.publicSnapshotJson ?? null, now]
    ) as any;
    return result.success ? roundId : null;
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
    const result = await queryFromD1('SELECT * FROM pvp_rounds WHERE id = ?', [roundId]) as any;
    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as PvpRoundRow;
    }
    return null;
  } catch (error) {
    console.error('读取 pvp_rounds 失败:', error);
    return null;
  }
}

export async function getLatestPvpRoundByRoom(roomId: string): Promise<PvpRoundRow | null> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM pvp_rounds WHERE room_id = ? ORDER BY round_index DESC LIMIT 1',
      [roomId]
    ) as any;
    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as PvpRoundRow;
    }
    return null;
  } catch (error) {
    console.error('读取 pvp_rounds(最新) 失败:', error);
    return null;
  }
}

export async function getLatestPvpRoundByMatch(matchId: string): Promise<PvpRoundRow | null> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM pvp_rounds WHERE match_id = ? ORDER BY round_index DESC LIMIT 1',
      [matchId]
    ) as any;
    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as PvpRoundRow;
    }
    return null;
  } catch (error) {
    console.error('读取 pvp_rounds(最新, match) 失败:', error);
    return null;
  }
}

export async function getPvpRoundsByRoom(roomId: string): Promise<PvpRoundRow[]> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM pvp_rounds WHERE room_id = ? ORDER BY round_index ASC',
      [roomId]
    ) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpRoundRow[];
    }
    return [];
  } catch (error) {
    console.error('读取 pvp_rounds(列表) 失败:', error);
    return [];
  }
}

export async function getPvpRoundsByMatch(matchId: string): Promise<PvpRoundRow[]> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM pvp_rounds WHERE match_id = ? ORDER BY round_index ASC',
      [matchId]
    ) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpRoundRow[];
    }
    return [];
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
  const fields: string[] = [];
  const params: any[] = [];

  if (patch.status !== undefined) {
    fields.push('status = ?');
    params.push(patch.status);
  }
  if (patch.battleGenerationId !== undefined) {
    fields.push('battle_generation_id = ?');
    params.push(patch.battleGenerationId);
  }
  if (patch.publicSnapshotJson !== undefined) {
    fields.push('public_snapshot_json = ?');
    params.push(patch.publicSnapshotJson);
  }
  if (patch.resultJson !== undefined) {
    fields.push('result_json = ?');
    params.push(patch.resultJson);
  }
  if (patch.winnerUserId !== undefined) {
    fields.push('winner_user_id = ?');
    params.push(patch.winnerUserId);
  }
  if (patch.winnerName !== undefined) {
    fields.push('winner_name = ?');
    params.push(patch.winnerName);
  }

  if (fields.length <= 0) return false;

  try {
    const result = await queryFromD1(
      `UPDATE pvp_rounds SET ${fields.join(', ')} WHERE id = ?`,
      [...params, roundId]
    ) as any;
    return Boolean(result.success && result.result?.[0]?.meta?.changes > 0);
  } catch (error) {
    console.error('更新 pvp_rounds 失败:', error);
    return false;
  }
}

export async function upsertPvpRoundChoice(roundId: string, userId: number, choiceRefJson: string): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const result = await queryFromD1(
      `INSERT INTO pvp_round_choices (round_id, user_id, choice_ref_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(round_id, user_id) DO UPDATE SET
         choice_ref_json = excluded.choice_ref_json,
         updated_at = excluded.updated_at`,
      [roundId, userId, choiceRefJson, now, now]
    ) as any;
    return Boolean(result.success);
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
    const result = await queryFromD1('SELECT * FROM pvp_round_choices WHERE round_id = ?', [roundId]) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpRoundChoiceRow[];
    }
    return [];
  } catch (error) {
    console.error('读取 pvp_round_choices 失败:', error);
    return [];
  }
}

export async function getPvpCardSnapshotById(snapshotId: string): Promise<PvpCardSnapshotRow | null> {
  try {
    const result = await queryFromD1('SELECT * FROM pvp_room_card_snapshots WHERE id = ?', [snapshotId]) as any;
    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as PvpCardSnapshotRow;
    }
    return null;
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
    const ids = [...new Set(userIds.filter((n) => Number.isFinite(n)).map((n) => Math.floor(n)))].filter((n) => n > 0);
    if (ids.length <= 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const result = await queryFromD1(
      `SELECT
        mp.user_id AS user_id,
        SUM(CASE WHEN m.status = 'completed' THEN 1 ELSE 0 END) AS completed_matches,
        SUM(CASE WHEN m.status = 'completed' AND m.winner_user_id = mp.user_id THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN m.status = 'completed' AND m.winner_user_id IS NULL THEN 1 ELSE 0 END) AS draws,
        SUM(CASE WHEN m.status = 'completed' AND m.winner_user_id IS NOT NULL AND m.winner_user_id != mp.user_id THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN m.status = 'aborted' THEN 1 ELSE 0 END) AS aborted_matches,
        MAX(m.started_at) AS last_played_at
      FROM pvp_match_players mp
      JOIN pvp_matches m ON m.id = mp.match_id
      WHERE mp.user_id IN (${placeholders})
      GROUP BY mp.user_id`,
      ids
    ) as any;

    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpUserSummaryRow[];
    }
    return [];
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
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const matchesResult = await queryFromD1(
      `SELECT m.*
       FROM pvp_match_players mp
       JOIN pvp_matches m ON m.id = mp.match_id
       WHERE mp.user_id = ?
       ORDER BY m.started_at DESC
       LIMIT ? OFFSET ?`,
      [userId, safeLimit, safeOffset]
    ) as any;

    const matches = (matchesResult.success && matchesResult.result?.[0]?.results)
      ? (matchesResult.result[0].results as PvpMatchRow[])
      : [];

    if (matches.length <= 0) return { matches: [], players: [] };

    const matchIds = matches.map((m) => m.id);
    const placeholders = matchIds.map(() => '?').join(', ');
    const playersResult = await queryFromD1(
      `SELECT * FROM pvp_match_players WHERE match_id IN (${placeholders}) ORDER BY match_id ASC, seat ASC`,
      matchIds
    ) as any;

    const players = (playersResult.success && playersResult.result?.[0]?.results)
      ? (playersResult.result[0].results as PvpMatchPlayerRow[])
      : [];

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
    const ids = [...new Set(matchIds.map((id) => String(id)).filter(Boolean))];
    if (ids.length <= 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const result = (await queryFromD1(
      `SELECT
        match_id,
        COUNT(1) AS total_rounds,
        SUM(CASE WHEN winner_user_id = ? THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN winner_user_id IS NOT NULL AND winner_user_id != ? THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN winner_user_id IS NULL THEN 1 ELSE 0 END) AS draws
      FROM pvp_rounds
      WHERE match_id IN (${placeholders}) AND status = 'completed'
      GROUP BY match_id`,
      [userId, userId, ...ids]
    )) as any;

    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpMatchRoundOutcomeSummary[];
    }
    return [];
  } catch (error) {
    console.error('读取 PVP 回合胜负统计失败:', error);
    return [];
  }
}

export async function countPvpMatchesByUserId(userId: number): Promise<number> {
  try {
    const result = (await queryFromD1(
      'SELECT COUNT(1) AS total FROM pvp_match_players WHERE user_id = ?',
      [userId]
    )) as any;
    const row = result?.result?.[0]?.results?.[0];
    const total = typeof row?.total === 'number' ? row.total : Number(row?.total);
    return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  } catch (error) {
    console.error('统计 pvp_matches(user) 失败:', error);
    return 0;
  }
}

export async function isUserInPvpMatch(matchId: string, userId: number): Promise<boolean> {
  try {
    const result = (await queryFromD1(
      'SELECT 1 AS ok FROM pvp_match_players WHERE match_id = ? AND user_id = ? LIMIT 1',
      [matchId, userId]
    )) as any;
    const row = result?.result?.[0]?.results?.[0];
    return Boolean(row?.ok === 1 || row?.ok === '1' || row?.ok === true);
  } catch (error) {
    console.error('检查 pvp_match_players 失败:', error);
    return false;
  }
}

export async function getPvpMatchPlayersByMatchId(matchId: string): Promise<PvpMatchPlayerRow[]> {
  try {
    const result = (await queryFromD1(
      'SELECT * FROM pvp_match_players WHERE match_id = ? ORDER BY seat ASC',
      [matchId]
    )) as any;
    if (result.success && result.result?.[0]?.results) {
      return result.result[0].results as PvpMatchPlayerRow[];
    }
    return [];
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
    const now = new Date().toISOString();
    const result = await queryFromD1(
      `INSERT INTO pvp_matches (
        id, room_id, status, rules_json, participants, started_at, ended_at, winner_user_id, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.id, input.roomId, 'active', input.rulesJson, input.participants, input.startedAt, null, null, null, now, now]
    ) as any;
    return Boolean(result?.success);
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
    for (const p of players) {
      await queryFromD1(
        `INSERT OR REPLACE INTO pvp_match_players (match_id, user_id, seat, username, user_prefix, joined_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [matchId, p.userId, p.seat, p.username, p.userPrefix, p.joinedAt]
      );
    }
    return true;
  } catch (error) {
    console.error('写入 pvp_match_players 失败:', error);
    return false;
  }
}

export async function updatePvpMatch(matchId: string, patch: { status?: PvpMatchStatus; endedAt?: string | null; winnerUserId?: number | null; resultJson?: string | null }): Promise<boolean> {
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.status !== undefined) {
    fields.push('status = ?');
    params.push(patch.status);
  }
  if (patch.endedAt !== undefined) {
    fields.push('ended_at = ?');
    params.push(patch.endedAt);
  }
  if (patch.winnerUserId !== undefined) {
    fields.push('winner_user_id = ?');
    params.push(patch.winnerUserId);
  }
  if (patch.resultJson !== undefined) {
    fields.push('result_json = ?');
    params.push(patch.resultJson);
  }
  if (fields.length <= 0) return false;

  try {
    const now = new Date().toISOString();
    fields.push('updated_at = ?');
    params.push(now);
    const result = await queryFromD1(`UPDATE pvp_matches SET ${fields.join(', ')} WHERE id = ?`, [...params, matchId]) as any;
    return Boolean(result?.success && result.result?.[0]?.meta?.changes > 0);
  } catch (error) {
    console.error('更新 pvp_matches 失败:', error);
    return false;
  }
}

export async function getPvpMatchById(matchId: string): Promise<PvpMatchRow | null> {
  try {
    const result = await queryFromD1('SELECT * FROM pvp_matches WHERE id = ?', [matchId]) as any;
    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as PvpMatchRow;
    }
    return null;
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
    if (afterId !== null && afterId > 0) {
      const result = await queryFromD1(
        `SELECT * FROM pvp_room_chat_messages
         WHERE room_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
        [input.roomId, afterId, limit]
      ) as any;
      if (result.success && result.result?.[0]?.results) return result.result[0].results as PvpRoomChatMessageRow[];
      return [];
    }

    const result = await queryFromD1(
      `SELECT * FROM pvp_room_chat_messages
       WHERE room_id = ?
       ORDER BY id DESC
       LIMIT ?`,
      [input.roomId, limit]
    ) as any;
    if (result.success && result.result?.[0]?.results) {
      const rows = result.result[0].results as PvpRoomChatMessageRow[];
      return rows.slice().reverse();
    }
    return [];
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
    const result = await queryFromD1(
      `SELECT id, created_at
       FROM pvp_room_chat_messages
       WHERE room_id = ? AND sender_user_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [input.roomId, input.userId]
    ) as any;
    if (result.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0] as { id: number; created_at: string };
    }
    return null;
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
    const now = new Date().toISOString();
    const result = await queryFromD1(
      `INSERT INTO pvp_room_chat_messages (
        room_id, sender_user_id, sender_role, sender_username, sender_prefix,
        content_json, rendered_text, sticker_id, emoji_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.roomId,
        input.senderUserId,
        input.senderRole,
        input.senderUsername,
        input.senderPrefix ?? null,
        input.contentJson,
        input.renderedText ?? null,
        input.stickerId ?? null,
        input.emojiText ?? null,
        now,
      ]
    ) as any;
    if (result.success && result.result) {
      return result.result[0]?.meta?.last_row_id ?? null;
    }
    return null;
  } catch (error) {
    console.error('写入 pvp_room_chat_messages 失败:', error);
    return null;
  }
}
