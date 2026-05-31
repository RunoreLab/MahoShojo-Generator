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
import { createPvpWinnerVoteState, parsePvpWinnerVoteState } from '@/lib/pvp/winner-vote';

type StartVoteBody = { expectedVersion?: number };

const markRoundResultPendingVote = (rawResultJson: string, meta: { createdAt: string; createdByUserId: number }) => {
  let result: any;
  try {
    result = JSON.parse(rawResultJson);
  } catch {
    result = {};
  }

  const autoWinner = {
    winnerUserId: typeof result?.winnerUserId === 'number' ? result.winnerUserId : null,
    winnerName: typeof result?.winnerName === 'string' ? result.winnerName : null,
    winnerSeat: typeof result?.winnerSeat === 'number' ? result.winnerSeat : null,
    winnerToken: typeof result?.winnerToken === 'string' ? result.winnerToken : null,
    winnerIsBot: typeof result?.winnerIsBot === 'boolean' ? result.winnerIsBot : null,
  };

  result.autoWinner = result.autoWinner ?? autoWinner;
  result.winnerUserId = null;
  result.winnerName = null;
  result.winnerSeat = null;
  result.winnerToken = null;
  result.winnerIsBot = null;
  result.winnerStatus = 'pending_vote';
  result.winnerVote = {
    status: 'open',
    reason: 'host_override',
    createdAt: meta.createdAt,
    createdByUserId: meta.createdByUserId,
  };

  if (result?.report?.officialReport && typeof result.report.officialReport === 'object') {
    result.report.officialReport.winner = '待定（投票中）';
  }

  return JSON.stringify(result);
};

async function startVoteHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<StartVoteBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.status !== 'open' || room.phase === 'closed') return json({ error: '房间已关闭' }, { status: 410 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可发起胜者投票', code: 'HOST_ONLY' }, { status: 403 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'reviewing' && room.phase !== 'voting') {
    return json({ error: '当前阶段不允许发起胜者投票', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }
  if (!room.current_match_id) return json({ error: '对战上下文缺失，请房主重开房间后再试', code: 'MATCH_CONTEXT_MISSING' }, { status: 409 });

  const round = await getPvpRoundById(roundId);
  if (!round || round.room_id !== roomId) return json({ error: '回合不存在' }, { status: 404 });
  if (round.status !== 'completed' || !round.result_json) return json({ error: '回合尚未完成，无法投票', code: 'ROUND_NOT_READY' }, { status: 409 });

  const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
  if (!latestRound || latestRound.id !== roundId) return json({ error: '仅允许对当前回合发起投票', code: 'ROUND_NOT_LATEST' }, { status: 409 });

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;

  const existing = parsePvpWinnerVoteState((internal.raw as any)?._winnerVote);
  if (existing && existing.roundId === roundId) {
    return json({ success: true, alreadyStarted: true, nextVersion: expectedVersion });
  }

  const members = await getPvpRoomMembers(roomId);
  const eligibleUserIds = members
    .map((m) => (typeof m?.user_id === 'number' && Number.isFinite(m.user_id) ? Math.floor(m.user_id) : null))
    .filter((id): id is number => typeof id === 'number' && id > 0);

  const nowIso = new Date().toISOString();
  const voteState = createPvpWinnerVoteState({
    roundId,
    matchId: room.current_match_id,
    createdAt: nowIso,
    createdByUserId: auth.user.id,
    reason: 'host_override',
    eligibleUserIds,
  });

  (internal.raw as any)._winnerVote = voteState;
  delete (internal.raw as any)._postRound;

  const nextResultJson = markRoundResultPendingVote(round.result_json, { createdAt: nowIso, createdByUserId: auth.user.id });
  await updatePvpRound(roundId, { resultJson: nextResultJson, winnerUserId: null, winnerName: null });

  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: 'voting',
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: nowIso,
  });
  if (!ok) return json({ error: '发起投票失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  return json({ success: true, voteStarted: true, nextVersion: expectedVersion + 1 });
}

export default withPvpErrorBoundary(startVoteHandler);

