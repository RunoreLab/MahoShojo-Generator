export type PvpPendingActionKind = 'submit' | 'choose' | 'confirm';

export type PvpPendingAction = {
  kind: PvpPendingActionKind;
  pendingUserId: number;
  startAt: string;
  deadlineAt: string;
  secondsLeft: number;
};

const parseIsoToMs = (iso: string | null | undefined): number | null => {
  if (!iso || typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

const msToIso = (ms: number): string => new Date(ms).toISOString();

const maxFinite = (values: number[]): number | null => {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length <= 0) return null;
  return Math.max(...finite);
};

const buildPendingAction = (kind: PvpPendingActionKind, pendingUserId: number, nowMs: number, startAtMs: number): PvpPendingAction => {
  const deadlineAtMs = startAtMs + 30_000;
  const secondsLeft = Math.max(0, Math.ceil((deadlineAtMs - nowMs) / 1000));
  return {
    kind,
    pendingUserId,
    startAt: msToIso(startAtMs),
    deadlineAt: msToIso(deadlineAtMs),
    secondsLeft,
  };
};

export function computeLastPendingSubmissionAction(input: {
  nowMs: number;
  phaseFallbackAt: string | null | undefined;
  players: Array<{ userId: number }>;
  submissions: Array<{ userId: number; updatedAt: string }>;
}): PvpPendingAction | null {
  const playerIds = new Set(input.players.map((p) => p.userId));
  const submittedByUserId = new Map<number, number>();
  for (const row of input.submissions) {
    if (!playerIds.has(row.userId)) continue;
    const ms = parseIsoToMs(row.updatedAt);
    if (ms === null) continue;
    submittedByUserId.set(row.userId, ms);
  }

  const pending = input.players.filter((p) => !submittedByUserId.has(p.userId)).map((p) => p.userId);
  if (pending.length !== 1) return null;

  const fallbackMs = parseIsoToMs(input.phaseFallbackAt) ?? input.nowMs;
  const startAtMs = maxFinite([...submittedByUserId.values()]) ?? fallbackMs;
  return buildPendingAction('submit', pending[0]!, input.nowMs, startAtMs);
}

export function computeLastPendingChooseAction(input: {
  nowMs: number;
  phaseFallbackAt: string | null | undefined;
  players: Array<{ userId: number }>;
  choices: Array<{ userId: number; updatedAt: string }>;
}): PvpPendingAction | null {
  const playerIds = new Set(input.players.map((p) => p.userId));
  const chosenByUserId = new Map<number, number>();
  for (const row of input.choices) {
    if (!playerIds.has(row.userId)) continue;
    const ms = parseIsoToMs(row.updatedAt);
    if (ms === null) continue;
    chosenByUserId.set(row.userId, ms);
  }

  const pending = input.players.filter((p) => !chosenByUserId.has(p.userId)).map((p) => p.userId);
  if (pending.length !== 1) return null;

  const fallbackMs = parseIsoToMs(input.phaseFallbackAt) ?? input.nowMs;
  const startAtMs = maxFinite([...chosenByUserId.values()]) ?? fallbackMs;
  return buildPendingAction('choose', pending[0]!, input.nowMs, startAtMs);
}

export function computeLastPendingConfirmAction(input: {
  nowMs: number;
  phaseFallbackAt: string | null | undefined;
  postRoundCreatedAt: string | null | undefined;
  players: Array<{ userId: number }>;
  confirmedUserIds: number[];
  confirmedAtByUserId?: Record<string, string> | null;
}): PvpPendingAction | null {
  const confirmedSet = new Set<number>(input.confirmedUserIds.filter((id) => typeof id === 'number' && Number.isFinite(id)).map((id) => Math.floor(id)));
  const pending = input.players.filter((p) => !confirmedSet.has(p.userId)).map((p) => p.userId);
  if (pending.length !== 1) return null;

  const fallbackMs = parseIsoToMs(input.postRoundCreatedAt) ?? parseIsoToMs(input.phaseFallbackAt) ?? input.nowMs;
  const confirmedMs: number[] = [];
  const map = input.confirmedAtByUserId && typeof input.confirmedAtByUserId === 'object' ? input.confirmedAtByUserId : null;
  if (map) {
    for (const userId of confirmedSet) {
      const ms = parseIsoToMs(map[String(userId)]);
      if (ms !== null) confirmedMs.push(ms);
    }
  }

  const startAtMs = maxFinite(confirmedMs) ?? fallbackMs;
  return buildPendingAction('confirm', pending[0]!, input.nowMs, startAtMs);
}

export const canForcePendingAction = (pending: PvpPendingAction, nowMs: number): boolean => {
  const deadlineMs = parseIsoToMs(pending.deadlineAt);
  if (deadlineMs === null) return false;
  return nowMs >= deadlineMs;
};

