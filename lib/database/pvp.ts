import { generateUUID, queryFromD1 } from './core';

export type PvpRoomStatus = 'open' | 'closed';
export type PvpRoomPhase =
  | 'waiting'
  | 'submitting'
  | 'dealing'
  | 'choosing'
  | 'resolving'
  | 'finished'
  | 'aborted'
  | 'closed';

export interface PvpRoomRow {
  id: string;
  host_user_id: number;
  status: PvpRoomStatus;
  phase: PvpRoomPhase;
  rules_json: string;
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
  seat: number | null;
  joined_at: string;
  username?: string;
  prefix?: string | null;
}

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
        id, host_user_id, status, phase, rules_json,
        join_code_hash, join_code_salt,
        version, expires_at, last_activity_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        roomId,
        input.hostUserId,
        status,
        phase,
        input.rulesJson,
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
       WHERE p.room_id = ?
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

export async function addPvpRoomPlayer(roomId: string, userId: number, seat: number | null): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const result = await queryFromD1(
      'INSERT OR IGNORE INTO pvp_room_players (room_id, user_id, seat, joined_at) VALUES (?, ?, ?, ?)',
      [roomId, userId, seat, now]
    ) as any;
    return Boolean(result.success);
  } catch (error) {
    console.error('写入 pvp_room_players 失败:', error);
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
  patch: Partial<Pick<PvpRoomRow, 'status' | 'phase' | 'rules_json' | 'join_code_hash' | 'join_code_salt' | 'expires_at' | 'last_activity_at'>>
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

export interface PvpEligibleDataCardRow {
  id: string;
  user_id: number;
  type: string;
  name: string;
  description: string | null;
  data: string;
  is_public: number;
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

export async function clearPvpRoomMatchState(roomId: string): Promise<boolean> {
  try {
    // 注意：pvp_round_choices 没有 room_id，需要通过 rounds 关联删除
    await queryFromD1(
      `DELETE FROM pvp_round_choices WHERE round_id IN (SELECT id FROM pvp_rounds WHERE room_id = ?)`,
      [roomId]
    );
    await queryFromD1('DELETE FROM pvp_rounds WHERE room_id = ?', [roomId]);
    await queryFromD1('DELETE FROM pvp_room_hands WHERE room_id = ?', [roomId]);
    await queryFromD1('DELETE FROM pvp_room_submissions WHERE room_id = ?', [roomId]);
    await queryFromD1('DELETE FROM pvp_room_card_snapshots WHERE room_id = ?', [roomId]);

    return true;
  } catch (error) {
    console.error('清理 PVP 对局状态失败:', error);
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
      `INSERT INTO pvp_rounds (id, room_id, round_index, status, public_snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [roundId, input.roomId, input.roundIndex, status, input.publicSnapshotJson ?? null, now]
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
