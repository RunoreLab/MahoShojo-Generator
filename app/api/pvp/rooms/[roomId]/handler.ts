import {
  getPvpCardSnapshotById,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomMembers,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  getPvpRoundChoices,
  getLatestPvpRoundByMatch,
  getPvpRoundsByMatch,
  updatePvpRoomCas,
} from '@/lib/database/pvp';
import { getUserEquippedBadges } from '@/lib/database/badges';
import { botUserIdForClient, parsePvpRoomBotRoster, parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { getPvpScenarioTitle, parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import { canViewOtherSubmissions } from '@/lib/pvp/submission-visibility';
import { canForcePendingAction, computeLastPendingChooseAction, computeLastPendingConfirmAction, computeLastPendingSubmissionAction, computeLastPendingVoteAction } from '@/lib/pvp/pending-action';
import { parsePvpWinnerVoteState, tallyPvpWinnerVotes } from '@/lib/pvp/winner-vote';
import { requiresPvpSubmissionPhase } from '@/lib/pvp/logic';
import type { PvpHandState, PvpSubmissionPayload } from '@/lib/pvp/types';
import type { UserBadge } from '@/types/badge';

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

  const serverNowIso = new Date().toISOString();
  const serverNowMs = Date.parse(serverNowIso);

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
  const botRoster = room.phase === 'finished' && bots.length <= 0 ? parsePvpRoomBotRoster(parsed.internal.raw) : [];
  const displayBots = bots.length > 0 ? bots.map((b) => ({ id: b.id, name: b.name, seat: b.seat })) : botRoster;
  const postRoundRaw = (parsed.internal.raw as any)?._postRound;
  const scenarioSelection = parsePvpScenarioSelection((parsed.internal.raw as any)?._scenario);
  const scenarioAdjudicationImportedFor =
    typeof (parsed.internal.raw as any)?._scenarioAdjudicationImportedFor === 'string'
      ? String((parsed.internal.raw as any)._scenarioAdjudicationImportedFor).trim() || null
      : null;
  const scenario = scenarioSelection
    ? (scenarioSelection.kind === 'preset'
      ? {
          kind: 'preset',
          title: getPvpScenarioTitle(scenarioSelection),
          presetFilename: scenarioSelection.filename,
          presetName: scenarioSelection.name,
        }
      : {
          kind: 'data_card',
          title: getPvpScenarioTitle(scenarioSelection),
          sourceDataCardId: scenarioSelection.id,
          sourceDataCardUpdatedAt: scenarioSelection.updatedAt,
          sourceDataCardName: scenarioSelection.name,
          sourceIsPublic: scenarioSelection.isPublic,
          sourceAuthor: scenarioSelection.author,
        })
    : null;

  const members = await getPvpRoomMembers(roomId);
  const myMember = members.find((p) => p.user_id === auth.user.id) ?? null;
  if (!myMember) return json({ error: '无权访问该房间' }, { status: 403 });
  const viewerRole = myMember.role === 'spectator' ? 'spectator' : 'player';

  const players = await getPvpRoomPlayers(roomId);
  const isPlayer = viewerRole === 'player';

  const badgesByUserId = new Map<number, UserBadge[]>();
  await Promise.all(
    members.map(async (p) => {
      const userId = typeof p?.user_id === 'number' ? p.user_id : null;
      if (!userId) return;
      const badges = await getUserEquippedBadges(userId);
      badgesByUserId.set(userId, Array.isArray(badges) ? badges : []);
    })
  );

  const submissionsRows = await getPvpRoomSubmissions(roomId);
  const submissionsByUserId = new Map<number, PvpSubmissionPayload>();
  for (const row of submissionsRows) {
    const parsed = parseSubmission(row.submission_json);
    if (!parsed) continue;
    submissionsByUserId.set(row.user_id, parsed);
  }

  const humanSubmissionsDetailed = players
    .map((p) => {
      const payload = submissionsByUserId.get(p.user_id);
      return payload ? { userId: p.user_id, ...payload } : null;
    })
    .filter(Boolean);

  const botSubmissions = bots.map((b) => ({
    userId: botUserIdForClient(b.seat),
    ...b.submission,
  }));

  const hostOnly = rules.submissionMode === 'hostOnly';
  const needsSubmission = requiresPvpSubmissionPhase(rules);
  const submissionStatus = [
    ...players.map((p) => {
      const sub = submissionsByUserId.get(p.user_id);
      const isRequired = needsSubmission && (!hostOnly || p.user_id === room.host_user_id);
      return {
        userId: p.user_id,
        hasSubmitted: isRequired ? Boolean(sub) : true,
        submittedCount: sub?.cards?.length ?? 0,
        hasPrivateCard: sub?.hasPrivateCard ?? false,
        isRequired,
      };
    }),
    ...bots.map((b) => ({
      userId: botUserIdForClient(b.seat),
      hasSubmitted: true,
      submittedCount: b.submission?.cards?.length ?? 0,
      hasPrivateCard: b.submission?.hasPrivateCard ?? false,
      isRequired: false,
    })),
  ];

  const showAllSubmissions = rules.showAllSubmissions === true;
  const myUserId = auth.user.id;
  const canSeeAllSubmissionDetails = isPlayer && canViewOtherSubmissions(room.phase, showAllSubmissions);
  const submissions = canSeeAllSubmissionDetails
    ? [...humanSubmissionsDetailed, ...botSubmissions]
    : (() => {
        if (!isPlayer) return [];
        const mine = submissionsByUserId.get(myUserId);
        return mine ? [{ userId: myUserId, ...mine }] : [];
      })();

  const hands = isPlayer ? await getPvpRoomHands(roomId) : [];
  const myHandRow = isPlayer ? hands.find((h) => h.user_id === auth.user.id) : undefined;
  const myHand = isPlayer && myHandRow ? parseHand(myHandRow.hand_json) : null;

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
  let pendingAction: any = null;

  if (latestRound) {
    const choices = await getPvpRoundChoices(latestRound.id);
    const playerUserIds = new Set<number>(players.map((p) => p.user_id));
    const chosenUserIds = new Set(choices.filter((c) => playerUserIds.has(c.user_id)).map((c) => c.user_id));
    const hasChosenMe = isPlayer && playerUserIds.has(auth.user.id) ? chosenUserIds.has(auth.user.id) : false;
    const botChosen = bots.filter((b) => Boolean(b.choicesByRoundId?.[latestRound.id])).length;
    const chosenCount = chosenUserIds.size + botChosen;
    const totalPlayers = players.length + bots.length;
    const hasChosenOther =
      !isPlayer
        ? null
        : totalPlayers === 2
          ? (bots.length === 1 ? botChosen > 0 : choices.some((c) => c.user_id !== auth.user.id))
          : null;
    choicesState = {
      roundId: latestRound.id,
      roundIndex: latestRound.round_index,
      status: latestRound.status,
      ...(isPlayer ? { hasChosenMe } : {}),
      ...(hasChosenOther === null ? {} : { hasChosenOther }),
      chosenCount,
      totalPlayers,
    };

    if (isPlayer && room.phase === 'choosing') {
      const pending = computeLastPendingChooseAction({
        nowMs: serverNowMs,
        phaseFallbackAt: latestRound.created_at ?? room.last_activity_at ?? room.updated_at,
        players: players.map((p) => ({ userId: p.user_id })),
        choices: choices.map((c) => ({ userId: c.user_id, updatedAt: c.updated_at })),
      });
      if (pending) {
        const pendingUsername = players.find((p) => p.user_id === pending.pendingUserId)?.username ?? null;
        pendingAction = {
          ...pending,
          pendingUsername,
          canHostForce: auth.user.id === room.host_user_id && canForcePendingAction(pending, serverNowMs),
        };
      }
    }

    if (latestRound.status === 'completed' && latestRound.result_json) {
      try {
        latestRoundResult = JSON.parse(latestRound.result_json);
      } catch {
        latestRoundResult = null;
      }
    }
  }

  // 胜者投票（winner vote）：当判定失败或房主发起复核时，进入 voting 阶段
  let winnerVote: any = null;
  const voteState = parsePvpWinnerVoteState((parsed.internal.raw as any)?._winnerVote);
  if (voteState && latestRound && voteState.roundId === latestRound.id) {
    const currentMemberIds = new Set<number>(members.map((m) => m.user_id));
    const eligibleUserIds = voteState.eligibleUserIds.filter((id) => currentMemberIds.has(id));
    const hasVotedMe = Boolean(voteState.votesByUserId?.[String(auth.user.id)]);
    const myBallot = voteState.votesByUserId?.[String(auth.user.id)] ?? null;
    const myChoice = myBallot?.choice ?? null;

    const combatants = Array.isArray(latestRoundResult?.combatants) ? (latestRoundResult.combatants as any[]) : [];
    const validSeats = combatants
      .map((c) => (typeof c?.seat === 'number' && Number.isFinite(c.seat) ? Math.floor(c.seat) : null))
      .filter((seat): seat is number => typeof seat === 'number' && seat >= 0);

    const tally = tallyPvpWinnerVotes({
      eligibleUserIds,
      votesByUserId: voteState.votesByUserId ?? {},
      validSeats,
    });

    winnerVote = {
      roundId: voteState.roundId,
      matchId: voteState.matchId,
      createdAt: voteState.createdAt,
      createdByUserId: voteState.createdByUserId,
      reason: voteState.reason,
      eligibleCount: tally.eligibleCount,
      voteCount: tally.voteCount,
      hasVotedMe,
      myChoice,
      tally,
    };

    if (room.phase === 'voting') {
      const votes = Object.entries(voteState.votesByUserId ?? {}).map(([userId, ballot]) => ({
        userId: Number.isFinite(Number(userId)) ? Math.floor(Number(userId)) : -1,
        votedAt: ballot?.votedAt ?? '',
      }));
      const pending = computeLastPendingVoteAction({
        nowMs: serverNowMs,
        phaseFallbackAt: room.last_activity_at ?? room.updated_at,
        voteCreatedAt: voteState.createdAt,
        eligibleUserIds,
        votes,
      });
      if (pending) {
        const pendingUsername = members.find((m) => m.user_id === pending.pendingUserId)?.username ?? null;
        pendingAction = {
          ...pending,
          pendingUsername,
          canHostForce: auth.user.id === room.host_user_id && canForcePendingAction(pending, serverNowMs),
        };
      }
    }
  }

  // 回合结算后的“阅读确认”机制：仅暴露计数与自身是否已确认
  if (isPlayer && postRoundRaw && latestRound) {
    const roundId = typeof (postRoundRaw as any).roundId === 'string' ? String((postRoundRaw as any).roundId) : '';
    const confirmedUserIds = Array.isArray((postRoundRaw as any).confirmedUserIds)
      ? (postRoundRaw as any).confirmedUserIds.filter((x: any) => typeof x === 'number' && Number.isFinite(x)).map((x: number) => Math.floor(x))
      : [];
    const postRoundCreatedAt = typeof (postRoundRaw as any).createdAt === 'string' ? String((postRoundRaw as any).createdAt) : null;
    const confirmedAtByUserId = (postRoundRaw as any).confirmedAtByUserId && typeof (postRoundRaw as any).confirmedAtByUserId === 'object'
      ? ((postRoundRaw as any).confirmedAtByUserId as Record<string, string>)
      : null;
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

      if (room.phase === 'reviewing') {
        const pending = computeLastPendingConfirmAction({
          nowMs: serverNowMs,
          phaseFallbackAt: room.last_activity_at ?? room.updated_at,
          postRoundCreatedAt,
          players: players.map((p) => ({ userId: p.user_id })),
          confirmedUserIds,
          confirmedAtByUserId,
        });
        if (pending) {
          const pendingUsername = players.find((p) => p.user_id === pending.pendingUserId)?.username ?? null;
          pendingAction = {
            ...pending,
            pendingUsername,
            canHostForce: auth.user.id === room.host_user_id && canForcePendingAction(pending, serverNowMs),
          };
        }
      }
    }
  }

  if (isPlayer && !pendingAction && room.phase === 'submitting' && rules.cardsPerPlayer > 0 && rules.submissionMode !== 'hostOnly') {
    const pending = computeLastPendingSubmissionAction({
      nowMs: serverNowMs,
      phaseFallbackAt: room.last_activity_at ?? room.updated_at,
      players: players.map((p) => ({ userId: p.user_id })),
      submissions: submissionsRows.map((r) => ({ userId: r.user_id, updatedAt: r.updated_at })),
    });
    if (pending) {
      const pendingUsername = players.find((p) => p.user_id === pending.pendingUserId)?.username ?? null;
      pendingAction = {
        ...pending,
        pendingUsername,
        canHostForce: auth.user.id === room.host_user_id && canForcePendingAction(pending, serverNowMs),
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
    for (const b of displayBots) seatToUserId.set(b.seat, botUserIdForClient(b.seat));

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
    serverNow: serverNowIso,
    viewer: {
      role: viewerRole,
      canSwitchToPlayer:
        viewerRole === 'spectator' &&
        (room.phase === 'waiting' || room.phase === 'submitting') &&
        (players.length + bots.length) < rules.participants,
      canSwitchToSpectator:
        viewerRole === 'player' &&
        auth.user.id !== room.host_user_id &&
        rules.allowSpectators !== false &&
        (room.phase === 'waiting' || room.phase === 'submitting'),
    },
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
      scenarioAdjudicationImportedFor,
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
      ...displayBots.map((b) => ({
        userId: botUserIdForClient(b.seat),
        username: b.name,
        prefix: null,
        seat: b.seat,
        isBot: true,
        badges: [],
        botId: b.id,
      })),
    ].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99)),
    spectators: members
      .filter((m) => m.role === 'spectator')
      .map((m) => ({
        userId: m.user_id,
        username: m.username,
        prefix: m.prefix,
        badges: badgesByUserId.get(m.user_id) || [],
      }))
      .sort((a, b) => (a.userId ?? 0) - (b.userId ?? 0)),
    submissions: submissions.sort((a: any, b: any) => (a.userId ?? 0) - (b.userId ?? 0)),
    submissionStatus: submissionStatus.sort((a, b) => (a.userId ?? 0) - (b.userId ?? 0)),
    myHand: myHand ? { cards: myHandCardsDetailed, discarded: myHand.discarded, drawPile: myHand.drawPile } : null,
    latestRound: latestRound ? { id: latestRound.id, index: latestRound.round_index, status: latestRound.status } : null,
    choices: choicesState,
    latestRoundResult,
    winnerVote,
    confirmations: isPlayer ? confirmations : null,
    pendingAction: (isPlayer || room.phase === 'voting') ? pendingAction : null,
    score,
  });
}

export const appRouteHandler = withPvpErrorBoundary(getRoomHandler);
export default appRouteHandler;
