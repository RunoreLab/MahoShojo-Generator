import { buildBotSubmissionPayload } from '@/lib/pvp/bot/submission';
import {
  clearPvpRoomRuntimeFromRulesJson,
  parsePvpRoomInternalState,
  stringifyPvpRoomInternalState,
} from '@/lib/pvp/bot/room';
import { requiresPvpSubmissionPhase } from '@/lib/pvp/logic';
import {
  canForcePendingAction,
  computeLastPendingChooseAction,
  computeLastPendingConfirmAction,
  computeLastPendingSubmissionAction,
} from '@/lib/pvp/pending-action';
import { getRequestOrigin } from '@/lib/pvp/origin';
import type { PvpHandState, PvpSnapshotRef, PvpSubmissionPayload } from '@/lib/pvp/types';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';

import { queryFromD1 } from './core';
import {
  clearPvpRoomEphemeralState,
  clearPvpRoomRuntimeState,
  getLatestPvpRoundByMatch,
  getPvpMatchById,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomPlayers,
  updatePvpMatch,
  updatePvpRound,
  updatePvpRoomCas,
  upsertPvpRoomSubmission,
  upsertPvpRoundChoice,
  type PvpRoomPhase,
  type PvpRoomRow,
} from './pvp';

export const ADMIN_PVP_STALLED_ROOM_MINUTES = 120;
const ADMIN_PVP_RESOLVING_STALLED_MINUTES = 10;
const DEFAULT_ROOM_LIMIT = 12;
const DEFAULT_MATCH_LIMIT = 12;
const MAX_LIST_LIMIT = 100;
const DEFAULT_DETAIL_CHAT_LIMIT = 80;
const DEFAULT_DETAIL_MATCH_LIMIT = 12;
const DEFAULT_DETAIL_ROUND_LIMIT = 30;
const DEFAULT_EXPORT_LIMIT = 500;

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
  version: number;
  hostUserId: number;
  hostUsername: string | null;
  hostPrefix: string | null;
  currentMatchId: string | null;
  currentMatchStatus: string | null;
  latestRoundId: string | null;
  latestRoundStatus: string | null;
  latestRoundIndex: number | null;
  hasPassword: boolean;
  playerCount: number;
  participantCount: number;
  spectatorCount: number;
  chatMessageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivityAt: string | null;
  idleMinutes: number;
  isStalled: boolean;
  issueTags: string[];
};

export type AdminPvpMatchRow = {
  id: string;
  roomId: string;
  roomStatus: string | null;
  roomPhase: string | null;
  status: string;
  participants: number;
  roundsCount: number;
  startedAt: string | null;
  endedAt: string | null;
  winnerUserId: number | null;
  winnerUsername: string | null;
};

export type AdminPvpRoomListFilters = {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'all' | 'open' | 'closed';
  phase?: 'all' | string;
  stalledOnly?: boolean;
};

export type AdminPvpMatchListFilters = {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'all' | 'active' | 'completed' | 'aborted';
  roomId?: string;
  userId?: number;
};

export type AdminPvpMemberRow = {
  roomId: string;
  userId: number;
  username: string | null;
  prefix: string | null;
  role: string;
  seat: number | null;
  joinedAt: string | null;
};

export type AdminPvpSubmissionSummary = {
  userId: number;
  username: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  cardCount: number;
  hasPrivateCard: boolean;
  cardNames: string[];
};

export type AdminPvpHandSummary = {
  userId: number;
  username: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  handCount: number;
  discardedCount: number;
  drawPileCount: number;
  snapshotIds: string[];
};

export type AdminPvpSnapshotSummary = {
  id: string;
  ownerUserId: number;
  ownerUsername: string | null;
  name: string;
  cardType: string;
  refLabel: string | null;
  sourceUpdatedAt: string | null;
  createdAt: string | null;
};

export type AdminPvpRoundChoiceSummary = {
  roundId: string;
  userId: number;
  username: string | null;
  snapshotId: string | null;
  snapshotName: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

export type AdminPvpRoomRoundSummary = {
  id: string;
  roomId: string;
  matchId: string | null;
  roundIndex: number;
  status: string;
  battleGenerationId: string | null;
  winnerUserId: number | null;
  winnerName: string | null;
  createdAt: string | null;
  resultJson: string | null;
  publicSnapshotJson: string | null;
  choiceCount: number;
  choices: AdminPvpRoundChoiceSummary[];
};

export type AdminPvpRoomChatRow = {
  id: number;
  roomId: string;
  senderUserId: number;
  senderRole: string;
  senderUsername: string | null;
  senderPrefix: string | null;
  renderedText: string | null;
  stickerId: string | null;
  emojiText: string | null;
  contentJson: string;
  createdAt: string | null;
};

export type AdminPvpPendingActionSummary = {
  kind: 'submit' | 'choose' | 'confirm';
  pendingUserId: number;
  pendingUsername: string | null;
  startAt: string;
  deadlineAt: string;
  secondsLeft: number;
  overdueSeconds: number;
  canForce: boolean;
};

export type AdminPvpRoomDiagnostics = {
  idleMinutes: number;
  isStalled: boolean;
  resolvingStuck: boolean;
  pendingAction: AdminPvpPendingActionSummary | null;
  issueTags: string[];
  availableActions: Array<'forcePending' | 'recoverResolving' | 'restartRoom' | 'closeRoom' | 'clearRoomEphemeral'>;
};

export type AdminPvpRulesSummary = {
  mode: string;
  participants: number;
  submissionMode: string;
  cardsPerPlayer: number;
  dealPerPlayer: number;
  drawSource: string;
  generationMode: string;
  allowSpectators: boolean;
  allowSpectatorChat: boolean;
  allowNonHostControl: boolean;
  storyLength: string;
  language: string;
};

export type AdminPvpRoomDetail = {
  room: AdminPvpRoomRow;
  rulesSummary: AdminPvpRulesSummary | null;
  rulesJson: string;
  currentMatch: AdminPvpMatchRow | null;
  recentMatches: AdminPvpMatchRow[];
  members: AdminPvpMemberRow[];
  submissions: AdminPvpSubmissionSummary[];
  hands: AdminPvpHandSummary[];
  snapshots: AdminPvpSnapshotSummary[];
  rounds: AdminPvpRoomRoundSummary[];
  chatMessages: AdminPvpRoomChatRow[];
  diagnostics: AdminPvpRoomDiagnostics;
};

export type AdminPvpMatchPlayerRow = {
  matchId: string;
  userId: number;
  username: string | null;
  userPrefix: string | null;
  seat: number;
  joinedAt: string | null;
};

export type AdminPvpMatchDetail = {
  match: AdminPvpMatchRow;
  matchRulesJson: string | null;
  players: AdminPvpMatchPlayerRow[];
  rounds: AdminPvpRoomRoundSummary[];
};

export type AdminPvpListResult<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

export type AdminPvpDashboardResponse = {
  overview: AdminPvpOverview;
  rooms: AdminPvpListResult<AdminPvpRoomRow>;
  matches: AdminPvpListResult<AdminPvpMatchRow>;
  roomDetail: AdminPvpRoomDetail | null;
  matchDetail: AdminPvpMatchDetail | null;
};

export type AdminPvpExportScope = 'rooms' | 'matches' | 'roomChats' | 'roomRounds';

export type AdminPvpExportResult = {
  filename: string;
  contentType: string;
  body: string;
};

export type AdminPvpAction =
  | {
      action: 'forcePending';
      roomId: string;
      expectedVersion?: number | null;
      kind?: 'submit' | 'choose' | 'confirm' | null;
      request: Request;
    }
  | {
      action: 'recoverResolving';
      roomId: string;
      expectedVersion?: number | null;
    }
  | {
      action: 'restartRoom';
      roomId: string;
      expectedVersion?: number | null;
    }
  | {
      action: 'closeRoom';
      roomId: string;
      expectedVersion?: number | null;
      cleanupMode?: 'preserve' | 'runtime' | 'ephemeral';
    }
  | {
      action: 'clearRoomEphemeral';
      roomId: string;
    };

export type AdminPvpActionResult = {
  roomId: string;
  action: AdminPvpAction['action'];
  message: string;
};

type D1Row = Record<string, unknown>;

type AdminPvpRoomDetailQueryRow = D1Row & {
  id?: unknown;
  status?: unknown;
  phase?: unknown;
  version?: unknown;
  host_user_id?: unknown;
  host_username?: unknown;
  host_prefix?: unknown;
  current_match_id?: unknown;
  current_match_status?: unknown;
  latest_round_id?: unknown;
  latest_round_status?: unknown;
  latest_round_index?: unknown;
  has_password?: unknown;
  player_count?: unknown;
  participant_count?: unknown;
  spectator_count?: unknown;
  chat_message_count?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  last_activity_at?: unknown;
};

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
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
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

const normalizePage = (value: number | undefined, fallback = 1): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value as number));
};

const normalizeLimit = (value: number | undefined, fallback = DEFAULT_ROOM_LIMIT): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(value as number)));
};

const normalizeExportLimit = (value: number | undefined, fallback = DEFAULT_EXPORT_LIMIT): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(DEFAULT_EXPORT_LIMIT, Math.floor(value as number)));
};

const escapeCsvCell = (value: unknown): string => {
  const raw = value == null ? '' : String(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const buildCsv = (headers: string[], rows: Array<Array<unknown>>): string => {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
};

const safeJsonParse = <T>(value: string | null | undefined): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const parseIsoToMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const computeIdleMinutes = (value: string | null | undefined, fallbackValue?: string | null | undefined): number => {
  const ms = parseIsoToMs(value) ?? parseIsoToMs(fallbackValue);
  if (ms === null) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 60_000));
};

const appendIssueTag = (list: string[], tag: string): void => {
  if (!list.includes(tag)) list.push(tag);
};

const normalizeRoomSearchTerm = (value: string | undefined): string | null => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized : null;
};

export const buildAdminPvpRoomWhereClause = (
  filters: AdminPvpRoomListFilters,
): { whereSql: string; params: Array<string | number> } => {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  const search = normalizeRoomSearchTerm(filters.search);
  if (search) {
    const like = `%${search}%`;
    if (/^\d+$/.test(search)) {
      clauses.push(
        "(r.id LIKE ? OR COALESCE(r.current_match_id, '') LIKE ? OR COALESCE(u.username, '') LIKE ? OR CAST(r.host_user_id AS TEXT) = ?)",
      );
      params.push(like, like, like, search);
    } else {
      clauses.push("(r.id LIKE ? OR COALESCE(r.current_match_id, '') LIKE ? OR COALESCE(u.username, '') LIKE ?)");
      params.push(like, like, like);
    }
  }

  if (filters.status === 'open' || filters.status === 'closed') {
    clauses.push('r.status = ?');
    params.push(filters.status);
  }

  const phase = typeof filters.phase === 'string' ? filters.phase.trim() : '';
  if (phase && phase !== 'all') {
    clauses.push('r.phase = ?');
    params.push(phase);
  }

  if (filters.stalledOnly) {
    clauses.push("r.status = 'open'");
    clauses.push("r.phase NOT IN ('finished', 'aborted', 'closed')");
    clauses.push(
      `datetime(COALESCE(r.last_activity_at, r.updated_at, r.created_at)) < datetime('now', '-${ADMIN_PVP_STALLED_ROOM_MINUTES} minutes')`,
    );
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
};

export const buildAdminPvpMatchWhereClause = (
  filters: AdminPvpMatchListFilters,
): { whereSql: string; params: Array<string | number> } => {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  const search = normalizeRoomSearchTerm(filters.search);
  if (search) {
    const like = `%${search}%`;
    if (/^\d+$/.test(search)) {
      clauses.push(
        "(" +
          "m.id LIKE ? " +
          "OR m.room_id LIKE ? " +
          "OR COALESCE(wu.username, '') LIKE ? " +
          "OR EXISTS (" +
          "  SELECT 1 FROM pvp_match_players mp" +
          "  WHERE mp.match_id = m.id AND (COALESCE(mp.username, '') LIKE ? OR CAST(mp.user_id AS TEXT) = ?)" +
          ")" +
        ")",
      );
      params.push(like, like, like, like, search);
    } else {
      clauses.push(
        "(" +
          "m.id LIKE ? " +
          "OR m.room_id LIKE ? " +
          "OR COALESCE(wu.username, '') LIKE ? " +
          "OR EXISTS (" +
          "  SELECT 1 FROM pvp_match_players mp" +
          "  WHERE mp.match_id = m.id AND COALESCE(mp.username, '') LIKE ?" +
          ")" +
        ")",
      );
      params.push(like, like, like, like);
    }
  }

  if (filters.status === 'active' || filters.status === 'completed' || filters.status === 'aborted') {
    clauses.push('m.status = ?');
    params.push(filters.status);
  }

  if (typeof filters.roomId === 'string' && filters.roomId.trim()) {
    clauses.push('m.room_id = ?');
    params.push(filters.roomId.trim());
  }

  if (typeof filters.userId === 'number' && Number.isFinite(filters.userId) && filters.userId > 0) {
    clauses.push('EXISTS (SELECT 1 FROM pvp_match_players mp2 WHERE mp2.match_id = m.id AND mp2.user_id = ?)');
    params.push(Math.floor(filters.userId));
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
};

const mapOverview = (row: D1Row): AdminPvpOverview => ({
  openRooms: readInt(row.open_rooms),
  activeRooms: readInt(row.active_rooms),
  stalledRooms: readInt(row.stalled_rooms),
  activeMatches: readInt(row.active_matches),
  matches7d: readInt(row.matches_7d),
  chatMessages7d: readInt(row.chat_messages_7d),
});

const deriveAdminPvpRoomIssues = (input: {
  status: string;
  phase: string;
  idleMinutes: number;
  currentMatchId: string | null;
  currentMatchStatus: string | null;
  latestRoundStatus: string | null;
}): { isStalled: boolean; issueTags: string[] } => {
  const issueTags: string[] = [];
  const isOpenRoom = input.status === 'open' && !['finished', 'aborted', 'closed'].includes(input.phase);
  const isStalled = isOpenRoom && input.idleMinutes >= ADMIN_PVP_STALLED_ROOM_MINUTES;

  if (isStalled) appendIssueTag(issueTags, '长时间无活动');
  if (input.phase === 'resolving' && input.idleMinutes >= ADMIN_PVP_RESOLVING_STALLED_MINUTES) {
    appendIssueTag(issueTags, '结算锁疑似卡住');
  }
  if (input.currentMatchId && input.currentMatchStatus === 'active' && ['waiting', 'submitting'].includes(input.phase)) {
    appendIssueTag(issueTags, '房间相位与对局状态不一致');
  }
  if (input.latestRoundStatus === 'resolving' && input.phase !== 'resolving') {
    appendIssueTag(issueTags, '回合状态滞后');
  }

  return { isStalled, issueTags };
};

const mapRoomRow = (row: D1Row): AdminPvpRoomRow => {
  const createdAt = readNullableString(row.created_at);
  const updatedAt = readNullableString(row.updated_at);
  const lastActivityAt = readNullableString(row.last_activity_at);
  const idleMinutes = computeIdleMinutes(lastActivityAt, updatedAt ?? createdAt);
  const status = readString(row.status);
  const phase = readString(row.phase);
  const currentMatchId = readNullableString(row.current_match_id);
  const currentMatchStatus = readNullableString(row.current_match_status);
  const latestRoundStatus = readNullableString(row.latest_round_status);
  const derived = deriveAdminPvpRoomIssues({
    status,
    phase,
    idleMinutes,
    currentMatchId,
    currentMatchStatus,
    latestRoundStatus,
  });

  return {
    id: readString(row.id),
    status,
    phase,
    version: readInt(row.version),
    hostUserId: readInt(row.host_user_id),
    hostUsername: readNullableString(row.host_username),
    hostPrefix: readNullableString(row.host_prefix),
    currentMatchId,
    currentMatchStatus,
    latestRoundId: readNullableString(row.latest_round_id),
    latestRoundStatus,
    latestRoundIndex: readNullableInt(row.latest_round_index),
    hasPassword: readBool(row.has_password),
    playerCount: readInt(row.player_count),
    participantCount: readInt(row.participant_count),
    spectatorCount: readInt(row.spectator_count),
    chatMessageCount: readInt(row.chat_message_count),
    createdAt,
    updatedAt,
    lastActivityAt,
    idleMinutes,
    isStalled: derived.isStalled,
    issueTags: derived.issueTags,
  };
};

const mapMatchRow = (row: D1Row): AdminPvpMatchRow => ({
  id: readString(row.id),
  roomId: readString(row.room_id),
  roomStatus: readNullableString(row.room_status),
  roomPhase: readNullableString(row.room_phase),
  status: readString(row.status),
  participants: readInt(row.participants),
  roundsCount: readInt(row.rounds_count),
  startedAt: readNullableString(row.started_at),
  endedAt: readNullableString(row.ended_at),
  winnerUserId: readNullableInt(row.winner_user_id),
  winnerUsername: readNullableString(row.winner_username),
});

const mapMemberRow = (row: D1Row): AdminPvpMemberRow => ({
  roomId: readString(row.room_id),
  userId: readInt(row.user_id),
  username: readNullableString(row.username),
  prefix: readNullableString(row.prefix),
  role: readString(row.role),
  seat: readNullableInt(row.seat),
  joinedAt: readNullableString(row.joined_at),
});

const toSubmissionSummary = (
  row: D1Row,
  usernameByUserId: Map<number, string | null>,
): AdminPvpSubmissionSummary => {
  const parsed = safeJsonParse<PvpSubmissionPayload>(readNullableString(row.submission_json));
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  return {
    userId: readInt(row.user_id),
    username: usernameByUserId.get(readInt(row.user_id)) ?? null,
    updatedAt: readNullableString(row.updated_at),
    createdAt: readNullableString(row.created_at),
    cardCount: cards.length,
    hasPrivateCard: parsed?.hasPrivateCard === true,
    cardNames: cards
      .map((item) => (item && typeof item === 'object' && typeof item.name === 'string' ? item.name : null))
      .filter(Boolean)
      .slice(0, 8) as string[],
  };
};

const toHandSummary = (
  row: D1Row,
  usernameByUserId: Map<number, string | null>,
): AdminPvpHandSummary => {
  const parsed = safeJsonParse<PvpHandState>(readNullableString(row.hand_json));
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  const discarded = Array.isArray(parsed?.discarded) ? parsed.discarded : [];
  const drawPile = Array.isArray(parsed?.drawPile) ? parsed.drawPile : [];
  const snapshotIds = cards
    .map((item) => (item && typeof item === 'object' && item.kind === 'snapshot' && typeof item.id === 'string' ? item.id : null))
    .filter(Boolean) as string[];

  return {
    userId: readInt(row.user_id),
    username: usernameByUserId.get(readInt(row.user_id)) ?? null,
    updatedAt: readNullableString(row.updated_at),
    createdAt: readNullableString(row.created_at),
    handCount: cards.length,
    discardedCount: discarded.length,
    drawPileCount: drawPile.length,
    snapshotIds,
  };
};

const toSnapshotSummary = (
  row: D1Row,
  usernameByUserId: Map<number, string | null>,
): AdminPvpSnapshotSummary => {
  const ref = safeJsonParse<Record<string, unknown>>(readNullableString(row.ref_json));
  let refLabel: string | null = null;
  if (ref && typeof ref.kind === 'string') {
    if (ref.kind === 'preset' && typeof ref.filename === 'string') refLabel = `preset:${ref.filename}`;
    if (ref.kind === 'data_card' && typeof ref.id === 'string') refLabel = `data_card:${ref.id}`;
    if (ref.kind === 'snapshot' && typeof ref.id === 'string') refLabel = `snapshot:${ref.id}`;
  }

  return {
    id: readString(row.id),
    ownerUserId: readInt(row.owner_user_id),
    ownerUsername: usernameByUserId.get(readInt(row.owner_user_id)) ?? null,
    name: readString(row.name),
    cardType: readString(row.card_type),
    refLabel,
    sourceUpdatedAt: readNullableString(row.source_updated_at),
    createdAt: readNullableString(row.created_at),
  };
};

const toRoundChoiceSummary = (
  row: D1Row,
  usernameByUserId: Map<number, string | null>,
  snapshotNameById: Map<string, string>,
): AdminPvpRoundChoiceSummary => {
  const parsed = safeJsonParse<PvpSnapshotRef>(readNullableString(row.choice_ref_json));
  const snapshotId = parsed && parsed.kind === 'snapshot' && typeof parsed.id === 'string' ? parsed.id : null;
  return {
    roundId: readString(row.round_id),
    userId: readInt(row.user_id),
    username: usernameByUserId.get(readInt(row.user_id)) ?? null,
    snapshotId,
    snapshotName: snapshotId ? snapshotNameById.get(snapshotId) ?? null : null,
    updatedAt: readNullableString(row.updated_at),
    createdAt: readNullableString(row.created_at),
  };
};

const toRoomRulesSummary = (rulesJson: string): AdminPvpRulesSummary | null => {
  const parsed = parsePvpRoomInternalState(rulesJson);
  if ('error' in parsed) return null;
  const { rules } = parsed.internal;
  return {
    mode: rules.mode,
    participants: rules.participants,
    submissionMode: rules.submissionMode,
    cardsPerPlayer: rules.cardsPerPlayer,
    dealPerPlayer: rules.dealPerPlayer,
    drawSource: rules.drawSource,
    generationMode: rules.generationMode,
    allowSpectators: rules.allowSpectators !== false,
    allowSpectatorChat: rules.allowSpectatorChat === true,
    allowNonHostControl: rules.allowNonHostControl === true,
    storyLength: rules.storyLength,
    language: rules.language,
  };
};

const buildPendingActionSummary = (
  pending:
    | ReturnType<typeof computeLastPendingSubmissionAction>
    | ReturnType<typeof computeLastPendingChooseAction>
    | ReturnType<typeof computeLastPendingConfirmAction>,
  usernameByUserId: Map<number, string | null>,
): AdminPvpPendingActionSummary | null => {
  if (!pending) return null;
  const nowMs = Date.now();
  return {
    kind: pending.kind as 'submit' | 'choose' | 'confirm',
    pendingUserId: pending.pendingUserId,
    pendingUsername: usernameByUserId.get(pending.pendingUserId) ?? null,
    startAt: pending.startAt,
    deadlineAt: pending.deadlineAt,
    secondsLeft: pending.secondsLeft,
    overdueSeconds: Math.max(0, Math.floor((nowMs - (parseIsoToMs(pending.deadlineAt) ?? nowMs)) / 1000)),
    canForce: canForcePendingAction(pending, nowMs),
  };
};

const deriveRoomDiagnostics = (input: {
  room: AdminPvpRoomRow;
  rulesJson: string;
  members: AdminPvpMemberRow[];
  submissions: AdminPvpSubmissionSummary[];
  hands: AdminPvpHandSummary[];
  rounds: AdminPvpRoomRoundSummary[];
}): AdminPvpRoomDiagnostics => {
  const usernameByUserId = new Map<number, string | null>(input.members.map((item) => [item.userId, item.username]));
  const players = input.members.filter((item) => item.role === 'player');
  const room = input.room;
  let pendingAction: AdminPvpPendingActionSummary | null = null;
  const issueTags = [...room.issueTags];

  if (room.phase === 'submitting') {
    const pending = computeLastPendingSubmissionAction({
      nowMs: Date.now(),
      phaseFallbackAt: room.lastActivityAt ?? room.updatedAt ?? room.createdAt,
      players: players.map((player) => ({ userId: player.userId })),
      submissions: input.submissions
        .filter((item) => item.updatedAt)
        .map((item) => ({ userId: item.userId, updatedAt: item.updatedAt as string })),
    });
    pendingAction = buildPendingActionSummary(pending, usernameByUserId);
  }

  if (room.phase === 'choosing') {
    const latestRound = [...input.rounds].sort((a, b) => {
      const msDelta = (parseIsoToMs(b.createdAt) ?? 0) - (parseIsoToMs(a.createdAt) ?? 0);
      if (msDelta !== 0) return msDelta;
      return b.roundIndex - a.roundIndex;
    })[0];
    if (latestRound) {
      const pending = computeLastPendingChooseAction({
        nowMs: Date.now(),
        phaseFallbackAt: latestRound.createdAt ?? room.lastActivityAt ?? room.updatedAt ?? room.createdAt,
        players: players.map((player) => ({ userId: player.userId })),
        choices: latestRound.choices
          .filter((item) => item.updatedAt)
          .map((item) => ({ userId: item.userId, updatedAt: item.updatedAt as string })),
      });
      pendingAction = buildPendingActionSummary(pending, usernameByUserId);
    }
  }

  if (room.phase === 'reviewing') {
    const parsed = parsePvpRoomInternalState(input.rulesJson);
    if (!('error' in parsed)) {
      const postRoundRaw = (parsed.internal.raw as Record<string, unknown>)._postRound;
      const postRound =
        postRoundRaw && typeof postRoundRaw === 'object' ? (postRoundRaw as Record<string, unknown>) : null;
      const confirmedUserIds = Array.isArray(postRound?.confirmedUserIds)
        ? postRound.confirmedUserIds
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            .map((value) => Math.floor(value))
        : [];
      const confirmedAtByUserId =
        postRound?.confirmedAtByUserId && typeof postRound.confirmedAtByUserId === 'object'
          ? (postRound.confirmedAtByUserId as Record<string, string>)
          : null;
      const pending = computeLastPendingConfirmAction({
        nowMs: Date.now(),
        phaseFallbackAt: room.lastActivityAt ?? room.updatedAt ?? room.createdAt,
        postRoundCreatedAt: typeof postRound?.createdAt === 'string' ? postRound.createdAt : null,
        players: players.map((player) => ({ userId: player.userId })),
        confirmedUserIds,
        confirmedAtByUserId,
      });
      pendingAction = buildPendingActionSummary(pending, usernameByUserId);
    }
  }

  const resolvingStuck = room.phase === 'resolving' && room.idleMinutes >= ADMIN_PVP_RESOLVING_STALLED_MINUTES;
  if (pendingAction?.canForce) appendIssueTag(issueTags, `最后一名玩家未${pendingAction.kind === 'submit' ? '提交' : pendingAction.kind === 'choose' ? '出牌' : '确认'}`);
  if (resolvingStuck) appendIssueTag(issueTags, '结算长时间未推进');

  const availableActions: AdminPvpRoomDiagnostics['availableActions'] = ['restartRoom', 'closeRoom', 'clearRoomEphemeral'];
  if (pendingAction?.canForce) availableActions.unshift('forcePending');
  if (resolvingStuck) availableActions.unshift('recoverResolving');

  return {
    idleMinutes: room.idleMinutes,
    isStalled: room.isStalled,
    resolvingStuck,
    pendingAction,
    issueTags,
    availableActions: Array.from(new Set(availableActions)),
  };
};

const querySingleInt = async (sql: string, params: unknown[] = []): Promise<number> => {
  const row = readFirstRow(await queryFromD1(sql, params));
  const firstValue = Object.values(row)[0];
  return readInt(firstValue);
};

const roomListSelectSql = `
  SELECT
    r.id,
    r.status,
    r.phase,
    r.version,
    r.host_user_id,
    u.username AS host_username,
    u.prefix AS host_prefix,
    r.current_match_id,
    cm.status AS current_match_status,
    lr.id AS latest_round_id,
    lr.status AS latest_round_status,
    lr.round_index AS latest_round_index,
    CASE WHEN r.join_code_hash IS NOT NULL AND r.join_code_hash != '' THEN 1 ELSE 0 END AS has_password,
    COALESCE(member_stats.player_count, 0) AS player_count,
    COALESCE(member_stats.participant_count, 0) AS participant_count,
    COALESCE(member_stats.spectator_count, 0) AS spectator_count,
    COALESCE(chat_stats.chat_message_count, 0) AS chat_message_count,
    r.created_at,
    r.updated_at,
    r.last_activity_at
  FROM pvp_rooms r
  LEFT JOIN users u ON u.id = r.host_user_id
  LEFT JOIN (
    SELECT
      room_id,
      COUNT(*) AS player_count,
      SUM(CASE WHEN role = 'player' THEN 1 ELSE 0 END) AS participant_count,
      SUM(CASE WHEN role = 'spectator' THEN 1 ELSE 0 END) AS spectator_count
    FROM pvp_room_players
    GROUP BY room_id
  ) member_stats ON member_stats.room_id = r.id
  LEFT JOIN (
    SELECT room_id, COUNT(*) AS chat_message_count
    FROM pvp_room_chat_messages
    GROUP BY room_id
  ) chat_stats ON chat_stats.room_id = r.id
  LEFT JOIN pvp_matches cm ON cm.id = r.current_match_id
  LEFT JOIN pvp_rounds lr ON lr.id = (
    SELECT pr.id
    FROM pvp_rounds pr
    WHERE pr.room_id = r.id
    ORDER BY datetime(pr.created_at) DESC, pr.round_index DESC
    LIMIT 1
  )
`;

const matchListSelectSql = `
  SELECT
    m.id,
    m.room_id,
    r.status AS room_status,
    r.phase AS room_phase,
    m.status,
    m.participants,
    COALESCE(round_stats.rounds_count, 0) AS rounds_count,
    m.started_at,
    m.ended_at,
    m.winner_user_id,
    wu.username AS winner_username
  FROM pvp_matches m
  LEFT JOIN users wu ON wu.id = m.winner_user_id
  LEFT JOIN pvp_rooms r ON r.id = m.room_id
  LEFT JOIN (
    SELECT match_id, COUNT(*) AS rounds_count
    FROM pvp_rounds
    GROUP BY match_id
  ) round_stats ON round_stats.match_id = m.id
`;

export const getAdminPvpOverview = async (): Promise<AdminPvpOverview> => {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM pvp_rooms WHERE status = 'open') AS open_rooms,
      (SELECT COUNT(*) FROM pvp_rooms WHERE status = 'open' AND phase NOT IN ('finished', 'aborted', 'closed')) AS active_rooms,
      (
        SELECT COUNT(*)
        FROM pvp_rooms
        WHERE status = 'open'
          AND phase NOT IN ('finished', 'aborted', 'closed')
          AND datetime(COALESCE(last_activity_at, updated_at, created_at)) < datetime('now', '-${ADMIN_PVP_STALLED_ROOM_MINUTES} minutes')
      ) AS stalled_rooms,
      (SELECT COUNT(*) FROM pvp_matches WHERE status = 'active') AS active_matches,
      (SELECT COUNT(*) FROM pvp_matches WHERE started_at >= datetime('now', '-7 day')) AS matches_7d,
      (SELECT COUNT(*) FROM pvp_room_chat_messages WHERE created_at >= datetime('now', '-7 day')) AS chat_messages_7d;
  `;

  return mapOverview(readFirstRow(await queryFromD1(sql)));
};

export const listAdminPvpRooms = async (
  filters: AdminPvpRoomListFilters = {},
): Promise<AdminPvpListResult<AdminPvpRoomRow>> => {
  const page = normalizePage(filters.page, 1);
  const limit = normalizeLimit(filters.limit, DEFAULT_ROOM_LIMIT);
  const offset = (page - 1) * limit;
  const where = buildAdminPvpRoomWhereClause(filters);

  const countSql = `
    SELECT COUNT(*) AS total
    FROM pvp_rooms r
    LEFT JOIN users u ON u.id = r.host_user_id
    ${where.whereSql};
  `;

  const listSql = `
    ${roomListSelectSql}
    ${where.whereSql}
    ORDER BY datetime(COALESCE(r.last_activity_at, r.updated_at, r.created_at)) DESC
    LIMIT ? OFFSET ?;
  `;

  const [total, rows] = await Promise.all([
    querySingleInt(countSql, where.params),
    queryFromD1(listSql, [...where.params, limit, offset]),
  ]);

  return {
    items: readRows(rows).map(mapRoomRow),
    total,
    page,
    limit,
  };
};

export const listAdminPvpActiveRooms = async (limit = DEFAULT_ROOM_LIMIT): Promise<AdminPvpRoomRow[]> => {
  const result = await listAdminPvpRooms({
    page: 1,
    limit,
    status: 'open',
  });
  return result.items;
};

export const listAdminPvpMatches = async (
  filters: AdminPvpMatchListFilters = {},
): Promise<AdminPvpListResult<AdminPvpMatchRow>> => {
  const page = normalizePage(filters.page, 1);
  const limit = normalizeLimit(filters.limit, DEFAULT_MATCH_LIMIT);
  const offset = (page - 1) * limit;
  const where = buildAdminPvpMatchWhereClause(filters);

  const countSql = `
    SELECT COUNT(*) AS total
    FROM pvp_matches m
    LEFT JOIN users wu ON wu.id = m.winner_user_id
    ${where.whereSql};
  `;

  const listSql = `
    ${matchListSelectSql}
    ${where.whereSql}
    ORDER BY datetime(m.started_at) DESC
    LIMIT ? OFFSET ?;
  `;

  const [total, rows] = await Promise.all([
    querySingleInt(countSql, where.params),
    queryFromD1(listSql, [...where.params, limit, offset]),
  ]);

  return {
    items: readRows(rows).map(mapMatchRow),
    total,
    page,
    limit,
  };
};

export const listAdminPvpRecentMatches = async (limit = DEFAULT_MATCH_LIMIT): Promise<AdminPvpMatchRow[]> => {
  const result = await listAdminPvpMatches({ page: 1, limit });
  return result.items;
};

const getRoomBaseDetailRow = async (roomId: string): Promise<AdminPvpRoomDetailQueryRow | null> => {
  const sql = `
    ${roomListSelectSql}
    WHERE r.id = ?
    LIMIT 1;
  `;
  const row = readFirstRow(await queryFromD1(sql, [roomId]));
  return readString(row.id) ? (row as AdminPvpRoomDetailQueryRow) : null;
};

const getRoomMembers = async (roomId: string): Promise<AdminPvpMemberRow[]> => {
  const sql = `
    SELECT
      rp.room_id,
      rp.user_id,
      u.username,
      u.prefix,
      rp.role,
      rp.seat,
      rp.joined_at
    FROM pvp_room_players rp
    LEFT JOIN users u ON u.id = rp.user_id
    WHERE rp.room_id = ?
    ORDER BY CASE WHEN rp.role = 'player' THEN 0 ELSE 1 END ASC, COALESCE(rp.seat, 999) ASC, datetime(rp.joined_at) ASC;
  `;
  return readRows(await queryFromD1(sql, [roomId])).map(mapMemberRow);
};

const getRoomSubmissions = async (roomId: string): Promise<D1Row[]> => {
  const sql = `
    SELECT room_id, user_id, submission_json, created_at, updated_at
    FROM pvp_room_submissions
    WHERE room_id = ?
    ORDER BY datetime(updated_at) DESC;
  `;
  return readRows(await queryFromD1(sql, [roomId]));
};

const getRoomHands = async (roomId: string): Promise<D1Row[]> => {
  const sql = `
    SELECT room_id, user_id, hand_json, created_at, updated_at
    FROM pvp_room_hands
    WHERE room_id = ?
    ORDER BY datetime(updated_at) DESC;
  `;
  return readRows(await queryFromD1(sql, [roomId]));
};

const getRoomSnapshots = async (roomId: string): Promise<D1Row[]> => {
  const sql = `
    SELECT id, room_id, owner_user_id, ref_json, card_type, name, source_updated_at, created_at
    FROM pvp_room_card_snapshots
    WHERE room_id = ?
    ORDER BY datetime(created_at) DESC;
  `;
  return readRows(await queryFromD1(sql, [roomId]));
};

const getRoomRounds = async (roomId: string, limit: number): Promise<D1Row[]> => {
  const sql = `
    SELECT
      id,
      room_id,
      match_id,
      round_index,
      status,
      battle_generation_id,
      result_json,
      public_snapshot_json,
      winner_user_id,
      winner_name,
      created_at
    FROM pvp_rounds
    WHERE room_id = ?
    ORDER BY datetime(created_at) DESC, round_index DESC
    LIMIT ?;
  `;
  return readRows(await queryFromD1(sql, [roomId, limit]));
};

const getRoomRoundChoices = async (roomId: string, roundLimit: number): Promise<D1Row[]> => {
  const sql = `
    SELECT
      c.round_id,
      c.user_id,
      c.choice_ref_json,
      c.created_at,
      c.updated_at
    FROM pvp_round_choices c
    INNER JOIN (
      SELECT id
      FROM pvp_rounds
      WHERE room_id = ?
      ORDER BY datetime(created_at) DESC, round_index DESC
      LIMIT ?
    ) r ON r.id = c.round_id
    ORDER BY datetime(c.updated_at) DESC;
  `;
  return readRows(await queryFromD1(sql, [roomId, roundLimit]));
};

const getRoomChats = async (roomId: string, limit: number): Promise<AdminPvpRoomChatRow[]> => {
  const sql = `
    SELECT
      id,
      room_id,
      sender_user_id,
      sender_role,
      sender_username,
      sender_prefix,
      rendered_text,
      sticker_id,
      emoji_text,
      content_json,
      created_at
    FROM pvp_room_chat_messages
    WHERE room_id = ?
    ORDER BY id DESC
    LIMIT ?;
  `;
  return readRows(await queryFromD1(sql, [roomId, limit])).map((row) => ({
    id: readInt(row.id),
    roomId: readString(row.room_id),
    senderUserId: readInt(row.sender_user_id),
    senderRole: readString(row.sender_role),
    senderUsername: readNullableString(row.sender_username),
    senderPrefix: readNullableString(row.sender_prefix),
    renderedText: readNullableString(row.rendered_text),
    stickerId: readNullableString(row.sticker_id),
    emojiText: readNullableString(row.emoji_text),
    contentJson: readString(row.content_json),
    createdAt: readNullableString(row.created_at),
  }));
};

const getRecentMatchesByRoomId = async (roomId: string, limit: number): Promise<AdminPvpMatchRow[]> => {
  const result = await queryFromD1(
    `
      ${matchListSelectSql}
      WHERE m.room_id = ?
      ORDER BY datetime(m.started_at) DESC
      LIMIT ?;
    `,
    [roomId, limit],
  );
  return readRows(result).map(mapMatchRow);
};

const mapRoomRounds = (
  rows: D1Row[],
  choiceRows: D1Row[],
  usernameByUserId: Map<number, string | null>,
  snapshotNameById: Map<string, string>,
): AdminPvpRoomRoundSummary[] => {
  const choicesByRoundId = new Map<string, AdminPvpRoundChoiceSummary[]>();
  for (const row of choiceRows) {
    const item = toRoundChoiceSummary(row, usernameByUserId, snapshotNameById);
    const list = choicesByRoundId.get(item.roundId) ?? [];
    list.push(item);
    choicesByRoundId.set(item.roundId, list);
  }

  return rows.map((row) => {
    const roundId = readString(row.id);
    const choices = choicesByRoundId.get(roundId) ?? [];
    return {
      id: roundId,
      roomId: readString(row.room_id),
      matchId: readNullableString(row.match_id),
      roundIndex: readInt(row.round_index),
      status: readString(row.status),
      battleGenerationId: readNullableString(row.battle_generation_id),
      winnerUserId: readNullableInt(row.winner_user_id),
      winnerName: readNullableString(row.winner_name),
      createdAt: readNullableString(row.created_at),
      resultJson: readNullableString(row.result_json),
      publicSnapshotJson: readNullableString(row.public_snapshot_json),
      choiceCount: choices.length,
      choices,
    };
  });
};

const getCurrentMatchSummary = async (matchId: string | null): Promise<AdminPvpMatchRow | null> => {
  if (!matchId) return null;
  const result = await queryFromD1(
    `
      ${matchListSelectSql}
      WHERE m.id = ?
      LIMIT 1;
    `,
    [matchId],
  );
  const row = readFirstRow(result);
  return readString(row.id) ? mapMatchRow(row) : null;
};

export const getAdminPvpRoomDetail = async (
  roomId: string,
  options?: {
    chatLimit?: number;
    matchLimit?: number;
    roundLimit?: number;
  },
): Promise<AdminPvpRoomDetail | null> => {
  const chatLimit = normalizeLimit(options?.chatLimit, DEFAULT_DETAIL_CHAT_LIMIT);
  const matchLimit = normalizeLimit(options?.matchLimit, DEFAULT_DETAIL_MATCH_LIMIT);
  const roundLimit = normalizeLimit(options?.roundLimit, DEFAULT_DETAIL_ROUND_LIMIT);

  const baseRow = await getRoomBaseDetailRow(roomId);
  if (!baseRow) return null;

  const roomRecord = await getPvpRoomById(roomId);
  if (!roomRecord) return null;

  const [members, submissionRows, handRows, snapshotRows, roundRows, choiceRows, chatMessages, recentMatches, currentMatch] =
    await Promise.all([
      getRoomMembers(roomId),
      getRoomSubmissions(roomId),
      getRoomHands(roomId),
      getRoomSnapshots(roomId),
      getRoomRounds(roomId, roundLimit),
      getRoomRoundChoices(roomId, roundLimit),
      getRoomChats(roomId, chatLimit),
      getRecentMatchesByRoomId(roomId, matchLimit),
      getCurrentMatchSummary(readNullableString(baseRow.current_match_id)),
    ]);

  const room = mapRoomRow(baseRow);
  const usernameByUserId = new Map<number, string | null>(members.map((member) => [member.userId, member.username]));
  const snapshotSummaries = snapshotRows.map((row) => toSnapshotSummary(row, usernameByUserId));
  const snapshotNameById = new Map(snapshotSummaries.map((item) => [item.id, item.name]));
  const submissions = submissionRows.map((row) => toSubmissionSummary(row, usernameByUserId));
  const hands = handRows.map((row) => toHandSummary(row, usernameByUserId));
  const rounds = mapRoomRounds(roundRows, choiceRows, usernameByUserId, snapshotNameById);
  const diagnostics = deriveRoomDiagnostics({
    room,
    rulesJson: roomRecord.rules_json,
    members,
    submissions,
    hands,
    rounds,
  });

  return {
    room,
    rulesSummary: toRoomRulesSummary(roomRecord.rules_json),
    rulesJson: roomRecord.rules_json,
    currentMatch,
    recentMatches,
    members,
    submissions,
    hands,
    snapshots: snapshotSummaries,
    rounds,
    chatMessages,
    diagnostics,
  };
};

const getMatchBaseRow = async (matchId: string): Promise<AdminPvpMatchRow | null> => {
  const result = await queryFromD1(
    `
      ${matchListSelectSql}
      WHERE m.id = ?
      LIMIT 1;
    `,
    [matchId],
  );
  const row = readFirstRow(result);
  return readString(row.id) ? mapMatchRow(row) : null;
};

const getMatchPlayers = async (matchId: string): Promise<AdminPvpMatchPlayerRow[]> => {
  const sql = `
    SELECT match_id, user_id, username, user_prefix, seat, joined_at
    FROM pvp_match_players
    WHERE match_id = ?
    ORDER BY seat ASC;
  `;
  return readRows(await queryFromD1(sql, [matchId])).map((row) => ({
    matchId: readString(row.match_id),
    userId: readInt(row.user_id),
    username: readNullableString(row.username),
    userPrefix: readNullableString(row.user_prefix),
    seat: readInt(row.seat),
    joinedAt: readNullableString(row.joined_at),
  }));
};

const getMatchRounds = async (matchId: string): Promise<D1Row[]> => {
  const sql = `
    SELECT
      id,
      room_id,
      match_id,
      round_index,
      status,
      battle_generation_id,
      result_json,
      public_snapshot_json,
      winner_user_id,
      winner_name,
      created_at
    FROM pvp_rounds
    WHERE match_id = ?
    ORDER BY round_index ASC, datetime(created_at) ASC;
  `;
  return readRows(await queryFromD1(sql, [matchId]));
};

const getMatchRoundChoices = async (matchId: string): Promise<D1Row[]> => {
  const sql = `
    SELECT
      c.round_id,
      c.user_id,
      c.choice_ref_json,
      c.created_at,
      c.updated_at
    FROM pvp_round_choices c
    INNER JOIN pvp_rounds r ON r.id = c.round_id
    WHERE r.match_id = ?
    ORDER BY datetime(c.updated_at) ASC;
  `;
  return readRows(await queryFromD1(sql, [matchId]));
};

const getMatchSnapshotNames = async (roomId: string): Promise<Map<string, string>> => {
  const sql = `
    SELECT id, name
    FROM pvp_room_card_snapshots
    WHERE room_id = ?;
  `;
  const rows = readRows(await queryFromD1(sql, [roomId]));
  return new Map(
    rows
      .map((row) => [readString(row.id), readString(row.name)] as const)
      .filter((item) => Boolean(item[0])),
  );
};

export const getAdminPvpMatchDetail = async (matchId: string): Promise<AdminPvpMatchDetail | null> => {
  const match = await getMatchBaseRow(matchId);
  if (!match) return null;

  const fullMatch = await getPvpMatchById(matchId);
  const [players, roundRows, choiceRows, snapshotNameById] = await Promise.all([
    getMatchPlayers(matchId),
    getMatchRounds(matchId),
    getMatchRoundChoices(matchId),
    getMatchSnapshotNames(match.roomId),
  ]);

  const usernameByUserId = new Map<number, string | null>(players.map((player) => [player.userId, player.username]));
  const rounds = mapRoomRounds(roundRows, choiceRows, usernameByUserId, snapshotNameById);

  return {
    match,
    matchRulesJson: fullMatch?.rules_json ?? null,
    players,
    rounds,
  };
};

export const getAdminPvpDashboardData = async (input?: {
  roomFilters?: AdminPvpRoomListFilters;
  matchFilters?: AdminPvpMatchListFilters;
  roomId?: string | null;
  matchId?: string | null;
}): Promise<AdminPvpDashboardResponse> => {
  const roomId = typeof input?.roomId === 'string' && input.roomId.trim() ? input.roomId.trim() : null;
  const matchId = typeof input?.matchId === 'string' && input.matchId.trim() ? input.matchId.trim() : null;

  const [overview, rooms, matches, roomDetail, matchDetail] = await Promise.all([
    getAdminPvpOverview(),
    listAdminPvpRooms(input?.roomFilters),
    listAdminPvpMatches(input?.matchFilters),
    roomId ? getAdminPvpRoomDetail(roomId) : Promise.resolve(null),
    matchId ? getAdminPvpMatchDetail(matchId) : Promise.resolve(null),
  ]);

  return {
    overview,
    rooms,
    matches,
    roomDetail,
    matchDetail,
  };
};

const assertRoomForIntervention = async (
  roomId: string,
  expectedVersion?: number | null,
): Promise<PvpRoomRow> => {
  const room = await getPvpRoomById(roomId);
  if (!room) {
    throw new Error('房间不存在');
  }
  if (expectedVersion != null && Number.isFinite(expectedVersion) && Math.floor(expectedVersion) !== room.version) {
    throw new Error('版本冲突，请刷新后重试');
  }
  return room;
};

const buildAdminInterventionNote = (action: string, room: PvpRoomRow, nowIso: string): string =>
  JSON.stringify({
    adminIntervention: {
      action,
      at: nowIso,
      previousPhase: room.phase,
      previousStatus: room.status,
      currentMatchId: room.current_match_id,
    },
  });

const abortCurrentMatchIfNeeded = async (room: PvpRoomRow, action: string, nowIso: string): Promise<void> => {
  if (!room.current_match_id) return;
  const match = await getPvpMatchById(room.current_match_id);
  if (match && match.status === 'active') {
    const updated = await updatePvpMatch(match.id, {
      status: 'aborted',
      endedAt: nowIso,
      resultJson: match.result_json ?? buildAdminInterventionNote(action, room, nowIso),
    });
    if (!updated) {
      throw new Error('更新对局状态失败');
    }
  }

  const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
  if (latestRound && latestRound.status !== 'completed' && latestRound.status !== 'aborted') {
    const updatedRound = await updatePvpRound(latestRound.id, {
      status: 'aborted',
      resultJson: latestRound.result_json ?? buildAdminInterventionNote(action, room, nowIso),
    });
    if (!updatedRound) {
      throw new Error('更新回合状态失败');
    }
  }
};

const parseHand = (raw: string): PvpHandState | null => {
  const parsed = safeJsonParse<PvpHandState>(raw);
  if (!parsed || !Array.isArray(parsed.cards) || !Array.isArray(parsed.discarded)) return null;
  return parsed;
};

const resolveAdminForcePendingKind = (
  requestedKind: 'submit' | 'choose' | 'confirm' | null | undefined,
  detail: AdminPvpRoomDetail,
): 'submit' | 'choose' | 'confirm' => {
  if (requestedKind === 'submit' || requestedKind === 'choose' || requestedKind === 'confirm') {
    return requestedKind;
  }
  if (detail.diagnostics.pendingAction?.kind) {
    return detail.diagnostics.pendingAction.kind;
  }
  throw new Error('当前没有可强制推进的最后一步');
};

const executeForcePendingSubmission = async (
  req: Request,
  room: PvpRoomRow,
  detail: AdminPvpRoomDetail,
  expectedVersion: number,
): Promise<void> => {
  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) throw new Error(parsed.error);

  if (room.phase !== 'submitting') throw new Error('当前阶段不允许强制提交');
  const pending = detail.diagnostics.pendingAction;
  if (!pending || pending.kind !== 'submit' || !pending.canForce) {
    throw new Error('当前不满足强制提交条件');
  }

  const rules = parsed.internal.rules;
  if (rules.cardsPerPlayer <= 0) throw new Error('当前房间无需提交卡组');

  const origin = getRequestOrigin(req);
  const forwardHeaders = buildSubrequestAuthHeaders(req);
  const submission = await buildBotSubmissionPayload({
    rules,
    origin,
    forwardHeaders,
  });
  if (submission.cards.length !== rules.cardsPerPlayer) {
    throw new Error('随机卡组构建失败，无法强制提交');
  }

  const ok = await upsertPvpRoomSubmission(room.id, pending.pendingUserId, JSON.stringify(submission));
  if (!ok) throw new Error('写入强制提交结果失败');

  const casOk = await updatePvpRoomCas(room.id, expectedVersion, {
    last_activity_at: new Date().toISOString(),
  });
  if (!casOk) throw new Error('房间状态更新失败，请刷新后重试');
};

const executeForcePendingChoose = async (
  room: PvpRoomRow,
  detail: AdminPvpRoomDetail,
  expectedVersion: number,
): Promise<void> => {
  if (room.phase !== 'choosing') throw new Error('当前阶段不允许强制出牌');
  if (!room.current_match_id) throw new Error('对局上下文缺失');
  const pending = detail.diagnostics.pendingAction;
  if (!pending || pending.kind !== 'choose' || !pending.canForce) {
    throw new Error('当前不满足强制出牌条件');
  }
  if (expectedVersion !== room.version) throw new Error('版本冲突，请刷新后重试');

  const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
  if (!latestRound || latestRound.status !== 'pending') throw new Error('当前回合不可强制出牌');

  const hands = await getPvpRoomHands(room.id);
  const handRow = hands.find((item) => item.user_id === pending.pendingUserId);
  if (!handRow) throw new Error('未找到目标玩家手牌');
  const hand = parseHand(handRow.hand_json);
  if (!hand) throw new Error('目标玩家手牌数据损坏');
  const snapshotIds = hand.cards
    .map((item) => (item && typeof item === 'object' && item.kind === 'snapshot' && typeof item.id === 'string' ? item.id : null))
    .filter(Boolean) as string[];
  if (snapshotIds.length <= 0) throw new Error('目标玩家手牌为空，无法强制出牌');

  const snapshotId = snapshotIds[Math.floor(Math.random() * snapshotIds.length)] as string;
  const choice: PvpSnapshotRef = { kind: 'snapshot', id: snapshotId };
  const ok = await upsertPvpRoundChoice(latestRound.id, pending.pendingUserId, JSON.stringify(choice));
  if (!ok) throw new Error('写入强制出牌结果失败');
};

const executeForcePendingConfirm = async (
  room: PvpRoomRow,
  detail: AdminPvpRoomDetail,
  expectedVersion: number,
): Promise<void> => {
  if (room.phase !== 'reviewing') throw new Error('当前阶段不允许强制确认');
  const pending = detail.diagnostics.pendingAction;
  if (!pending || pending.kind !== 'confirm' || !pending.canForce) {
    throw new Error('当前不满足强制确认条件');
  }

  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) throw new Error(parsed.error);
  const internal = parsed.internal;
  const postRoundRaw = (internal.raw as Record<string, unknown>)._postRound;
  const postRound = postRoundRaw && typeof postRoundRaw === 'object' ? (postRoundRaw as Record<string, unknown>) : {};
  const confirmedUserIds = Array.isArray(postRound.confirmedUserIds)
    ? postRound.confirmedUserIds
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        .map((value) => Math.floor(value))
    : [];
  const confirmedSet = new Set<number>(confirmedUserIds);
  confirmedSet.add(pending.pendingUserId);

  const confirmedAtByUserId =
    postRound.confirmedAtByUserId && typeof postRound.confirmedAtByUserId === 'object'
      ? ({ ...(postRound.confirmedAtByUserId as Record<string, string>) } as Record<string, string>)
      : {};
  const nowIso = new Date().toISOString();
  confirmedAtByUserId[String(pending.pendingUserId)] = nowIso;

  (internal.raw as Record<string, unknown>)._postRound = {
    ...postRound,
    confirmedUserIds: [...confirmedSet],
    confirmedAtByUserId,
    updatedAt: nowIso,
  };

  const ok = await updatePvpRoomCas(room.id, expectedVersion, {
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: nowIso,
  });
  if (!ok) throw new Error('写入强制确认结果失败，请刷新后重试');
};

const recoverResolvingRoom = async (room: PvpRoomRow, expectedVersion: number): Promise<void> => {
  const nowIso = new Date().toISOString();
  if (!room.current_match_id) throw new Error('当前房间没有进行中的对局');
  const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
  if (!latestRound) throw new Error('未找到当前回合');

  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) throw new Error(parsed.error);

  let nextPhase: PvpRoomPhase = 'choosing';
  if (parsed.internal.raw._winnerVote) nextPhase = 'voting';
  else if (latestRound.result_json) nextPhase = 'reviewing';

  if (latestRound.status === 'resolving') {
    const updatedRound = await updatePvpRound(latestRound.id, {
      status: latestRound.result_json ? 'completed' : 'pending',
    });
    if (!updatedRound) throw new Error('回合状态回滚失败');
  }

  const ok = await updatePvpRoomCas(room.id, expectedVersion, {
    phase: nextPhase,
    last_activity_at: nowIso,
  });
  if (!ok) throw new Error('房间状态回滚失败，请刷新后重试');
};

const restartRoomForAdmin = async (room: PvpRoomRow, expectedVersion: number): Promise<void> => {
  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) throw new Error(parsed.error);

  const nowIso = new Date().toISOString();
  await abortCurrentMatchIfNeeded(room, 'restartRoom', nowIso);

  const cleared = await clearPvpRoomRuntimeState(room.id);
  if (!cleared) throw new Error('清理房间运行时状态失败');

  const players = await getPvpRoomPlayers(room.id);
  const nextPhase: PvpRoomPhase =
    players.length >= parsed.internal.rules.participants && requiresPvpSubmissionPhase(parsed.internal.rules)
      ? 'submitting'
      : 'waiting';

  const ok = await updatePvpRoomCas(room.id, expectedVersion, {
    status: 'open',
    phase: nextPhase,
    current_match_id: null,
    rules_json: clearPvpRoomRuntimeFromRulesJson(room.rules_json),
    last_activity_at: nowIso,
  });
  if (!ok) throw new Error('重开房间失败，请刷新后重试');
};

const closeRoomForAdmin = async (
  room: PvpRoomRow,
  expectedVersion: number,
  cleanupMode: 'preserve' | 'runtime' | 'ephemeral',
): Promise<void> => {
  const nowIso = new Date().toISOString();
  await abortCurrentMatchIfNeeded(room, 'closeRoom', nowIso);

  const ok = await updatePvpRoomCas(room.id, expectedVersion, {
    status: 'closed',
    phase: 'closed',
    current_match_id: null,
    rules_json: clearPvpRoomRuntimeFromRulesJson(room.rules_json),
    last_activity_at: nowIso,
  });
  if (!ok) throw new Error('关闭房间失败，请刷新后重试');

  if (cleanupMode === 'runtime') {
    const cleared = await clearPvpRoomRuntimeState(room.id);
    if (!cleared) throw new Error('清理房间运行时状态失败');
  }
  if (cleanupMode === 'ephemeral') {
    const cleared = await clearPvpRoomEphemeralState(room.id);
    if (!cleared) throw new Error('清理房间临时状态失败');
  }
};

export const executeAdminPvpAction = async (input: AdminPvpAction): Promise<AdminPvpActionResult> => {
  if (input.action === 'clearRoomEphemeral') {
    const cleared = await clearPvpRoomEphemeralState(input.roomId);
    if (!cleared) throw new Error('清理房间临时状态失败');
    return {
      roomId: input.roomId,
      action: input.action,
      message: '已清理房间聊天、临时手牌、提交和回合选择缓存。',
    };
  }

  const room = await assertRoomForIntervention(input.roomId, input.expectedVersion);
  const expectedVersion = input.expectedVersion != null ? Math.floor(input.expectedVersion) : room.version;

  if (input.action === 'recoverResolving') {
    await recoverResolvingRoom(room, expectedVersion);
    return {
      roomId: room.id,
      action: input.action,
      message: '已解除 resolving 锁并将房间退回可继续处理的阶段。',
    };
  }

  if (input.action === 'restartRoom') {
    await restartRoomForAdmin(room, expectedVersion);
    return {
      roomId: room.id,
      action: input.action,
      message: '已强制重开房间，进行中的对局已标记为 aborted。',
    };
  }

  if (input.action === 'closeRoom') {
    await closeRoomForAdmin(room, expectedVersion, input.cleanupMode ?? 'runtime');
    return {
      roomId: room.id,
      action: input.action,
      message: `已关闭房间，并按 ${input.cleanupMode ?? 'runtime'} 模式清理。`,
    };
  }

  const detail = await getAdminPvpRoomDetail(room.id, {
    chatLimit: 20,
    matchLimit: 5,
    roundLimit: 8,
  });
  if (!detail) throw new Error('读取房间详情失败');

  const kind = resolveAdminForcePendingKind(input.kind, detail);
  if (kind === 'submit') {
    await executeForcePendingSubmission(input.request, room, detail, expectedVersion);
  } else if (kind === 'choose') {
    await executeForcePendingChoose(room, detail, expectedVersion);
  } else {
    await executeForcePendingConfirm(room, detail, expectedVersion);
  }

  return {
    roomId: room.id,
    action: input.action,
    message: `已强制推进 ${kind === 'submit' ? '提交' : kind === 'choose' ? '出牌' : '确认'} 阶段。`,
  };
};

const buildRoomsCsv = (rows: AdminPvpRoomRow[]): string =>
  buildCsv(
    [
      'roomId',
      'status',
      'phase',
      'version',
      'hostUserId',
      'hostUsername',
      'currentMatchId',
      'currentMatchStatus',
      'latestRoundId',
      'latestRoundStatus',
      'latestRoundIndex',
      'playerCount',
      'participantCount',
      'spectatorCount',
      'chatMessageCount',
      'idleMinutes',
      'isStalled',
      'issueTags',
      'lastActivityAt',
      'updatedAt',
      'createdAt',
    ],
    rows.map((row) => [
      row.id,
      row.status,
      row.phase,
      row.version,
      row.hostUserId,
      row.hostUsername ?? '',
      row.currentMatchId ?? '',
      row.currentMatchStatus ?? '',
      row.latestRoundId ?? '',
      row.latestRoundStatus ?? '',
      row.latestRoundIndex ?? '',
      row.playerCount,
      row.participantCount,
      row.spectatorCount,
      row.chatMessageCount,
      row.idleMinutes,
      row.isStalled ? 1 : 0,
      row.issueTags.join(' | '),
      row.lastActivityAt ?? '',
      row.updatedAt ?? '',
      row.createdAt ?? '',
    ]),
  );

const buildMatchesCsv = (rows: AdminPvpMatchRow[]): string =>
  buildCsv(
    [
      'matchId',
      'roomId',
      'roomStatus',
      'roomPhase',
      'status',
      'participants',
      'roundsCount',
      'winnerUserId',
      'winnerUsername',
      'startedAt',
      'endedAt',
    ],
    rows.map((row) => [
      row.id,
      row.roomId,
      row.roomStatus ?? '',
      row.roomPhase ?? '',
      row.status,
      row.participants,
      row.roundsCount,
      row.winnerUserId ?? '',
      row.winnerUsername ?? '',
      row.startedAt ?? '',
      row.endedAt ?? '',
    ]),
  );

const buildRoomChatsCsv = (rows: AdminPvpRoomChatRow[]): string =>
  buildCsv(
    [
      'chatId',
      'roomId',
      'senderUserId',
      'senderUsername',
      'senderRole',
      'senderPrefix',
      'renderedText',
      'stickerId',
      'emojiText',
      'contentJson',
      'createdAt',
    ],
    rows.map((row) => [
      row.id,
      row.roomId,
      row.senderUserId,
      row.senderUsername ?? '',
      row.senderRole,
      row.senderPrefix ?? '',
      row.renderedText ?? '',
      row.stickerId ?? '',
      row.emojiText ?? '',
      row.contentJson,
      row.createdAt ?? '',
    ]),
  );

const buildRoomRoundsCsv = (rows: AdminPvpRoomRoundSummary[]): string =>
  buildCsv(
    [
      'roundId',
      'roomId',
      'matchId',
      'roundIndex',
      'status',
      'battleGenerationId',
      'winnerUserId',
      'winnerName',
      'choiceCount',
      'choiceUsers',
      'createdAt',
      'resultJson',
    ],
    rows.map((row) => [
      row.id,
      row.roomId,
      row.matchId ?? '',
      row.roundIndex,
      row.status,
      row.battleGenerationId ?? '',
      row.winnerUserId ?? '',
      row.winnerName ?? '',
      row.choiceCount,
      row.choices.map((choice) => `${choice.username ?? choice.userId}:${choice.snapshotName ?? choice.snapshotId ?? '—'}`).join(' | '),
      row.createdAt ?? '',
      row.resultJson ?? '',
    ]),
  );

export const exportAdminPvpData = async (input: {
  scope: AdminPvpExportScope;
  roomFilters?: AdminPvpRoomListFilters;
  matchFilters?: AdminPvpMatchListFilters;
  roomId?: string | null;
  maxRows?: number;
}): Promise<AdminPvpExportResult> => {
  const maxRows = normalizeExportLimit(input.maxRows, DEFAULT_EXPORT_LIMIT);

  if (input.scope === 'rooms') {
    const rooms = await listAdminPvpRooms({
      ...(input.roomFilters ?? {}),
      page: 1,
      limit: maxRows,
    });
    return {
      filename: `pvp-rooms-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: buildRoomsCsv(rooms.items),
    };
  }

  if (input.scope === 'matches') {
    const matches = await listAdminPvpMatches({
      ...(input.matchFilters ?? {}),
      page: 1,
      limit: maxRows,
    });
    return {
      filename: `pvp-matches-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: buildMatchesCsv(matches.items),
    };
  }

  const roomId = typeof input.roomId === 'string' && input.roomId.trim() ? input.roomId.trim() : null;
  if (!roomId) throw new Error('导出房间明细必须提供 roomId');
  const detail = await getAdminPvpRoomDetail(roomId, {
    chatLimit: input.scope === 'roomChats' ? maxRows : DEFAULT_DETAIL_CHAT_LIMIT,
    roundLimit: input.scope === 'roomRounds' ? maxRows : DEFAULT_DETAIL_ROUND_LIMIT,
  });
  if (!detail) throw new Error('房间不存在');

  if (input.scope === 'roomChats') {
    return {
      filename: `pvp-room-${roomId}-chat.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: buildRoomChatsCsv(detail.chatMessages),
    };
  }

  return {
    filename: `pvp-room-${roomId}-rounds.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: buildRoomRoundsCsv(detail.rounds),
  };
};
