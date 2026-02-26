import {
  clearPvpRoomEphemeralState,
  deletePvpRoomHand,
  deletePvpRoomSubmission,
  getLatestPvpRoundByMatch,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomMembers,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  getPvpRoundChoices,
  removePvpRoomPlayer,
  updatePvpRoomCas,
} from '@/lib/database/pvp';
import { generateUUID } from '@/lib/database/core';
import { pickBotStrategyId } from '@/lib/pvp/bot/strategies';
import { buildBotSubmissionPayload } from '@/lib/pvp/bot/submission';
import { clearPvpRoomRuntimeFromRulesJson, parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpHandState, PvpSnapshotRef, PvpSubmissionPayload } from '@/lib/pvp/types';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';

export const runtime = 'edge';

const parseSubmission = (raw: string): PvpSubmissionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSubmissionPayload;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).cards) || !Array.isArray((parsed as any).discarded)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const parseChoiceSnapshotId = (raw: string): string | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSnapshotRef;
    if (!parsed || typeof parsed !== 'object' || (parsed as any).kind !== 'snapshot') return null;
    const id = typeof (parsed as any).id === 'string' ? String((parsed as any).id).trim() : '';
    return id || null;
  } catch {
    return null;
  }
};

const buildUniqueBotName = (base: string, used: Set<string>): string => {
  const trimmed = base.trim() || '托管AI';
  if (!used.has(trimmed)) return trimmed;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${trimmed}#${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${trimmed}#${Date.now().toString(36).slice(-4)}`;
};

async function leaveHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<{ expectedVersion?: number }>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  // 离开房间属于“尽力而为”的操作：不强制要求前端携带最新 version，避免用户在轮询/网络抖动时无法退出。
  // 仍使用 CAS 写入以减少并发覆盖风险，但以服务端读取到的 room.version 为准。
  const expectedVersion = room.version;

  const members = await getPvpRoomMembers(roomId);
  const leavingMember = members.find((p) => p.user_id === auth.user.id) ?? null;
  if (!leavingMember) return json({ success: true, notInRoom: true });

  const players = await getPvpRoomPlayers(roomId);
  const leavingPlayer = players.find((p) => p.user_id === auth.user.id) ?? null;

  const now = new Date().toISOString();
  const isHostLeaving = room.host_user_id === auth.user.id;
  const canReplaceWithBot = room.phase === 'submitting' || room.phase === 'choosing' || room.phase === 'voting' || room.phase === 'reviewing';
  const isBusyPhase = room.phase === 'dealing' || room.phase === 'advancing' || room.phase === 'resolving';

  if (!leavingPlayer) {
    const ok = await updatePvpRoomCas(roomId, expectedVersion, { last_activity_at: now });
    await removePvpRoomPlayer(roomId, auth.user.id);
    await deletePvpRoomSubmission(roomId, auth.user.id);
    await deletePvpRoomHand(roomId, auth.user.id);
    return json({ success: true, role: leavingMember.role, ...(ok ? {} : { warning: '状态更新失败（可能存在并发），但已尽力退出' }) });
  }

  if (isBusyPhase) {
    const patch = isHostLeaving
      ? { status: 'closed' as const, phase: 'closed' as const, rules_json: clearPvpRoomRuntimeFromRulesJson(room.rules_json) }
      : {};
    const ok = await updatePvpRoomCas(roomId, expectedVersion, { ...patch, last_activity_at: now });
    await removePvpRoomPlayer(roomId, auth.user.id);
    await deletePvpRoomSubmission(roomId, auth.user.id);
    await deletePvpRoomHand(roomId, auth.user.id);
    return json({
      success: true,
      leftDuringBusyPhase: true,
      ...(isHostLeaving ? { closed: true } : {}),
      ...(ok ? {} : { warning: '状态更新失败（可能存在并发），但已尽力退出' }),
    });
  }

  if (!isHostLeaving && canReplaceWithBot) {
    const seat = typeof leavingPlayer.seat === 'number' ? Math.floor(leavingPlayer.seat) : null;
    if (seat === null || seat < 0) return json({ error: '座位异常，无法托管', code: 'SEAT_INVALID' }, { status: 500 });

    const parsed = parsePvpRoomInternalState(room.rules_json);
    if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
    const internal = parsed.internal;
    const rules = internal.rules;

    if (internal.bots.some((b) => b.seat === seat)) {
      return json({ error: '座位冲突：该座位已存在机器人', code: 'SEAT_CONFLICT' }, { status: 409 });
    }

    const usedNames = new Set<string>([
      ...players.filter((p) => p.user_id !== auth.user.id).map((p) => (typeof p.username === 'string' ? p.username.trim() : '')).filter(Boolean),
      ...internal.bots.map((b) => b.name),
    ]);
    const baseName = `托管·${(leavingPlayer.username || '').trim() || `用户${auth.user.id}`}`;
    const botName = buildUniqueBotName(baseName, usedNames);
    const botId = `bot_${generateUUID()}`;
    const strategyId = pickBotStrategyId(Math.random);

    const submissions = await getPvpRoomSubmissions(roomId);
    const existingSub = submissions.find((s) => s.user_id === auth.user.id)?.submission_json ?? null;
    const parsedSub = existingSub ? parseSubmission(existingSub) : null;
    let submission: PvpSubmissionPayload = parsedSub && parsedSub.cards.length === rules.cardsPerPlayer
      ? parsedSub
      : { cards: [], hasPrivateCard: false };

    if (rules.cardsPerPlayer > 0 && submission.cards.length !== rules.cardsPerPlayer) {
      const origin = getRequestOrigin(req);
      const subrequestAuthHeaders = buildSubrequestAuthHeaders(req);
      const built = await buildBotSubmissionPayload({ rules, origin, forwardHeaders: subrequestAuthHeaders });
      if (built.cards.length !== rules.cardsPerPlayer) {
        return json({ error: '托管失败：无法构建机器人卡组（候选不足）', code: 'BOT_DECK_FAILED' }, { status: 409 });
      }
      submission = built;
    }

    const hands = await getPvpRoomHands(roomId);
    const handRow = hands.find((h) => h.user_id === auth.user.id);
    const hand = handRow ? parseHand(handRow.hand_json) : null;

    const choicesByRoundId: Record<string, string> = {};
    if (room.phase === 'choosing' && room.current_match_id) {
      const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
      if (latestRound && latestRound.status === 'pending') {
        const choiceRows = await getPvpRoundChoices(latestRound.id);
        const myChoice = choiceRows.find((c) => c.user_id === auth.user.id)?.choice_ref_json ?? null;
        const snapshotId = myChoice ? parseChoiceSnapshotId(myChoice) : null;
        if (snapshotId) choicesByRoundId[latestRound.id] = snapshotId;
      }
    }

    internal.bots.push({
      id: botId,
      name: botName,
      seat,
      strategyId,
      submission,
      ...(hand ? { hand } : {}),
      ...(Object.keys(choicesByRoundId).length > 0 ? { choicesByRoundId } : {}),
    });

    const ok = await updatePvpRoomCas(roomId, expectedVersion, {
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: now,
    });
    if (!ok) {
      // 托管写入失败时，仍允许用户退出，避免“无法退出房间”的体验灾难。
      await removePvpRoomPlayer(roomId, auth.user.id);
      await deletePvpRoomSubmission(roomId, auth.user.id);
      await deletePvpRoomHand(roomId, auth.user.id);
      return json({ success: true, replacedByBotFailed: true, warning: '托管机器人写入失败（可能存在并发），已退出但座位未托管' });
    }

    await removePvpRoomPlayer(roomId, auth.user.id);
    await deletePvpRoomSubmission(roomId, auth.user.id);
    await deletePvpRoomHand(roomId, auth.user.id);

    return json({ success: true, replacedByBot: { botId, botName, seat }, nextVersion: expectedVersion + 1 });
  }

  const remaining = players.filter((p) => p.user_id !== auth.user.id);

  const patch =
    isHostLeaving
      ? { status: 'closed' as const, phase: 'closed' as const }
      : remaining.length <= 0
        ? { status: 'closed' as const, phase: 'closed' as const }
        : { phase: 'waiting' as const };

  const shouldClose = 'status' in patch && patch.status === 'closed';
  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    ...patch,
    ...(shouldClose ? { rules_json: clearPvpRoomRuntimeFromRulesJson(room.rules_json) } : {}),
    last_activity_at: now,
  });
  if (!ok) {
    await removePvpRoomPlayer(roomId, auth.user.id);
    await deletePvpRoomSubmission(roomId, auth.user.id);
    await deletePvpRoomHand(roomId, auth.user.id);
    return json({ success: true, warning: '离开房间时状态更新失败（可能存在并发），已退出但房间状态可能需要刷新' });
  }

  await removePvpRoomPlayer(roomId, auth.user.id);

  if (shouldClose) {
    const cleanupPromise = clearPvpRoomEphemeralState(roomId);
    const executionContext = (req as any).context;
    if (executionContext?.waitUntil) {
      executionContext.waitUntil(cleanupPromise);
    } else {
      cleanupPromise.catch((error) => console.warn('PVP 房间临时数据清理失败（非阻塞）:', error));
    }
  }

  return json({ success: true });
}

export default withPvpErrorBoundary(leaveHandler);
