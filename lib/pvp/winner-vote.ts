export type PvpWinnerVoteReason = 'auto_invalid' | 'host_override';

export type PvpWinnerVoteChoice =
  | { kind: 'seat'; seat: number }
  | { kind: 'draw' };

export type PvpWinnerVoteBallot = {
  choice: PvpWinnerVoteChoice;
  votedAt: string;
};

export type PvpWinnerVoteState = {
  roundId: string;
  matchId: string;
  createdAt: string;
  createdByUserId: number;
  reason: PvpWinnerVoteReason;
  eligibleUserIds: number[];
  votesByUserId: Record<string, PvpWinnerVoteBallot>;
  updatedAt?: string | null;
};

const normalizeUserIds = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .map((x) => (typeof x === 'number' && Number.isFinite(x) ? Math.floor(x) : null))
    .filter((x): x is number => typeof x === 'number' && x > 0);
  return [...new Set(ids)];
};

const normalizeIso = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const iso = raw.trim();
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
};

const normalizeChoice = (raw: unknown): PvpWinnerVoteChoice | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as any;
  const kind = typeof obj.kind === 'string' ? obj.kind : '';
  if (kind === 'draw') return { kind: 'draw' };
  if (kind === 'seat') {
    const seat = Number.isFinite(obj.seat) ? Math.floor(obj.seat) : null;
    if (seat === null || seat < 0) return null;
    return { kind: 'seat', seat };
  }
  return null;
};

export const parsePvpWinnerVoteState = (raw: unknown): PvpWinnerVoteState | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as any;

  const roundId = typeof obj.roundId === 'string' ? obj.roundId.trim() : '';
  const matchId = typeof obj.matchId === 'string' ? obj.matchId.trim() : '';
  const createdAt = normalizeIso(obj.createdAt);
  const createdByUserId = typeof obj.createdByUserId === 'number' && Number.isFinite(obj.createdByUserId) ? Math.floor(obj.createdByUserId) : null;
  const reason = obj.reason === 'host_override' ? 'host_override' : obj.reason === 'auto_invalid' ? 'auto_invalid' : null;
  const eligibleUserIds = normalizeUserIds(obj.eligibleUserIds);

  if (!roundId || !matchId || !createdAt || !createdByUserId || !reason) return null;

  const votesByUserId: Record<string, PvpWinnerVoteBallot> = {};
  const rawVotes = obj.votesByUserId && typeof obj.votesByUserId === 'object' ? (obj.votesByUserId as Record<string, unknown>) : null;
  if (rawVotes) {
    for (const [k, v] of Object.entries(rawVotes)) {
      const userId = typeof k === 'string' ? k.trim() : '';
      const numericUserId = Number.isFinite(Number(userId)) ? Math.floor(Number(userId)) : null;
      if (!userId || !numericUserId || numericUserId <= 0) continue;
      if (!v || typeof v !== 'object') continue;
      const choice = normalizeChoice((v as any).choice);
      const votedAt = normalizeIso((v as any).votedAt);
      if (!choice || !votedAt) continue;
      votesByUserId[String(numericUserId)] = { choice, votedAt };
    }
  }

  const updatedAt = normalizeIso(obj.updatedAt);

  return {
    roundId,
    matchId,
    createdAt,
    createdByUserId,
    reason,
    eligibleUserIds,
    votesByUserId,
    updatedAt,
  };
};

export const createPvpWinnerVoteState = (input: {
  roundId: string;
  matchId: string;
  createdAt: string;
  createdByUserId: number;
  reason: PvpWinnerVoteReason;
  eligibleUserIds: number[];
}): PvpWinnerVoteState => {
  const createdAt = normalizeIso(input.createdAt) ?? new Date().toISOString();
  const createdByUserId = Math.max(1, Math.floor(input.createdByUserId));
  const roundId = input.roundId.trim();
  const matchId = input.matchId.trim();
  const eligibleUserIds = [...new Set(input.eligibleUserIds.map((x) => Math.floor(x)).filter((x) => Number.isFinite(x) && x > 0))];
  return {
    roundId,
    matchId,
    createdAt,
    createdByUserId,
    reason: input.reason,
    eligibleUserIds,
    votesByUserId: {},
    updatedAt: createdAt,
  };
};

export const upsertPvpWinnerVoteBallot = (
  state: PvpWinnerVoteState,
  userId: number,
  choice: PvpWinnerVoteChoice,
  votedAtIso: string,
): PvpWinnerVoteState => {
  const uid = Math.max(1, Math.floor(userId));
  const votedAt = normalizeIso(votedAtIso) ?? new Date().toISOString();
  return {
    ...state,
    votesByUserId: {
      ...(state.votesByUserId ?? {}),
      [String(uid)]: { choice, votedAt },
    },
    updatedAt: votedAt,
  };
};

export type PvpWinnerVoteTally = {
  eligibleCount: number;
  voteCount: number;
  countsBySeat: Record<string, number>;
  drawCount: number;
  winnerSeat: number | null;
  tied: boolean;
  topCount: number;
};

export const tallyPvpWinnerVotes = (input: {
  eligibleUserIds: number[];
  votesByUserId: Record<string, PvpWinnerVoteBallot>;
  validSeats: number[];
}): PvpWinnerVoteTally => {
  const eligible = new Set(input.eligibleUserIds.map((x) => Math.floor(x)).filter((x) => Number.isFinite(x) && x > 0));
  const validSeatSet = new Set(input.validSeats.map((x) => Math.floor(x)).filter((x) => Number.isFinite(x) && x >= 0));

  const countsBySeat = new Map<number, number>();
  let drawCount = 0;
  let voteCount = 0;

  for (const [userIdKey, ballot] of Object.entries(input.votesByUserId ?? {})) {
    const uid = Number.isFinite(Number(userIdKey)) ? Math.floor(Number(userIdKey)) : null;
    if (!uid || !eligible.has(uid)) continue;
    if (!ballot || typeof ballot !== 'object') continue;
    const choice = ballot.choice;
    if (!choice || typeof choice !== 'object') continue;

    if (choice.kind === 'draw') {
      drawCount += 1;
      voteCount += 1;
      continue;
    }
    if (choice.kind === 'seat') {
      const seat = Math.floor(choice.seat);
      if (!Number.isFinite(seat) || seat < 0) continue;
      if (!validSeatSet.has(seat)) continue;
      countsBySeat.set(seat, (countsBySeat.get(seat) || 0) + 1);
      voteCount += 1;
    }
  }

  const eligibleCount = eligible.size;

  let topCount = 0;
  let topKind: 'draw' | 'seat' | null = null;
  let topSeat: number | null = null;
  let tied = false;

  const seatEntries = [...countsBySeat.entries()].sort((a, b) => a[0] - b[0]);
  for (const [seat, count] of seatEntries) {
    if (count > topCount) {
      topCount = count;
      topKind = 'seat';
      topSeat = seat;
      tied = false;
    } else if (count === topCount && count > 0) {
      tied = true;
    }
  }

  if (drawCount > topCount) {
    topCount = drawCount;
    topKind = 'draw';
    topSeat = null;
    tied = false;
  } else if (drawCount === topCount && topCount > 0) {
    tied = true;
  }

  const winnerSeat = tied || !topKind ? null : topKind === 'seat' ? topSeat : null;

  const countsBySeatObj: Record<string, number> = {};
  for (const [seat, count] of seatEntries) countsBySeatObj[String(seat)] = count;

  return {
    eligibleCount,
    voteCount,
    countsBySeat: countsBySeatObj,
    drawCount,
    winnerSeat,
    tied,
    topCount,
  };
};

