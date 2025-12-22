import {
  createPvpRound,
  getPvpCardSnapshotById,
  getPvpRoomById,
  getPvpRoomPlayers,
  getPvpRoundById,
  getPvpRoundsByMatch,
  updatePvpMatch,
  updatePvpRoomCas,
} from '@/lib/d1';
import { pickBotChoiceSnapshotId } from '@/lib/pvp/bot/choose';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { getRoomIdFromRequestUrl, getRoundIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type ConfirmBody = { expectedVersion?: number };

type PostRoundState = {
  roundId: string;
  matchId: string;
  roundIndex: number;
  maxRounds: number;
  bestOfEnabled: boolean;
  resolvedWinnerUserId: number | null;
  confirmedUserIds: number[];
  confirmedBotIds: string[];
};

const parsePostRoundState = (raw: unknown): PostRoundState | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as any;
  const roundId = typeof obj.roundId === 'string' ? obj.roundId : '';
  const matchId = typeof obj.matchId === 'string' ? obj.matchId : '';
  const roundIndex = Number.isFinite(obj.roundIndex) ? Math.floor(obj.roundIndex) : 0;
  const maxRounds = Number.isFinite(obj.maxRounds) ? Math.floor(obj.maxRounds) : 0;
  const bestOfEnabled = obj.bestOfEnabled === true;
  const resolvedWinnerUserId = typeof obj.resolvedWinnerUserId === 'number' ? obj.resolvedWinnerUserId : null;
  const confirmedUserIds = Array.isArray(obj.confirmedUserIds)
    ? obj.confirmedUserIds.filter((x: any) => typeof x === 'number' && Number.isFinite(x)).map((x: number) => Math.floor(x))
    : [];
  const confirmedBotIds = Array.isArray(obj.confirmedBotIds)
    ? obj.confirmedBotIds.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
    : [];

  if (!roundId || !matchId) return null;
  if (roundIndex <= 0) return null;
  if (maxRounds <= 0) return null;

  return {
    roundId,
    matchId,
    roundIndex,
    maxRounds,
    bestOfEnabled,
    resolvedWinnerUserId,
    confirmedUserIds,
    confirmedBotIds,
  };
};

async function confirmHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<ConfirmBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'reviewing' && room.phase !== 'advancing') {
    return json({ error: '当前阶段不允许确认', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;
  const rules = internal.rules;
  const bots = internal.bots;
  const recordMatch = bots.length <= 0;

  const players = await getPvpRoomPlayers(roomId);
  if (!players.some((p) => p.user_id === auth.user.id)) return json({ error: '你不在该房间中' }, { status: 403 });

  const round = await getPvpRoundById(roundId);
  if (!round || round.room_id !== roomId) return json({ error: '回合不存在' }, { status: 404 });
  if (round.status !== 'completed') return json({ error: '回合尚未结算', code: 'ROUND_NOT_COMPLETED' }, { status: 409 });

  const postRound = parsePostRoundState((internal.raw as any)._postRound);
  if (!postRound) return json({ error: '当前没有待确认的回合', code: 'NO_PENDING_CONFIRMATION' }, { status: 409 });
  if (postRound.roundId !== roundId) return json({ error: '确认目标不是当前待确认回合', code: 'ROUND_MISMATCH' }, { status: 409 });

  const totalPlayers = players.length + bots.length;
  const playerUserIds = players.map((p) => p.user_id);

  const confirmedUserIdSet = new Set<number>(postRound.confirmedUserIds);
  confirmedUserIdSet.add(auth.user.id);

  const confirmedHumanCount = playerUserIds.filter((id) => confirmedUserIdSet.has(id)).length;
  const allHumansConfirmed = confirmedHumanCount >= players.length && players.length > 0;

  const confirmedBotIdsSet = new Set<string>(postRound.confirmedBotIds);
  for (const b of bots) confirmedBotIdsSet.add(b.id);

  const allConfirmed = allHumansConfirmed;

  if (room.phase === 'advancing') {
    return json({
      success: true,
      advancing: true,
      confirmedCount: confirmedHumanCount + bots.length,
      totalPlayers,
      hasConfirmedMe: true,
    });
  }

  (internal.raw as any)._postRound = {
    ...postRound,
    confirmedUserIds: [...confirmedUserIdSet],
    confirmedBotIds: [...confirmedBotIdsSet],
  };

  const phaseAfterConfirm = allConfirmed ? 'advancing' : 'reviewing';
  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: phaseAfterConfirm,
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: new Date().toISOString(),
  });
  if (!ok) return json({ error: '确认失败（版本冲突）', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (!allConfirmed) {
    return json({
      success: true,
      advanced: false,
      confirmedCount: confirmedHumanCount + bots.length,
      totalPlayers,
      hasConfirmedMe: true,
    });
  }

  // 只有抢到 advancing 的请求会继续推进（避免重复创建下一回合）
  const advancingVersion = expectedVersion + 1;

  const isLastRound = postRound.bestOfEnabled ? postRound.roundIndex >= postRound.maxRounds : true;

  if (!isLastRound) {
    const nextRoundId = await createPvpRound({
      roomId,
      matchId: postRound.matchId,
      roundIndex: postRound.roundIndex + 1,
      status: 'pending',
    });

    if (!nextRoundId) {
      // best-effort：推进失败则退回 reviewing，便于重试
      await updatePvpRoomCas(roomId, advancingVersion, {
        phase: 'reviewing',
        rules_json: stringifyPvpRoomInternalState(internal),
        last_activity_at: new Date().toISOString(),
      });
      return json({ error: '创建下一回合失败，请稍后重试', code: 'NEXT_ROUND_CREATE_FAILED' }, { status: 500 });
    }

    // Bot 为下一轮预先出牌（失败则忽略，不阻塞推进）
    try {
      for (const b of internal.bots) {
        if (!b.hand?.cards?.length) continue;
        const snapshotIds = b.hand.cards.map((c: any) => (c && c.kind === 'snapshot' ? c.id : null)).filter(Boolean) as string[];
        const snapshots = [];
        for (const id of snapshotIds) {
          const snap = await getPvpCardSnapshotById(id);
          if (snap) snapshots.push(snap);
        }
        const pickedId =
          (await pickBotChoiceSnapshotId({
            bot: { strategyId: b.strategyId },
            snapshots: snapshots.map((s) => ({ id: s.id, name: s.name, data_json: s.data_json, ref_json: s.ref_json })),
          })) ?? (snapshotIds[0] ?? null);
        if (pickedId) {
          b.choicesByRoundId = { ...(b.choicesByRoundId ?? {}), [nextRoundId]: pickedId };
        }
      }
    } catch {
      // ignore
    }

    delete (internal.raw as any)._postRound;
    const casOk = await updatePvpRoomCas(roomId, advancingVersion, {
      phase: 'choosing',
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: new Date().toISOString(),
    });
    if (!casOk) {
      return json({ success: true, advanced: true, nextRoundId, warning: '推进完成但房间状态更新失败，请刷新' });
    }

    return json({ success: true, advanced: true, nextRoundId });
  }

  // 最后一回合：结束整场对战
  let matchWinnerUserId: number | null = null;
  if (postRound.bestOfEnabled && recordMatch) {
    const rounds = await getPvpRoundsByMatch(postRound.matchId);
    const winCounts = new Map<number, number>();
    for (const p of players) winCounts.set(p.user_id, 0);
    for (const r of rounds) {
      if (!r.winner_user_id) continue;
      if (!winCounts.has(r.winner_user_id)) continue;
      winCounts.set(r.winner_user_id, (winCounts.get(r.winner_user_id) || 0) + 1);
    }
    let maxWins = 0;
    for (const wins of winCounts.values()) maxWins = Math.max(maxWins, wins);
    const top = [...winCounts.entries()].filter(([, wins]) => wins === maxWins).map(([userId]) => userId);
    matchWinnerUserId = top.length === 1 ? top[0]! : null;
  }

  const endedAt = new Date().toISOString();
  const matchResultJson = JSON.stringify({
    matchWinnerUserId: postRound.bestOfEnabled ? matchWinnerUserId : postRound.resolvedWinnerUserId,
    finalRoundIndex: postRound.roundIndex,
    bestOf: rules.bestOf,
  });
  if (recordMatch) {
    await updatePvpMatch(postRound.matchId, {
      status: 'completed',
      endedAt,
      winnerUserId: postRound.bestOfEnabled ? matchWinnerUserId : postRound.resolvedWinnerUserId,
      resultJson: matchResultJson,
    });
  }

  delete (internal.raw as any)._postRound;
  const finishOk = await updatePvpRoomCas(roomId, advancingVersion, {
    phase: 'finished',
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: endedAt,
  });
  if (!finishOk) {
    return json({ success: true, advanced: true, finished: true, matchWinnerUserId, warning: '对局结束但房间状态更新失败，请刷新' });
  }

  return json({ success: true, advanced: true, finished: true, matchWinnerUserId });
}

export default withPvpErrorBoundary(confirmHandler);

