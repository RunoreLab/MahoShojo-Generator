import {
  getPvpCardSnapshotById,
  getPvpRoomById,
  getPvpRoomMembers,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  getPvpRoundsByMatch,
  getPvpUserSummariesByUserIds,
} from '@/lib/database/pvp';
import {
  getUserBadges,
  getUserEquippedBadges,
} from '@/lib/database/badges';
import {
  getUserProfileByUserId,
} from '@/lib/database/users';
import { botUserIdForClient, parsePvpRoomBotRoster, parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { formatPvpDisplayName } from '@/lib/pvp/displayName';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpSubmissionPayload } from '@/lib/pvp/types';
import type { UserBadge } from '@/types/badge';
import { buildPvpSettlementRoundSummary, parsePvpRoundResultJson } from '@/lib/pvp/settlement-card';

type SnapshotLite = {
  snapshotId: string;
  name: string;
  type: string | null;
  ref: any;
};

const parseSubmission = (raw: string): PvpSubmissionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSubmissionPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const readInitialHandSnapshotIds = (params: {
  internalRaw: any;
  currentMatchId: string;
  mySeat: number | null;
}): string[] => {
  const { internalRaw, currentMatchId, mySeat } = params;
  if (mySeat == null) return [];

  const matchId = typeof internalRaw?._initialHandsMatchId === 'string' ? internalRaw._initialHandsMatchId : null;
  if (!matchId || matchId !== currentMatchId) return [];

  const map = internalRaw?._initialHandsBySeat;
  if (!map || typeof map !== 'object') return [];

  const list = (map as any)[String(mySeat)];
  if (!Array.isArray(list)) return [];
  return list.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim());
};

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  const members = await getPvpRoomMembers(roomId);
  const myMember = members.find((m) => m.user_id === auth.user.id) ?? null;
  if (!myMember) return json({ error: '无权访问该房间' }, { status: 403 });

  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
  const internal = parsed.internal;
  const rules = internal.rules;

  const currentMatchId = room.current_match_id;
  if (!currentMatchId) return json({ error: '当前房间尚未开始对局' }, { status: 409 });

  const players = await getPvpRoomPlayers(roomId);
  const bots = internal.bots;
  const botRoster = bots.length > 0 ? [] : parsePvpRoomBotRoster(internal.raw);
  const displayBots = bots.length > 0 ? bots.map((b) => ({ id: b.id, name: b.name, seat: b.seat })) : botRoster;

  const participants = [
    ...players.map((p) => ({
      userId: p.user_id,
      username: p.username ?? null,
      prefix: p.prefix ?? null,
      seat: typeof p.seat === 'number' ? p.seat : null,
      isBot: false,
      botId: null as string | null,
    })),
    ...displayBots.map((b) => ({
      userId: botUserIdForClient(b.seat),
      username: b.name ?? null,
      prefix: null,
      seat: b.seat,
      isBot: true,
      botId: b.id,
    })),
  ].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));

  const badgesByUserId = new Map<number, UserBadge[]>();
  await Promise.all(
    players.map(async (p) => {
      const userId = typeof p?.user_id === 'number' ? p.user_id : null;
      if (!userId) return;
      const badges = await getUserEquippedBadges(userId);
      badgesByUserId.set(userId, Array.isArray(badges) ? badges : []);
    })
  );

  const mySeat = (() => {
    const p = participants.find((x) => x.userId === auth.user.id);
    return typeof p?.seat === 'number' ? p.seat : null;
  })();

  const usernameByUserId = new Map<number, string>();
  const isBotByUserId = new Map<number, boolean>();
  for (const p of participants) {
    if (typeof p.userId !== 'number' || !Number.isFinite(p.userId)) continue;
    usernameByUserId.set(p.userId, typeof p.username === 'string' && p.username.trim() ? p.username.trim() : `用户${p.userId}`);
    isBotByUserId.set(p.userId, Boolean(p.isBot));
  }

  const userIdBySeat = new Map<number, number>();
  for (const p of participants) {
    if (typeof p.seat !== 'number' || !Number.isFinite(p.seat)) continue;
    if (typeof p.userId !== 'number' || !Number.isFinite(p.userId)) continue;
    userIdBySeat.set(Math.floor(p.seat), Math.floor(p.userId));
  }

  const allMyBadges = await getUserBadges(auth.user.id);
  const myBadges = [
    ...allMyBadges.filter((b) => b.isEquipped).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
    ...allMyBadges.filter((b) => !b.isEquipped),
  ].slice(0, 5);

  const profileRow = await getUserProfileByUserId(auth.user.id);
  const avatarDataUrl = profileRow?.avatar_webp_base64 ? `data:image/webp;base64,${profileRow.avatar_webp_base64}` : null;
  const signature = profileRow?.signature ?? '';

  const summaryRows = await getPvpUserSummariesByUserIds([auth.user.id]);
  const mySummary = summaryRows.find((r) => r.user_id === auth.user.id) ?? null;
  const completedMatches = mySummary?.completed_matches ?? 0;
  const wins = mySummary?.wins ?? 0;
  const losses = mySummary?.losses ?? 0;
  const draws = mySummary?.draws ?? 0;
  const total = wins + losses + draws;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  const submissionsRows = await getPvpRoomSubmissions(roomId);
  const mySubmissionRow = submissionsRows.find((r) => r.user_id === auth.user.id) ?? null;
  const mySubmission = mySubmissionRow ? parseSubmission(mySubmissionRow.submission_json) : null;

  const myDeck =
    mySubmission && Array.isArray(mySubmission.cards)
      ? mySubmission.cards.map((c) => ({
          name: typeof c?.name === 'string' && c.name.trim() ? c.name.trim() : '未命名',
          type: typeof c?.type === 'string' && c.type.trim() ? c.type.trim() : null,
          ref: c?.ref ?? null,
          source: c?.source ?? null,
        }))
      : [];

  const internalRaw = internal.raw as any;
  const initialHandSnapshotIds = readInitialHandSnapshotIds({ internalRaw, currentMatchId, mySeat });
  const myInitialHand: SnapshotLite[] = [];
  for (const id of initialHandSnapshotIds.slice(0, 50)) {
    const snap = await getPvpCardSnapshotById(id);
    if (!snap) continue;
    let ref: any = null;
    try {
      ref = snap.ref_json ? JSON.parse(snap.ref_json) : null;
    } catch {
      ref = null;
    }
    myInitialHand.push({
      snapshotId: snap.id,
      name: snap.name,
      type: snap.card_type,
      ref,
    });
  }

  const rounds = await getPvpRoundsByMatch(currentMatchId);
  const roundSummaries = rounds.map((r) => {
    const roundId = r.id;
    const roundIndex = typeof r.round_index === 'number' ? r.round_index : 0;
    const status = typeof r.status === 'string' ? r.status : 'unknown';
    const result = status === 'completed' ? parsePvpRoundResultJson(r.result_json) : null;
    return buildPvpSettlementRoundSummary({
      roundId,
      roundIndex,
      status,
      result,
      usernameByUserId,
      isBotByUserId,
      userIdBySeat,
      myUserId: auth.user.id,
    });
  });

  // 计分板：与 /api/pvp/rooms/[roomId] 保持一致（bestOf 才显示）
  let matchScore: { winsByUserId: Array<{ userId: number; wins: number }>; maxRounds: number } | null = null;
  if (rules.bestOf.enabled) {
    const seatToUserId = new Map<number, number>();
    for (const p of participants) {
      if (typeof p.seat === 'number' && typeof p.userId === 'number') seatToUserId.set(p.seat, p.userId);
    }

    const allPlayerIds = [...new Set([...seatToUserId.values()])];
    const winsMap = new Map<number, number>();
    for (const id of allPlayerIds) winsMap.set(id, 0);

    for (const r of rounds) {
      if (typeof r.winner_user_id === 'number') {
        winsMap.set(r.winner_user_id, (winsMap.get(r.winner_user_id) || 0) + 1);
        continue;
      }
      const result = parsePvpRoundResultJson(r.result_json);
      const winnerSeat = typeof result?.winnerSeat === 'number' ? result.winnerSeat : null;
      if (winnerSeat === null) continue;
      const userId = seatToUserId.get(winnerSeat);
      if (typeof userId === 'number') {
        winsMap.set(userId, (winsMap.get(userId) || 0) + 1);
      }
    }

    matchScore = {
      winsByUserId: allPlayerIds.map((userId) => ({ userId, wins: winsMap.get(userId) || 0 })),
      maxRounds: rules.bestOf.maxRounds,
    };
  }

  const mePlayer = participants.find((p) => p.userId === auth.user.id) ?? null;

  return json({
    success: true,
    generatedAt: new Date().toISOString(),
    room: {
      id: room.id,
      hostUserId: room.host_user_id,
      status: room.status,
      phase: room.phase,
      currentMatchId,
      rules,
      scenario:
        internalRaw?._scenario && typeof internalRaw._scenario === 'object'
          ? {
              kind: 'data_card',
              id: typeof internalRaw._scenario.id === 'string' ? internalRaw._scenario.id : null,
              name: typeof internalRaw._scenario.name === 'string' ? internalRaw._scenario.name : null,
            }
          : null,
    },
    me: {
      userId: auth.user.id,
      username: mePlayer?.username ?? `用户${auth.user.id}`,
      prefix: mePlayer?.prefix ?? null,
      seat: mySeat,
      avatarDataUrl,
      signature,
      badges: myBadges,
      pvp: {
        completedMatches,
        wins,
        losses,
        draws,
        winRate,
        lastPlayedAt: mySummary?.last_played_at ?? null,
      },
    },
    participants: participants.map((p) => ({
      userId: p.userId,
      seat: p.seat,
      username: formatPvpDisplayName({ userId: p.userId, username: p.username, isBot: p.isBot }),
      rawUsername: p.username,
      prefix: p.prefix,
      isBot: p.isBot,
      badges: p.isBot ? [] : (badgesByUserId.get(p.userId) ?? []),
    })),
    match: {
      id: currentMatchId,
      maxRounds: rules.bestOf.enabled ? rules.bestOf.maxRounds : 1,
      roundCount: rounds.length,
      score: matchScore,
    },
    myDeck,
    myInitialHand,
    rounds: roundSummaries,
  });
}

export const appRouteHandler = withPvpErrorBoundary(handler);
export default appRouteHandler;
