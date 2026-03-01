export type PvpUserSummaryReadDto = {
  userId: number;
  completedMatches: number;
  wins: number;
  losses: number;
  draws: number;
  abortedMatches: number;
  lastPlayedAt: string | null;
};

export type PvpMatchReadDto = {
  id: string;
  roomId: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  winnerUserId: number | null;
};

export type PvpMatchPlayerReadDto = {
  matchId: string;
  userId: number;
  seat: number;
  username: string | null;
  prefix: string | null;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readString = (source: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const readNumber = (source: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = source[key];
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return Math.floor(numeric);
  }
  return null;
};

const normalizeNonNegativeInt = (value: number | null, fallback = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value as number));
};

const normalizeNullableInt = (value: number | null): number | null => {
  if (!Number.isFinite(value)) return null;
  return Math.floor(value as number);
};

export const buildDefaultPvpUserSummary = (userId: number): PvpUserSummaryReadDto => ({
  userId,
  completedMatches: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  abortedMatches: 0,
  lastPlayedAt: null,
});

export const computePvpWinRate = (summary: Pick<PvpUserSummaryReadDto, 'wins' | 'losses' | 'draws'>): number => {
  const total = summary.wins + summary.losses + summary.draws;
  if (total <= 0) return 0;
  return Math.round((summary.wins / total) * 100);
};

export const mapPvpUserSummaryRow = (input: unknown, fallbackUserId = 0): PvpUserSummaryReadDto => {
  const source = toRecord(input) ?? {};
  const userId = normalizeNonNegativeInt(readNumber(source, ['userId', 'user_id']), fallbackUserId);
  return {
    userId,
    completedMatches: normalizeNonNegativeInt(readNumber(source, ['completedMatches', 'completed_matches']), 0),
    wins: normalizeNonNegativeInt(readNumber(source, ['wins']), 0),
    losses: normalizeNonNegativeInt(readNumber(source, ['losses']), 0),
    draws: normalizeNonNegativeInt(readNumber(source, ['draws']), 0),
    abortedMatches: normalizeNonNegativeInt(readNumber(source, ['abortedMatches', 'aborted_matches']), 0),
    lastPlayedAt: readString(source, ['lastPlayedAt', 'last_played_at']) ?? null,
  };
};

export const mapPvpMatchRow = (input: unknown): PvpMatchReadDto => {
  const source = toRecord(input) ?? {};
  return {
    id: readString(source, ['id']) ?? '',
    roomId: readString(source, ['roomId', 'room_id']) ?? null,
    status: readString(source, ['status']) ?? 'active',
    startedAt: readString(source, ['startedAt', 'started_at']) ?? '',
    endedAt: readString(source, ['endedAt', 'ended_at']) ?? null,
    winnerUserId: normalizeNullableInt(readNumber(source, ['winnerUserId', 'winner_user_id'])),
  };
};

export const mapPvpMatchPlayerRow = (input: unknown): PvpMatchPlayerReadDto => {
  const source = toRecord(input) ?? {};
  return {
    matchId: readString(source, ['matchId', 'match_id']) ?? '',
    userId: normalizeNonNegativeInt(readNumber(source, ['userId', 'user_id']), 0),
    seat: normalizeNonNegativeInt(readNumber(source, ['seat']), 0),
    username: readString(source, ['username']) ?? null,
    prefix: readString(source, ['prefix', 'userPrefix', 'user_prefix']) ?? null,
  };
};
