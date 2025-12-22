import {
  getPvpCardSnapshotById,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  getPvpRoundChoices,
  getLatestPvpRoundByMatch,
  getPvpRoundsByMatch,
  updatePvpRoomCas,
  getUserEquippedBadges,
} from '@/lib/d1';
import { botUserIdForClient, parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { getPvpScenarioTitle, parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpHandState, PvpSubmissionPayload } from '@/lib/pvp/types';
import type { UserBadge } from '@/types/badge';

export const runtime = 'edge';

const parseSubmission = (raw: string): PvpSubmissionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSubmissionPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards) || !Array.isArray(parsed.discarded)) return null;
    return parsed;
  } catch {
    return null;
  }
};

async function getRoomHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  if (room.expires_at) {
    const expired = Date.now() > Date.parse(room.expires_at);
    if (expired && room.status === 'open') {
      await updatePvpRoomCas(roomId, room.version, { status: 'closed', phase: 'closed' });
      return json({ error: '房间已过期' }, { status: 410 });
    }
  }

  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
  const rules = parsed.internal.rules;
  const bots = parsed.internal.bots;
  const postRoundRaw = (parsed.internal.raw as any)?._postRound;
  const scenarioSelection = parsePvpScenarioSelection((parsed.internal.raw as any)?._scenario);
  const scenario = scenarioSelection
    ? {
        fileName: scenarioSelection.fileName,
        isNative: scenarioSelection.isNative ?? false,
        title: getPvpScenarioTitle(scenarioSelection),
        sourceDataCardId: scenarioSelection.sourceDataCardId ?? null,
        sourceDataCardUpdatedAt: scenarioSelection.sourceDataCardUpdatedAt ?? null,
        sourceDataCardName: scenarioSelection.sourceDataCardName ?? null,
        sourceIsPublic: typeof scenarioSelection.sourceIsPublic === 'boolean' ? scenarioSelection.sourceIsPublic : null,
        sourceAuthor: scenarioSelection.sourceAuthor ?? null,
      }
    : null;

  const players = await getPvpRoomPlayers(roomId);
  const isPlayer = players.some((p) => p.user_id === auth.user.id);
  if (!isPlayer) return json({ error: '无权访问该房间' }, { status: 403 });

  const badgesByUserId = new Map<number, UserBadge[]>();
  await Promise.all(
    players.map(async (p) => {
      const userId = typeof p?.user_id === 'number' ? p.user_id : null;
      if (!userId) return;
      const badges = await getUserEquippedBadges(userId);
      badgesByUserId.set(userId, Array.isArray(badges) ? badges : []);
    })
  );

  const submissionsRows = await getPvpRoomSubmissions(roomId);
  const submissions = submissionsRows
    .map((row) => {
      const parsed = parseSubmission(row.submission_json);
      return parsed ? { userId: row.user_id, ...parsed } : null;
    })
    .filter(Boolean);

  const botSubmissions = bots.map((b) => ({
    userId: botUserIdForClient(b.seat),
    ...b.submission,
  }));

  const hands = await getPvpRoomHands(roomId);
  const myHandRow = hands.find((h) => h.user_id === auth.user.id);
  const myHand = myHandRow ? parseHand(myHandRow.hand_json) : null;

  const myHandCardsDetailed = [];
  if (myHand && Array.isArray(myHand.cards)) {
    for (const card of myHand.cards) {
      const snap = await getPvpCardSnapshotById(card.id);
      if (!snap) continue;
      let ref: any = null;
      try {
        ref = snap.ref_json ? JSON.parse(snap.ref_json) : null;
      } catch {
        ref = null;
      }
      myHandCardsDetailed.push({
        snapshotId: snap.id,
        ref,
        name: snap.name,
        type: snap.card_type,
        dataJson: snap.data_json,
      });
    }
  }

  const currentMatchId = room.current_match_id;
  const latestRound = currentMatchId ? await getLatestPvpRoundByMatch(currentMatchId) : null;
  let choicesState: any = null;
  let latestRoundResult: any = null;
  let confirmations: any = null;

  if (latestRound) {
    const choices = await getPvpRoundChoices(latestRound.id);
    const chosenUserIds = new Set(choices.map((c) => c.user_id));
    const hasChosenMe = chosenUserIds.has(auth.user.id);
    const botChosen = bots.filter((b) => Boolean(b.choicesByRoundId?.[latestRound.id])).length;
    const chosenCount = chosenUserIds.size + botChosen;
    const totalPlayers = players.length + bots.length;
    const hasChosenOther = totalPlayers === 2
      ? (bots.length === 1 ? (hasChosenMe ? botChosen > 0 : botChosen > 0) : choices.some((c) => c.user_id !== auth.user.id))
      : null;
    choicesState = {
      roundId: latestRound.id,
      roundIndex: latestRound.round_index,
      status: latestRound.status,
      hasChosenMe,
      ...(hasChosenOther === null ? {} : { hasChosenOther }),
      chosenCount,
      totalPlayers,
    };

    if (latestRound.status === 'completed' && latestRound.result_json) {
      try {
        latestRoundResult = JSON.parse(latestRound.result_json);
      } catch {
        latestRoundResult = null;
      }
    }
  }

  // 回合结算后的“阅读确认”机制：仅暴露计数与自身是否已确认
  if (postRoundRaw && latestRound) {
    const roundId = typeof (postRoundRaw as any).roundId === 'string' ? String((postRoundRaw as any).roundId) : '';
    const confirmedUserIds = Array.isArray((postRoundRaw as any).confirmedUserIds)
      ? (postRoundRaw as any).confirmedUserIds.filter((x: any) => typeof x === 'number' && Number.isFinite(x)).map((x: number) => Math.floor(x))
      : [];
    if (roundId && roundId === latestRound.id) {
      const confirmedSet = new Set<number>(confirmedUserIds);
      const hasConfirmedMe = confirmedSet.has(auth.user.id);
      const confirmedHumans = players.filter((p) => confirmedSet.has(p.user_id)).length;
      confirmations = {
        roundId,
        confirmedHumans,
        totalHumans: players.length,
        hasConfirmedMe,
      };
    }
  }

  let score: any = null;
  if (rules.bestOf.enabled && currentMatchId) {
    const rounds = await getPvpRoundsByMatch(currentMatchId);
    const seatToUserId = new Map<number, number>();
    for (const p of players) {
      if (typeof p.seat === 'number') seatToUserId.set(p.seat, p.user_id);
    }
    for (const b of bots) seatToUserId.set(b.seat, botUserIdForClient(b.seat));

    const allPlayerIds = [...new Set([...seatToUserId.values()])];
    const winsMap = new Map<number, number>();
    for (const id of allPlayerIds) winsMap.set(id, 0);

    for (const r of rounds) {
      if (typeof r.winner_user_id === 'number') {
        winsMap.set(r.winner_user_id, (winsMap.get(r.winner_user_id) || 0) + 1);
        continue;
      }
      if (!r.result_json) continue;
      try {
        const result = JSON.parse(r.result_json) as any;
        const winnerSeat = typeof result?.winnerSeat === 'number' ? result.winnerSeat : null;
        if (winnerSeat === null) continue;
        const userId = seatToUserId.get(winnerSeat);
        if (typeof userId === 'number') {
          winsMap.set(userId, (winsMap.get(userId) || 0) + 1);
        }
      } catch {
        // ignore
      }
    }

    const winsByUserId = allPlayerIds.map((userId) => ({ userId, wins: winsMap.get(userId) || 0 }));
    const myWins = winsMap.get(auth.user.id) ?? 0;
    score = { winsByUserId, myWins, maxRounds: rules.bestOf.maxRounds };
  }

  return json({
    success: true,
    room: {
      id: room.id,
      hostUserId: room.host_user_id,
      status: room.status,
      phase: room.phase,
      version: room.version,
      expiresAt: room.expires_at,
      lastActivityAt: room.last_activity_at,
      currentMatchId,
      rules,
      scenario,
    },
    players: [
      ...players.map((p) => ({
        userId: p.user_id,
        username: p.username,
        prefix: p.prefix,
        seat: p.seat,
        isBot: false,
        badges: badgesByUserId.get(p.user_id) || [],
        botId: null,
      })),
      ...bots.map((b) => ({
        userId: botUserIdForClient(b.seat),
        username: b.name,
        prefix: null,
        seat: b.seat,
        isBot: true,
        badges: [],
        botId: b.id,
      })),
    ].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99)),
    submissions: [...submissions, ...botSubmissions].sort((a: any, b: any) => (a.userId ?? 0) - (b.userId ?? 0)),
    myHand: myHand ? { cards: myHandCardsDetailed, discarded: myHand.discarded, drawPile: myHand.drawPile } : null,
    latestRound: latestRound ? { id: latestRound.id, index: latestRound.round_index, status: latestRound.status } : null,
    choices: choicesState,
    latestRoundResult,
    confirmations,
    score,
  });
}

export default withPvpErrorBoundary(getRoomHandler);
