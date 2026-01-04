import { formatPvpDisplayName } from '@/lib/pvp/displayName';

export type PvpSettlementCardRoundCombatant = {
  userId: number | null;
  seat: number;
  isBot: boolean;
  snapshotId: string;
  name: string;
  type: string | null;
  characterGuidance?: string | null;
};

export type PvpSettlementCardRoundResult = {
  generationMode?: string | null;
  winnerUserId: number | null;
  winnerName: string | null;
  winnerSeat: number | null;
  winnerIsBot: boolean | null;
  winnerStatus?: string | null;
  reportMarkdown?: string | null;
  streamMeta?: any;
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
    guidance?: string | null;
  } | null;
};

const safeString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const extractHeadlineFromMarkdown = (markdown: string | null | undefined): string | null => {
  if (typeof markdown !== 'string') return null;
  const pickHeading = (re: RegExp): string | null => {
    const match = markdown.match(re);
    const raw = match ? match[1] : '';
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text ? text : null;
  };

  // 优先取主标题，避免把“## 胜利者/战斗经过”当作标题
  const h1 = pickHeading(/^\s*#\s+(.*)(?:\r?\n|$)/m);
  if (h1) return h1;
  const h2 = pickHeading(/^\s*##\s+(.*)(?:\r?\n|$)/m);
  if (h2) return h2;
  const h3 = pickHeading(/^\s*###\s+(.*)(?:\r?\n|$)/m);
  if (h3) return h3;

  // 最后兜底：取第一行可读文本
  const firstLine = markdown
    .split(/\r?\n|\u2028|\u2029|\\n/g)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('<!--') && !line.startsWith('---'));
  if (!firstLine) return null;
  const normalized = firstLine.replace(/^[-*>#\s]+/, '').trim();
  if (!normalized) return null;
  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
};

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
        const characterGuidance =
          typeof c?.characterGuidance === 'string' ? c.characterGuidance.trim().slice(0, 100) : null;
        return {
          userId: typeof c?.userId === 'number' && Number.isFinite(c.userId) ? Math.floor(c.userId) : null,
          seat,
          isBot: Boolean(c?.isBot),
          snapshotId,
          name: typeof c?.name === 'string' && c.name.trim() ? c.name.trim() : '未命名',
          type: typeof c?.type === 'string' && c.type.trim() ? c.type.trim() : null,
          characterGuidance,
        };
      })
      .filter(Boolean) as PvpSettlementCardRoundCombatant[];

    const report = parsed.report && typeof parsed.report === 'object' ? parsed.report : null;
    const reportHeadline = report ? safeString(report.headline) : null;
    const reportArticleBody = report && typeof report.article === 'object' ? safeString(report.article?.body) : null;

    const reportMarkdown = safeString(parsed.reportMarkdown) ?? reportArticleBody;

    const streamMeta = parsed.streamMeta && typeof parsed.streamMeta === 'object' ? parsed.streamMeta : null;
    const metaHeadline =
      safeString(streamMeta?.report?.headline) ??
      safeString(streamMeta?.report?.title) ??
      safeString(streamMeta?.report?.headlineText) ??
      null;

    const resolvedHeadline =
      (reportHeadline && reportHeadline.trim() ? reportHeadline.trim() : null) ??
      (metaHeadline && metaHeadline.trim() ? metaHeadline.trim() : null) ??
      extractHeadlineFromMarkdown(reportMarkdown);

    const officialReport = report && typeof report.officialReport === 'object' ? report.officialReport : null;
    const officialWinner = officialReport ? safeString(officialReport.winner) : null;

    const shouldProvideReport = Boolean(report) || Boolean(resolvedHeadline) || Boolean(officialWinner);

    return {
      generationMode: safeString(parsed.generationMode),
      winnerUserId: typeof parsed.winnerUserId === 'number' && Number.isFinite(parsed.winnerUserId) ? Math.floor(parsed.winnerUserId) : null,
      winnerName: safeString(parsed.winnerName),
      winnerSeat: typeof parsed.winnerSeat === 'number' && Number.isFinite(parsed.winnerSeat) ? Math.floor(parsed.winnerSeat) : null,
      winnerIsBot: parsed.winnerIsBot == null ? null : Boolean(parsed.winnerIsBot),
      winnerStatus: safeString(parsed.winnerStatus),
      reportMarkdown,
      streamMeta,
      combatants,
      report: shouldProvideReport
        ? {
            headline: resolvedHeadline,
            officialReport: officialWinner != null ? { winner: officialWinner } : null,
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
  userIdBySeat?: Map<number, number>;
  myUserId: number | null;
}): PvpSettlementCardRoundSummary {
  const { roundId, roundIndex, status, result, usernameByUserId, isBotByUserId, userIdBySeat, myUserId } = params;

  const headline =
    (result?.report?.headline && result.report.headline.trim() ? result.report.headline.trim() : null) ??
    (status === 'completed' ? '（无标题）' : null);

  const winnerSeat = typeof result?.winnerSeat === 'number' ? result.winnerSeat : null;
  const winnerUserId = typeof result?.winnerUserId === 'number' ? result.winnerUserId : null;
  const winnerUserIdFromSeat =
    winnerUserId != null
      ? winnerUserId
      : winnerSeat == null
        ? null
        : (userIdBySeat?.get(winnerSeat) ?? (result?.combatants ?? []).find((c) => c.seat === winnerSeat)?.userId ?? null);

  const winnerIsBot =
    result?.winnerIsBot ?? (winnerUserIdFromSeat != null ? (isBotByUserId.get(winnerUserIdFromSeat) ?? null) : null);
  const winnerCharacterName = result?.winnerName ?? null;

  const winnerStatus: PvpSettlementCardRoundSummary['winner']['status'] =
    status !== 'completed' ? 'pending' : winnerSeat == null && winnerUserId == null ? 'draw' : 'final';

  const winnerUsername =
    winnerStatus === 'draw'
      ? '平局'
      : formatPvpDisplayName({
          userId: winnerUserIdFromSeat,
          username: winnerUserIdFromSeat != null ? (usernameByUserId.get(winnerUserIdFromSeat) ?? null) : null,
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
      userId: winnerUserIdFromSeat,
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
          guidance: myCombatant.characterGuidance ?? null,
        }
      : null,
  };
}
