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
import { getRoomIdFromRequestUrl, getRoundIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import {
  parsePvpWinnerVoteState,
  tallyPvpWinnerVotes,
  upsertPvpWinnerVoteBallot,
  type PvpWinnerVoteChoice,
} from '@/lib/pvp/winner-vote';

type SubmitVoteBody = {
  expectedVersion?: number;
  choice?: unknown;
};

const parseChoice = (raw: unknown): PvpWinnerVoteChoice | null => {
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

async function submitVoteHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<SubmitVoteBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.status !== 'open' || room.phase === 'closed') return json({ error: '房间已关闭' }, { status: 410 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'voting') return json({ error: '当前阶段不允许投票', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  if (!room.current_match_id) return json({ error: '对战上下文缺失，请房主重开房间后再试', code: 'MATCH_CONTEXT_MISSING' }, { status: 409 });

  const round = await getPvpRoundById(roundId);
  if (!round || round.room_id !== roomId) return json({ error: '回合不存在' }, { status: 404 });
  if (round.status !== 'completed' || !round.result_json) return json({ error: '回合尚未完成，无法投票', code: 'ROUND_NOT_READY' }, { status: 409 });

  const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
  if (!latestRound || latestRound.id !== roundId) return json({ error: '仅允许对当前回合投票', code: 'ROUND_NOT_LATEST' }, { status: 409 });

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
  if (!currentMemberUserIds.has(auth.user.id) || !eligibleUserIds.includes(auth.user.id)) {
    return json({ error: '你不在投票名单中', code: 'NOT_ELIGIBLE' }, { status: 403 });
  }

  const choice = parseChoice(body.data.choice);
  if (!choice) return json({ error: '投票选项无效', code: 'CHOICE_INVALID' }, { status: 400 });

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

  if (choice.kind === 'seat' && !validSeats.includes(choice.seat)) {
    return json({ error: '投票目标不在本轮参战者列表中', code: 'SEAT_INVALID' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const nextVoteState = upsertPvpWinnerVoteBallot(
    { ...voteState, eligibleUserIds },
    auth.user.id,
    choice,
    nowIso,
  );
  (internal.raw as any)._winnerVote = nextVoteState;

  const tally = tallyPvpWinnerVotes({
    eligibleUserIds,
    votesByUserId: nextVoteState.votesByUserId ?? {},
    validSeats,
  });

  const allVoted = tally.voteCount >= tally.eligibleCount && tally.eligibleCount > 0;
  if (!allVoted) {
    const ok = await updatePvpRoomCas(roomId, expectedVersion, {
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: nowIso,
    });
    if (!ok) return json({ error: '投票失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
    return json({ success: true, voteSubmitted: true, tally, nextVersion: expectedVersion + 1 });
  }

  const { nextResultJson, winnerUserId, winnerName } = finalizeRoundWithVote(round.result_json, {
    tally,
    resolvedAt: nowIso,
    reason: nextVoteState.reason,
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

  return json({ success: true, voteSubmitted: true, voteClosed: true, tally, winnerUserId, winnerName, nextVersion: expectedVersion + 1 });
}

export default withPagesApiResponse(withPvpErrorBoundary(submitVoteHandler));

