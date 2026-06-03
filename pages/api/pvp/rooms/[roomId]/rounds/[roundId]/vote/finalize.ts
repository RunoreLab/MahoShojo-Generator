import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import {
  getLatestPvpRoundByMatch,
  getPvpRoomById,
  getPvpRoomMembers,
  getPvpRoundById,
  updatePvpRoomCas,
  updatePvpRound,
} from '@/lib/database/pvp';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { canForcePendingAction, computeLastPendingVoteAction } from '@/lib/pvp/pending-action';
import { getRoomIdFromRequestUrl, getRoundIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import { parsePvpWinnerVoteState, tallyPvpWinnerVotes } from '@/lib/pvp/winner-vote';

type FinalizeVoteBody = { expectedVersion?: number };

const finalizeRoundWithVote = (rawResultJson: string, input: {
  tally: ReturnType<typeof tallyPvpWinnerVotes>;
  resolvedAt: string;
  reason: string;
}) => {
  let result: any;
  try {
    result = JSON.parse(rawResultJson);
  } catch {
    result = {};
  }

  const combatants: any[] = Array.isArray(result?.combatants) ? result.combatants : [];
  const bySeat = new Map<number, any>();
  for (const c of combatants) {
    const seat = typeof c?.seat === 'number' && Number.isFinite(c.seat) ? Math.floor(c.seat) : null;
    if (seat === null) continue;
    bySeat.set(seat, c);
  }

  const winnerSeat = input.tally.winnerSeat;
  const winnerCombatant = winnerSeat === null ? null : bySeat.get(winnerSeat) ?? null;
  const winnerName =
    winnerSeat === null
      ? '平局'
      : (typeof winnerCombatant?.name === 'string' && winnerCombatant.name.trim())
        ? winnerCombatant.name.trim()
        : '未知参战者';

  const winnerUserId = winnerSeat === null
    ? null
    : (typeof winnerCombatant?.userId === 'number' && Number.isFinite(winnerCombatant.userId) && winnerCombatant.userId > 0)
      ? Math.floor(winnerCombatant.userId)
      : null;

  result.winnerUserId = winnerUserId;
  result.winnerName = winnerName;
  result.winnerSeat = winnerSeat;
  result.winnerToken = winnerSeat === null ? null : (typeof winnerCombatant?.token === 'string' ? winnerCombatant.token : null);
  result.winnerIsBot = winnerSeat === null ? null : Boolean(winnerCombatant?.isBot);
  result.winnerStatus = 'final';
  result.winnerVote = {
    status: 'closed',
    resolvedAt: input.resolvedAt,
    reason: input.reason,
    eligibleCount: input.tally.eligibleCount,
    voteCount: input.tally.voteCount,
    drawCount: input.tally.drawCount,
    countsBySeat: input.tally.countsBySeat,
    winnerSeat,
    tied: input.tally.tied,
  };

  if (result?.report?.officialReport && typeof result.report.officialReport === 'object') {
    result.report.officialReport.winner = winnerName;
  }

  return {
    nextResultJson: JSON.stringify(result),
    winnerUserId,
    winnerName,
  };
};

async function finalizeVoteHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<FinalizeVoteBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.status !== 'open' || room.phase === 'closed') return json({ error: '房间已关闭' }, { status: 410 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可结束投票', code: 'HOST_ONLY' }, { status: 403 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'voting') return json({ error: '当前阶段不允许结束投票', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  if (!room.current_match_id) return json({ error: '对战上下文缺失，请房主重开房间后再试', code: 'MATCH_CONTEXT_MISSING' }, { status: 409 });

  const round = await getPvpRoundById(roundId);
  if (!round || round.room_id !== roomId) return json({ error: '回合不存在' }, { status: 404 });
  if (round.status !== 'completed' || !round.result_json) return json({ error: '回合尚未完成，无法投票', code: 'ROUND_NOT_READY' }, { status: 409 });

  const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
  if (!latestRound || latestRound.id !== roundId) return json({ error: '仅允许结束当前回合投票', code: 'ROUND_NOT_LATEST' }, { status: 409 });

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;

  const voteState = parsePvpWinnerVoteState((internal.raw as any)?._winnerVote);
  if (!voteState || voteState.roundId !== roundId) return json({ error: '投票上下文缺失，请刷新', code: 'VOTE_MISSING' }, { status: 409 });

  const members = await getPvpRoomMembers(roomId);
  const currentMemberUserIds = new Set<number>(
    members
      .map((m) => (typeof m?.user_id === 'number' && Number.isFinite(m.user_id) ? Math.floor(m.user_id) : null))
      .filter((id): id is number => typeof id === 'number' && id > 0)
  );
  const eligibleUserIds = voteState.eligibleUserIds.filter((id) => currentMemberUserIds.has(id));

  let resultParsed: any;
  try {
    resultParsed = JSON.parse(round.result_json);
  } catch {
    resultParsed = {};
  }
  const combatants = Array.isArray(resultParsed?.combatants) ? (resultParsed.combatants as any[]) : [];
  const validSeats = combatants
    .map((c) => (typeof c?.seat === 'number' && Number.isFinite(c.seat) ? Math.floor(c.seat) : null))
    .filter((seat): seat is number => typeof seat === 'number' && seat >= 0);

  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const pending = computeLastPendingVoteAction({
    nowMs,
    phaseFallbackAt: room.last_activity_at ?? room.updated_at,
    voteCreatedAt: voteState.createdAt,
    eligibleUserIds,
    votes: Object.entries(voteState.votesByUserId ?? {}).map(([userId, ballot]) => ({
      userId: Number.isFinite(Number(userId)) ? Math.floor(Number(userId)) : -1,
      votedAt: ballot?.votedAt ?? '',
    })),
  });
  if (pending) {
    if (!canForcePendingAction(pending, nowMs)) {
      return json({ error: '倒计时未结束，暂不可强制结束投票', code: 'FORCE_TOO_EARLY', pending }, { status: 409 });
    }
  } else {
    const tallyNow = tallyPvpWinnerVotes({ eligibleUserIds, votesByUserId: voteState.votesByUserId ?? {}, validSeats });
    const allVoted = tallyNow.voteCount >= tallyNow.eligibleCount && tallyNow.eligibleCount > 0;
    if (!allVoted) {
      return json({ error: '当前不满足强制结束投票条件', code: 'FORCE_NOT_AVAILABLE' }, { status: 409 });
    }
  }

  const tally = tallyPvpWinnerVotes({
    eligibleUserIds,
    votesByUserId: voteState.votesByUserId ?? {},
    validSeats,
  });

  const { nextResultJson, winnerUserId, winnerName } = finalizeRoundWithVote(round.result_json, {
    tally,
    resolvedAt: nowIso,
    reason: voteState.reason,
  });
  await updatePvpRound(roundId, { resultJson: nextResultJson, winnerUserId, winnerName });

  delete (internal.raw as any)._winnerVote;
  const maxRounds = internal.rules.bestOf.enabled ? internal.rules.bestOf.maxRounds : 1;
  (internal.raw as any)._postRound = {
    roundId,
    matchId: room.current_match_id,
    roundIndex: round.round_index,
    maxRounds,
    bestOfEnabled: internal.rules.bestOf.enabled,
    resolvedWinnerUserId: winnerUserId,
    confirmedUserIds: [],
    confirmedBotIds: internal.bots.map((b) => b.id),
    confirmedAtByUserId: {},
    createdAt: nowIso,
  };

  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: 'reviewing',
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: nowIso,
  });
  if (!ok) return json({ error: '结束投票失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  return json({ success: true, voteClosed: true, tally, winnerUserId, winnerName, nextVersion: expectedVersion + 1 });
}

export default withPagesApiResponse(withPvpErrorBoundary(finalizeVoteHandler));


