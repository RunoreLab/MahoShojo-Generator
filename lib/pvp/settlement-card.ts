import { formatPvpDisplayName } from '@/lib/pvp/displayName';

export type PvpSettlementCardRoundCombatant = {
  userId: number | null;
  seat: number;
  isBot: boolean;
  snapshotId: string;
  name: string;
  type: string | null;
};

export type PvpSettlementCardRoundResult = {
  winnerUserId: number | null;
  winnerName: string | null;
  winnerSeat: number | null;
  winnerIsBot: boolean | null;
  winnerStatus?: string | null;
  combatants: PvpSettlementCardRoundCombatant[];
  report?: {
    headline?: string | null;
    officialReport?: { winner?: string | null } | null;
  } | null;
};

export type PvpSettlementCardRoundSummary = {
  roundId: string;
  roundIndex: number;
  status: string;
  headline: string | null;
  winner: {
    seat: number | null;
    userId: number | null;
    username: string;
    characterName: string | null;
    isBot: boolean | null;
    status: 'final' | 'draw' | 'pending' | 'unknown';
  };
  myPlay: {
    seat: number | null;
    snapshotId: string | null;
    name: string | null;
    type: string | null;
  } | null;
};

const safeString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function parsePvpRoundResultJson(raw: string | null | undefined): PvpSettlementCardRoundResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return null;
    const combatantsRaw = Array.isArray(parsed.combatants) ? parsed.combatants : [];
    const combatants: PvpSettlementCardRoundCombatant[] = combatantsRaw
      .map((c: any) => {
        const seat = typeof c?.seat === 'number' && Number.isFinite(c.seat) ? Math.floor(c.seat) : null;
        const snapshotId = typeof c?.snapshotId === 'string' ? c.snapshotId : null;
        if (seat === null || !snapshotId) return null;
        return {
          userId: typeof c?.userId === 'number' && Number.isFinite(c.userId) ? Math.floor(c.userId) : null,
          seat,
          isBot: Boolean(c?.isBot),
          snapshotId,
          name: typeof c?.name === 'string' && c.name.trim() ? c.name.trim() : '未命名',
          type: typeof c?.type === 'string' && c.type.trim() ? c.type.trim() : null,
        };
      })
      .filter(Boolean) as PvpSettlementCardRoundCombatant[];

    const report = parsed.report && typeof parsed.report === 'object' ? parsed.report : null;
    const reportHeadline = report ? safeString(report.headline) : null;
    const officialReport = report && typeof report.officialReport === 'object' ? report.officialReport : null;
    const officialWinner = officialReport ? safeString(officialReport.winner) : null;

    return {
      winnerUserId: typeof parsed.winnerUserId === 'number' && Number.isFinite(parsed.winnerUserId) ? Math.floor(parsed.winnerUserId) : null,
      winnerName: safeString(parsed.winnerName),
      winnerSeat: typeof parsed.winnerSeat === 'number' && Number.isFinite(parsed.winnerSeat) ? Math.floor(parsed.winnerSeat) : null,
      winnerIsBot: parsed.winnerIsBot == null ? null : Boolean(parsed.winnerIsBot),
      winnerStatus: safeString(parsed.winnerStatus),
      combatants,
      report: report
        ? {
            headline: reportHeadline,
            officialReport: officialReport ? { winner: officialWinner } : null,
          }
        : null,
    };
  } catch {
    return null;
  }
}

export function buildPvpSettlementRoundSummary(params: {
  roundId: string;
  roundIndex: number;
  status: string;
  result: PvpSettlementCardRoundResult | null;
  usernameByUserId: Map<number, string>;
  isBotByUserId: Map<number, boolean>;
  myUserId: number | null;
}): PvpSettlementCardRoundSummary {
  const { roundId, roundIndex, status, result, usernameByUserId, isBotByUserId, myUserId } = params;

  const headline =
    (result?.report?.headline && result.report.headline.trim() ? result.report.headline.trim() : null) ??
    (status === 'completed' ? '（无标题）' : null);

  const winnerSeat = typeof result?.winnerSeat === 'number' ? result.winnerSeat : null;
  const winnerUserId = typeof result?.winnerUserId === 'number' ? result.winnerUserId : null;
  const winnerIsBot = result?.winnerIsBot ?? (winnerUserId != null ? (isBotByUserId.get(winnerUserId) ?? null) : null);
  const winnerCharacterName = result?.winnerName ?? null;

  const winnerStatus: PvpSettlementCardRoundSummary['winner']['status'] =
    status !== 'completed' ? 'pending' : winnerSeat == null && winnerUserId == null ? 'draw' : 'final';

  const winnerUsername =
    winnerStatus === 'draw'
      ? '平局'
      : formatPvpDisplayName({
          userId: winnerUserId,
          username: winnerUserId != null ? (usernameByUserId.get(winnerUserId) ?? null) : null,
          isBot: winnerIsBot ?? null,
        });

  const myCombatant =
    myUserId == null ? null : (result?.combatants ?? []).find((c) => typeof c.userId === 'number' && c.userId === myUserId) ?? null;

  return {
    roundId,
    roundIndex,
    status,
    headline,
    winner: {
      seat: winnerSeat,
      userId: winnerUserId,
      username: winnerUsername,
      characterName: winnerCharacterName,
      isBot: winnerIsBot,
      status: winnerStatus,
    },
    myPlay: myCombatant
      ? {
          seat: myCombatant.seat,
          snapshotId: myCombatant.snapshotId,
          name: myCombatant.name,
          type: myCombatant.type,
        }
      : null,
  };
}

