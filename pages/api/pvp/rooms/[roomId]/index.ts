import {
  getLatestPvpRoundByRoom,
  getPvpCardSnapshotById,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  getPvpRoundChoices,
  getPvpRoundsByRoom,
  updatePvpRoomCas,
} from '@/lib/d1';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, requireAuthUser } from '@/lib/pvp/server';
import type { PvpHandState, PvpRoomRules, PvpSubmissionPayload } from '@/lib/pvp/types';

export const runtime = 'edge';

const parseRules = (rulesJson: string): PvpRoomRules | null => {
  try {
    return JSON.parse(rulesJson) as PvpRoomRules;
  } catch {
    return null;
  }
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

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards) || !Array.isArray(parsed.discarded)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export default async function handler(req: Request): Promise<Response> {
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

  const rules = parseRules(room.rules_json);
  if (!rules) return json({ error: '房间规则损坏' }, { status: 500 });

  const players = await getPvpRoomPlayers(roomId);
  const isPlayer = players.some((p) => p.user_id === auth.user.id);
  if (!isPlayer) return json({ error: '无权访问该房间' }, { status: 403 });

  const submissionsRows = await getPvpRoomSubmissions(roomId);
  const submissions = submissionsRows
    .map((row) => {
      const parsed = parseSubmission(row.submission_json);
      return parsed ? { userId: row.user_id, ...parsed } : null;
    })
    .filter(Boolean);

  const hands = await getPvpRoomHands(roomId);
  const myHandRow = hands.find((h) => h.user_id === auth.user.id);
  const myHand = myHandRow ? parseHand(myHandRow.hand_json) : null;

  const myHandCardsDetailed = [];
  if (myHand && Array.isArray(myHand.cards)) {
    for (const card of myHand.cards) {
      const snap = await getPvpCardSnapshotById(card.id);
      if (!snap) continue;
      myHandCardsDetailed.push({
        snapshotId: snap.id,
        name: snap.name,
        type: snap.card_type,
        dataJson: snap.data_json,
      });
    }
  }

  const latestRound = await getLatestPvpRoundByRoom(roomId);
  let choicesState: any = null;
  let latestRoundResult: any = null;

  if (latestRound) {
    const choices = await getPvpRoundChoices(latestRound.id);
    const chosenUserIds = new Set(choices.map((c) => c.user_id));
    const hasChosenMe = chosenUserIds.has(auth.user.id);
    const chosenCount = chosenUserIds.size;
    const totalPlayers = players.length;
    const hasChosenOther = totalPlayers === 2 ? choices.some((c) => c.user_id !== auth.user.id) : null;
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

  let score: any = null;
  if (rules.bestOf.enabled) {
    const rounds = await getPvpRoundsByRoom(roomId);
    const winsByUserId = players.map((p) => ({
      userId: p.user_id,
      wins: rounds.filter((r) => r.winner_user_id === p.user_id).length,
    }));
    const myWins = winsByUserId.find((x) => x.userId === auth.user.id)?.wins ?? 0;
    const otherId = players.length === 2 ? (players.find((p) => p.user_id !== auth.user.id)?.user_id ?? null) : null;
    const otherWins = otherId ? (winsByUserId.find((x) => x.userId === otherId)?.wins ?? 0) : null;
    score = { winsByUserId, myWins, ...(otherWins === null ? {} : { otherWins }), maxRounds: rules.bestOf.maxRounds };
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
      rules,
    },
    players: players.map((p) => ({ userId: p.user_id, username: p.username, prefix: p.prefix, seat: p.seat })),
    submissions,
    myHand: myHand ? { cards: myHandCardsDetailed, discarded: myHand.discarded, drawPile: myHand.drawPile } : null,
    latestRound: latestRound ? { id: latestRound.id, index: latestRound.round_index, status: latestRound.status } : null,
    choices: choicesState,
    latestRoundResult,
    score,
  });
}
