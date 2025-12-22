import {
  createPvpCardSnapshot,
  createPvpMatch,
  createPvpMatchPlayers,
  createPvpRound,
  generateUUID,
  getPvpCardSnapshotById,
  getPvpEligibleDataCard,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  updatePvpMatch,
  updatePvpRoomCas,
  upsertPvpRoomHand,
} from '@/lib/d1';
import { pickBotChoiceSnapshotId } from '@/lib/pvp/bot/choose';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { dealSnapshots } from '@/lib/pvp/logic';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { parsePvpScenarioSelection } from '@/lib/pvp/scenario';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpCardRef, PvpHandState, PvpSubmissionPayload, PvpSubmittedCard } from '@/lib/pvp/types';

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

type StartBody = { expectedVersion?: number };

async function startHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<StartBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可开始对局' }, { status: 403 });
  if (room.status !== 'open') return json({ error: '房间已关闭' }, { status: 410 });

  if (room.phase !== 'submitting') {
    // 幂等：若已发牌则直接返回
    if (room.phase === 'choosing') return json({ success: true, alreadyStarted: true });
    return json({ error: '当前阶段不允许开始对局', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;
  const rules = internal.rules;
  const bots = internal.bots;
  const recordMatch = bots.length <= 0;
  const scenarioSelection = parsePvpScenarioSelection((internal.raw as any)?._scenario);
  if (rules.mode === 'scenario' && !scenarioSelection) {
    return json({ error: '当前为情景模式，但尚未选择情景', code: 'SCENARIO_MISSING' }, { status: 409 });
  }

  const players = await getPvpRoomPlayers(roomId);
  const totalParticipants = players.length + bots.length;
  if (totalParticipants < rules.participants) return json({ error: '人数不足，无法开始' }, { status: 409 });

  const sortedPlayers = [...players].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
  if (sortedPlayers.some((p) => typeof p.seat !== 'number')) return json({ error: '房间座位异常' }, { status: 500 });
  if (bots.some((b) => !Number.isFinite(b.seat))) return json({ error: '机器人座位异常' }, { status: 500 });

  const usedSeats = new Set<number>();
  for (const p of sortedPlayers) usedSeats.add(p.seat as number);
  for (const b of bots) {
    if (usedSeats.has(b.seat)) return json({ error: '座位冲突（机器人与玩家座位重复）', code: 'SEAT_CONFLICT' }, { status: 500 });
    usedSeats.add(b.seat);
  }

  const participants = [
    ...sortedPlayers.map((p) => ({ kind: 'human' as const, seat: p.seat as number, userId: p.user_id, username: p.username ?? null, prefix: p.prefix ?? null, joinedAt: p.joined_at })),
    ...bots.map((b) => ({ kind: 'bot' as const, seat: b.seat, botId: b.id, name: b.name, strategyId: b.strategyId })),
  ].sort((a, b) => a.seat - b.seat);
  if (participants.length !== rules.participants) return json({ error: '房间参与者数量与规则不一致' }, { status: 500 });

  const submissions = await getPvpRoomSubmissions(roomId);
  const submissionMap = new Map<number, PvpSubmissionPayload>();
  for (const row of submissions) {
    const parsed = parseSubmission(row.submission_json);
    if (!parsed) return json({ error: '提交数据损坏，请重新提交' }, { status: 409 });
    submissionMap.set(row.user_id, parsed);
  }

  for (const p of sortedPlayers) {
    const sub = submissionMap.get(p.user_id);
    if (!sub) return json({ error: '仍有玩家未提交卡组' }, { status: 409 });
    if (sub.cards.length !== rules.cardsPerPlayer) return json({ error: '提交数量与房间规则不一致，请重新提交' }, { status: 409 });
  }
  for (const b of bots) {
    if (!b.submission || !Array.isArray(b.submission.cards) || b.submission.cards.length !== rules.cardsPerPlayer) {
      return json({ error: '机器人提交异常，请移除机器人后重新添加', code: 'BOT_SUBMISSION_INVALID' }, { status: 409 });
    }
  }

  // 防御：若 submitting 阶段仍存在手牌，说明上一次对局清理不完整
  const existingHandsBeforeStart = await getPvpRoomHands(roomId);
  if (existingHandsBeforeStart.length > 0) {
    return json({ error: '检测到残留手牌数据，请房主先重开房间再开始', code: 'RUNTIME_STATE_DIRTY' }, { status: 409 });
  }

  // 清理 Bot 运行态（手牌/选择），避免上一局残留影响
  internal.bots = internal.bots.map((b) => ({ ...b, hand: undefined, choicesByRoundId: undefined }));

  const matchId = generateUUID();
  const matchStartedAt = new Date().toISOString();

  const casToDealing = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: 'dealing',
    current_match_id: matchId,
    last_activity_at: matchStartedAt,
  });
  if (!casToDealing) return json({ error: '开始失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
  const dealingVersion = expectedVersion + 1;

  const abortAndRollback = async (reason: string, extra?: Record<string, unknown>): Promise<boolean> => {
    const now = new Date().toISOString();

    // best-effort：标记对战为 aborted（若对战记录尚未创建则该更新会失败，但不影响回滚）
    if (recordMatch) {
      await updatePvpMatch(matchId, {
        status: 'aborted',
        endedAt: now,
        winnerUserId: null,
        resultJson: JSON.stringify({ reason, ...(extra ?? {}) }),
      });
    }

    const patch = {
      phase: 'submitting' as const,
      current_match_id: null,
      last_activity_at: now,
    };

    const ok = await updatePvpRoomCas(roomId, dealingVersion, patch);
    if (ok) return true;

    // 回滚 CAS 失败时，尝试刷新版本并在“仍处于 dealing 且 matchId 未变”的条件下再试一次
    const refreshed = await getPvpRoomById(roomId);
    if (!refreshed) return false;
    if (refreshed.phase !== 'dealing') return false;
    if (refreshed.current_match_id !== matchId) return false;
    return await updatePvpRoomCas(roomId, refreshed.version, patch);
  };

  if (recordMatch) {
    const matchOk = await createPvpMatch({
      id: matchId,
      roomId,
      rulesJson: room.rules_json,
      participants: rules.participants,
      startedAt: matchStartedAt,
    });
    if (!matchOk) {
      const rolledBack = await abortAndRollback('match-create-failed');
      if (!rolledBack) {
        return json({ error: '创建对战记录失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '创建对战记录失败' }, { status: 500 });
    }

    const matchPlayersOk = await createPvpMatchPlayers(
      matchId,
      sortedPlayers.map((p) => ({
        userId: p.user_id,
        seat: p.seat ?? 0,
        username: p.username ?? null,
        userPrefix: p.prefix ?? null,
        joinedAt: p.joined_at,
      }))
    );
    if (!matchPlayersOk) {
      const rolledBack = await abortAndRollback('match-players-create-failed');
      if (!rolledBack) {
        return json({ error: '创建对战参与者快照失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '创建对战参与者快照失败' }, { status: 500 });
    }
  }

  if (rules.shuffleDecks !== true) {
    const botById = new Map(internal.bots.map((b) => [b.id, b]));

    const hands: PvpHandState[] = [];
    let hiddenCount = 0;

    for (const participant of participants) {
      const submittedBy =
        participant.kind === 'human'
          ? { kind: 'human' as const, userId: participant.userId, username: participant.username ?? null }
          : { kind: 'bot' as const, name: participant.name };

      const eligibilityUserId = participant.kind === 'human' ? participant.userId : auth.user.id;
      const submissionCards =
        participant.kind === 'human'
          ? (submissionMap.get(participant.userId)?.cards ?? [])
          : (botById.get(participant.botId)?.submission?.cards ?? []);

      if (submissionCards.length < rules.dealPerPlayer) {
        const rolledBack = await abortAndRollback('deck-too-small-per-player', {
          seat: participant.seat,
          needed: rules.dealPerPlayer,
          actual: submissionCards.length,
        });
        const error = `玩家座位 ${participant.seat} 的提交卡组不足以发牌：需要 ${rules.dealPerPlayer} 张，实际 ${submissionCards.length} 张`;
        if (!rolledBack) {
          return json({ error: `${error}（且回滚失败，请房主点击“重开房间”恢复）`, code: 'ROLLBACK_FAILED' }, { status: 409 });
        }
        return json({ error, code: 'DECK_TOO_SMALL' }, { status: 409 });
      }

      hiddenCount += Math.max(0, submissionCards.length - rules.dealPerPlayer);

      const dealtCards = submissionCards.slice(0, rules.dealPerPlayer);
      const snapshotRefs: Array<{ kind: 'snapshot'; id: string }> = [];

      for (const card of dealtCards) {
        if (card.ref.kind === 'data_card') {
          const latest = await getPvpEligibleDataCard(card.ref.id, eligibilityUserId);
          if (!latest) {
            const rolledBack = await abortAndRollback('card-not-eligible', { cardId: card.ref.id });
            if (!rolledBack) {
              return json({ error: '存在不可用的数据卡，请重新提交（且回滚失败，请房主点击“重开房间”恢复）', code: 'ROLLBACK_FAILED' }, { status: 409 });
            }
            return json({ error: '存在不可用的数据卡，请重新提交', code: 'CARD_NOT_ELIGIBLE' }, { status: 409 });
          }
          const currentUpdatedAt = typeof latest.updated_at === 'string' ? latest.updated_at : null;
          if (card.ref.updatedAt && currentUpdatedAt && card.ref.updatedAt !== currentUpdatedAt) {
            const rolledBack = await abortAndRollback('card-version-mismatch', { cardId: card.ref.id });
            if (!rolledBack) {
              return json({ error: '数据卡版本已变更，请重新提交（且回滚失败，请房主点击“重开房间”恢复）', code: 'ROLLBACK_FAILED' }, { status: 409 });
            }
            return json({ error: '数据卡版本已变更，请重新提交', code: 'CARD_VERSION_MISMATCH', cardId: card.ref.id }, { status: 409 });
          }
        }

        const snapshotId = await createPvpCardSnapshot({
          roomId,
          ownerUserId: eligibilityUserId,
          refJson: JSON.stringify({
            ...card.ref,
            ...(submittedBy.kind === 'human'
              ? { submittedByUserId: submittedBy.userId, submittedByUsername: submittedBy.username }
              : { submittedByBot: true, submittedByBotName: submittedBy.name }),
          }),
          cardType: card.type,
          name: card.name,
          dataJson: card.dataJson,
          sourceUpdatedAt: card.ref.kind === 'data_card' ? card.ref.updatedAt : null,
        });
        if (!snapshotId) {
          const rolledBack = await abortAndRollback('snapshot-create-failed');
          if (!rolledBack) {
            return json({ error: '生成快照失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
          }
          return json({ error: '生成快照失败' }, { status: 500 });
        }
        snapshotRefs.push({ kind: 'snapshot', id: snapshotId });
      }

      hands.push({ cards: snapshotRefs, discarded: [], drawPile: [] });
    }

    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i]!;
      const hand = hands[i]!;
      if (participant.kind === 'human') {
        const ok = await upsertPvpRoomHand(roomId, participant.userId, JSON.stringify(hand));
        if (!ok) {
          const rolledBack = await abortAndRollback('hand-write-failed', { userId: participant.userId });
          if (!rolledBack) {
            return json({ error: '写入手牌失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
          }
          return json({ error: '写入手牌失败' }, { status: 500 });
        }
        continue;
      }

      const bot = botById.get(participant.botId);
      if (bot) bot.hand = hand;
    }

    const roundId = await createPvpRound({
      roomId,
      matchId,
      roundIndex: 1,
      status: 'pending',
      publicSnapshotJson: JSON.stringify({
        dealPerPlayer: rules.dealPerPlayer,
        cardsPerPlayer: rules.cardsPerPlayer,
        dedupe: rules.dedupe,
        hiddenCount,
        mode: rules.mode,
        bestOf: rules.bestOf,
        showAllSubmissions: rules.showAllSubmissions,
        shuffleDecks: rules.shuffleDecks,
      }),
    });
    if (!roundId) {
      const rolledBack = await abortAndRollback('round-create-failed');
      if (!rolledBack) {
        return json({ error: '创建回合失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '创建回合失败' }, { status: 500 });
    }

    // Bot 自动出牌：为本回合预先选择（失败则不阻塞开局）
    try {
      for (const b of internal.bots) {
        if (!b.hand?.cards?.length) continue;
        const snapshotIds = b.hand.cards.map((c: any) => (c && c.kind === 'snapshot' ? c.id : null)).filter(Boolean) as string[];
        const snapshots = [];
        for (const id of snapshotIds) {
          const snap = await getPvpCardSnapshotById(id);
          if (snap) snapshots.push(snap);
        }
        const picked = await pickBotChoiceSnapshotId({
          bot: { strategyId: b.strategyId },
          snapshots: snapshots.map((s) => ({ id: s.id, name: s.name, data_json: s.data_json, ref_json: s.ref_json })),
        });
        if (picked) {
          b.choicesByRoundId = { ...(b.choicesByRoundId ?? {}), [roundId]: picked };
        }
      }
    } catch {
      // ignore
    }

    const casToChoosing = await updatePvpRoomCas(roomId, dealingVersion, {
      phase: 'choosing',
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: new Date().toISOString(),
    });
    if (!casToChoosing) {
      return json({ success: true, roundId, warning: '发牌完成，但房间状态更新失败，请刷新' });
    }

    return json({ success: true, roundId, nextVersion: dealingVersion + 1 });
  }

  // 合并提交卡，按规则去重
  const allSubmitted: Array<{
    eligibilityUserId: number;
    submittedBy: { kind: 'human'; userId: number; username: string | null } | { kind: 'bot'; name: string };
    card: PvpSubmittedCard;
  }> = [];

  for (const p of sortedPlayers) {
    const sub = submissionMap.get(p.user_id)!;
    sub.cards.forEach((card) =>
      allSubmitted.push({
        eligibilityUserId: p.user_id,
        submittedBy: { kind: 'human', userId: p.user_id, username: p.username ?? null },
        card,
      })
    );
  }
  for (const b of bots) {
    b.submission.cards.forEach((card) =>
      allSubmitted.push({
        eligibilityUserId: auth.user.id, // Bot 仅提交公开/预设，任意用户都可读；这里用房主 id 走统一校验
        submittedBy: { kind: 'bot', name: b.name },
        card,
      })
    );
  }

  const buildKey = (ref: PvpCardRef): string =>
    ref.kind === 'data_card' ? `data_card:${ref.id}` : ref.kind === 'preset' ? `preset:${ref.filename}` : `snapshot:${ref.id}`;

  const deckCards: Array<{
    eligibilityUserId: number;
    submittedBy: { kind: 'human'; userId: number; username: string | null } | { kind: 'bot'; name: string };
    card: PvpSubmittedCard;
  }> = (() => {
    if (!rules.dedupe) return allSubmitted;
    const seen = new Set<string>();
    const out: Array<{
      eligibilityUserId: number;
      submittedBy: { kind: 'human'; userId: number; username: string | null } | { kind: 'bot'; name: string };
      card: PvpSubmittedCard;
    }> = [];
    for (const item of allSubmitted) {
      const key = buildKey(item.card.ref);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  })();

  const needed = rules.participants * rules.dealPerPlayer;
  if (deckCards.length <= needed) {
    const rolledBack = await abortAndRollback('deck-too-small', { needed, actual: deckCards.length });
    const error = `卡池不足以保持手牌隐藏：需要 > ${needed} 张，实际 ${deckCards.length} 张`;
    if (!rolledBack) {
      return json({ error: `${error}（且回滚失败，请房主点击“重开房间”恢复）`, code: 'ROLLBACK_FAILED' }, { status: 409 });
    }
    return json({ error, code: 'DECK_TOO_SMALL' }, { status: 409 });
  }

  // 再校验 data_card 版本与可用性，并生成快照
  const snapshotDeck: Array<{ kind: 'snapshot'; id: string }> = [];
  for (const { eligibilityUserId, submittedBy, card } of deckCards) {
    if (card.ref.kind === 'data_card') {
      const latest = await getPvpEligibleDataCard(card.ref.id, eligibilityUserId);
      if (!latest) {
        const rolledBack = await abortAndRollback('card-not-eligible', { cardId: card.ref.id });
        if (!rolledBack) {
          return json({ error: '存在不可用的数据卡，请重新提交（且回滚失败，请房主点击“重开房间”恢复）', code: 'ROLLBACK_FAILED' }, { status: 409 });
        }
        return json({ error: '存在不可用的数据卡，请重新提交', code: 'CARD_NOT_ELIGIBLE' }, { status: 409 });
      }
      const currentUpdatedAt = typeof latest.updated_at === 'string' ? latest.updated_at : null;
      if (card.ref.updatedAt && currentUpdatedAt && card.ref.updatedAt !== currentUpdatedAt) {
        const rolledBack = await abortAndRollback('card-version-mismatch', { cardId: card.ref.id });
        if (!rolledBack) {
          return json({ error: '数据卡版本已变更，请重新提交（且回滚失败，请房主点击“重开房间”恢复）', code: 'ROLLBACK_FAILED' }, { status: 409 });
        }
        return json({ error: '数据卡版本已变更，请重新提交', code: 'CARD_VERSION_MISMATCH', cardId: card.ref.id }, { status: 409 });
      }
    }

    const snapshotId = await createPvpCardSnapshot({
      roomId,
      ownerUserId: eligibilityUserId,
      refJson: JSON.stringify({
        ...card.ref,
        ...(submittedBy.kind === 'human'
          ? { submittedByUserId: submittedBy.userId, submittedByUsername: submittedBy.username }
          : { submittedByBot: true, submittedByBotName: submittedBy.name }),
      }),
      cardType: card.type,
      name: card.name,
      dataJson: card.dataJson,
      sourceUpdatedAt: card.ref.kind === 'data_card' ? card.ref.updatedAt : null,
    });
    if (!snapshotId) {
      const rolledBack = await abortAndRollback('snapshot-create-failed');
      if (!rolledBack) {
        return json({ error: '生成快照失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
      }
      return json({ error: '生成快照失败' }, { status: 500 });
    }
    snapshotDeck.push({ kind: 'snapshot', id: snapshotId });
  }

  const dealt = dealSnapshots({
    playerCount: rules.participants,
    handSize: rules.dealPerPlayer,
    deck: snapshotDeck,
    allowDrawPile: false,
  });
  if ('error' in dealt) {
    const rolledBack = await abortAndRollback('deal-failed', { message: dealt.error });
    if (!rolledBack) {
      return json({ error: `${dealt.error}（且回滚失败，请房主点击“重开房间”恢复）`, code: 'ROLLBACK_FAILED' }, { status: 409 });
    }
    return json({ error: dealt.error, code: 'DEAL_FAILED' }, { status: 409 });
  }

  const hiddenCount = Math.max(0, snapshotDeck.length - needed);

  const botById = new Map(internal.bots.map((b) => [b.id, b]));
  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i]!;
    const hand = dealt.hands[i]!;
    if (participant.kind === 'human') {
      const ok = await upsertPvpRoomHand(roomId, participant.userId, JSON.stringify(hand));
      if (!ok) {
        const rolledBack = await abortAndRollback('hand-write-failed', { userId: participant.userId });
        if (!rolledBack) {
          return json({ error: '写入手牌失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
        }
        return json({ error: '写入手牌失败' }, { status: 500 });
      }
      continue;
    }

    const bot = botById.get(participant.botId);
    if (bot) bot.hand = hand;
  }

  const roundId = await createPvpRound({
    roomId,
    matchId,
    roundIndex: 1,
    status: 'pending',
    publicSnapshotJson: JSON.stringify({
      dealPerPlayer: rules.dealPerPlayer,
      cardsPerPlayer: rules.cardsPerPlayer,
      dedupe: rules.dedupe,
      hiddenCount,
      mode: rules.mode,
      bestOf: rules.bestOf,
      showAllSubmissions: rules.showAllSubmissions,
      shuffleDecks: rules.shuffleDecks,
    }),
  });
  if (!roundId) {
    const rolledBack = await abortAndRollback('round-create-failed');
    if (!rolledBack) {
      return json({ error: '创建回合失败，且房间状态回滚失败，请房主点击“重开房间”恢复', code: 'ROLLBACK_FAILED' }, { status: 409 });
    }
    return json({ error: '创建回合失败' }, { status: 500 });
  }

  // Bot 自动出牌：为本回合预先选择（失败则不阻塞开局）
  try {
    for (const b of internal.bots) {
      if (!b.hand?.cards?.length) continue;
      const snapshotIds = b.hand.cards.map((c: any) => (c && c.kind === 'snapshot' ? c.id : null)).filter(Boolean) as string[];
      const snapshots = [];
      for (const id of snapshotIds) {
        const snap = await getPvpCardSnapshotById(id);
        if (snap) snapshots.push(snap);
      }
      const picked = await pickBotChoiceSnapshotId({
        bot: { strategyId: b.strategyId },
        snapshots: snapshots.map((s) => ({ id: s.id, name: s.name, data_json: s.data_json, ref_json: s.ref_json })),
      });
      if (picked) {
        b.choicesByRoundId = { ...(b.choicesByRoundId ?? {}), [roundId]: picked };
      }
    }
  } catch {
    // ignore
  }

  const casToChoosing = await updatePvpRoomCas(roomId, dealingVersion, {
    phase: 'choosing',
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: new Date().toISOString(),
  });
  if (!casToChoosing) {
    return json({ success: true, roundId, warning: '发牌完成，但房间状态更新失败，请刷新' });
  }

  return json({ success: true, roundId, nextVersion: dealingVersion + 1 });
}

export default withPvpErrorBoundary(startHandler);
