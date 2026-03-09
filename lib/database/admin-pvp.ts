import { queryFromD1 } from './core';

export type AdminPvpOverview = {
  openRooms: number;
  activeRooms: number;
  stalledRooms: number;
  activeMatches: number;
  matches7d: number;
  chatMessages7d: number;
};

export type AdminPvpRoomRow = {
  id: string;
  status: string;
  phase: string;
  hostUserId: number;
  hostUsername: string | null;
  hostPrefix: string | null;
  currentMatchId: string | null;
  hasPassword: boolean;
  playerCount: number;
  participantCount: number;
  spectatorCount: number;
  chatMessageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivityAt: string | null;
};

export type AdminPvpMatchRow = {
  id: string;
  roomId: string;
  status: string;
  participants: number;
  roundsCount: number;
  startedAt: string | null;
  endedAt: string | null;
  winnerUserId: number | null;
  winnerUsername: string | null;
};

type D1Row = Record<string, unknown>;

const readRows = (result: unknown): D1Row[] => {
  const rows = (result as { result?: Array<{ results?: D1Row[] }> })?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
};

const readFirstRow = (result: unknown): D1Row => readRows(result)[0] ?? {};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 0;
};

const readNullableInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = readInt(value);
  return Number.isFinite(normalized) ? normalized : null;
};

const readString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

const readNullableString = (value: unknown): string | null => {
  const normalized = readString(value).trim();
  return normalized ? normalized : null;
};

const readBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed !== 0;
  }
  return false;
};

const mapRoomRow = (row: D1Row): AdminPvpRoomRow => ({
  id: readString(row.id),
  status: readString(row.status),
  phase: readString(row.phase),
  hostUserId: readInt(row.host_user_id),
  hostUsername: readNullableString(row.host_username),
  hostPrefix: readNullableString(row.host_prefix),
  currentMatchId: readNullableString(row.current_match_id),
  hasPassword: readBool(row.has_password),
  playerCount: readInt(row.player_count),
  participantCount: readInt(row.participant_count),
  spectatorCount: readInt(row.spectator_count),
  chatMessageCount: readInt(row.chat_message_count),
  createdAt: readNullableString(row.created_at),
  updatedAt: readNullableString(row.updated_at),
  lastActivityAt: readNullableString(row.last_activity_at),
});

const mapMatchRow = (row: D1Row): AdminPvpMatchRow => ({
  id: readString(row.id),
  roomId: readString(row.room_id),
  status: readString(row.status),
  participants: readInt(row.participants),
  roundsCount: readInt(row.rounds_count),
  startedAt: readNullableString(row.started_at),
  endedAt: readNullableString(row.ended_at),
  winnerUserId: readNullableInt(row.winner_user_id),
  winnerUsername: readNullableString(row.winner_username),
});

export const getAdminPvpOverview = async (): Promise<AdminPvpOverview> => {
  const overviewSql = `
    SELECT
      (SELECT COUNT(*) FROM pvp_rooms WHERE status = 'open') AS open_rooms,
      (SELECT COUNT(*) FROM pvp_rooms WHERE status = 'open' AND phase NOT IN ('finished', 'aborted', 'closed')) AS active_rooms,
      (
        SELECT COUNT(*)
        FROM pvp_rooms
        WHERE status = 'open'
          AND phase NOT IN ('finished', 'aborted', 'closed')
          AND datetime(COALESCE(last_activity_at, updated_at, created_at)) < datetime('now', '-2 hours')
      ) AS stalled_rooms,
      (SELECT COUNT(*) FROM pvp_matches WHERE status = 'active') AS active_matches,
      (SELECT COUNT(*) FROM pvp_matches WHERE started_at >= datetime('now', '-7 day')) AS matches_7d,
      (SELECT COUNT(*) FROM pvp_room_chat_messages WHERE created_at >= datetime('now', '-7 day')) AS chat_messages_7d;
  `;

  const row = readFirstRow(await queryFromD1(overviewSql));
  return {
    openRooms: readInt(row.open_rooms),
    activeRooms: readInt(row.active_rooms),
    stalledRooms: readInt(row.stalled_rooms),
    activeMatches: readInt(row.active_matches),
    matches7d: readInt(row.matches_7d),
    chatMessages7d: readInt(row.chat_messages_7d),
  };
};

export const listAdminPvpActiveRooms = async (limit = 12): Promise<AdminPvpRoomRow[]> => {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const sql = `
    SELECT
      r.id,
      r.status,
      r.phase,
      r.host_user_id,
      u.username AS host_username,
      u.prefix AS host_prefix,
      r.current_match_id,
      CASE WHEN r.join_code_hash IS NOT NULL AND r.join_code_hash != '' THEN 1 ELSE 0 END AS has_password,
      COUNT(rp.user_id) AS player_count,
      COALESCE(SUM(CASE WHEN rp.role = 'player' THEN 1 ELSE 0 END), 0) AS participant_count,
      COALESCE(SUM(CASE WHEN rp.role = 'spectator' THEN 1 ELSE 0 END), 0) AS spectator_count,
      (
        SELECT COUNT(*)
        FROM pvp_room_chat_messages m
        WHERE m.room_id = r.id
      ) AS chat_message_count,
      r.created_at,
      r.updated_at,
      r.last_activity_at
    FROM pvp_rooms r
    LEFT JOIN users u ON u.id = r.host_user_id
    LEFT JOIN pvp_room_players rp ON rp.room_id = r.id
    WHERE r.status = 'open'
    GROUP BY r.id
    ORDER BY datetime(COALESCE(r.last_activity_at, r.updated_at, r.created_at)) DESC
    LIMIT ?;
  `;

  const result = await queryFromD1(sql, [safeLimit]);
  return readRows(result).map(mapRoomRow);
};

export const listAdminPvpRecentMatches = async (limit = 12): Promise<AdminPvpMatchRow[]> => {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const sql = `
    SELECT
      m.id,
      m.room_id,
      m.status,
      m.participants,
      COUNT(r.id) AS rounds_count,
      m.started_at,
      m.ended_at,
      m.winner_user_id,
      u.username AS winner_username
    FROM pvp_matches m
    LEFT JOIN pvp_rounds r ON r.match_id = m.id
    LEFT JOIN users u ON u.id = m.winner_user_id
    GROUP BY m.id
    ORDER BY datetime(m.started_at) DESC
    LIMIT ?;
  `;

  const result = await queryFromD1(sql, [safeLimit]);
  return readRows(result).map(mapMatchRow);
};

