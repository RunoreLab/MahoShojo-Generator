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

type KickBody = { expectedVersion?: number; userId?: number };

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

async function kickHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<KickBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可踢人' }, { status: 403 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const targetId = Number.isFinite(body.data.userId) ? Math.floor(body.data.userId as number) : null;
  if (!targetId) return json({ error: '缺少 userId' }, { status: 400 });
  if (targetId <= 0) return json({ error: '不能踢出机器人，请使用“移除机器人”', code: 'BOT_KICK_FORBIDDEN' }, { status: 400 });
  if (targetId === auth.user.id) return json({ error: '不能踢自己' }, { status: 400 });

  const members = await getPvpRoomMembers(roomId);
  const targetMember = members.find((p) => p.user_id === targetId) ?? null;
  if (!targetMember) return json({ error: '该用户不在房间中' }, { status: 404 });

  const players = await getPvpRoomPlayers(roomId);
  const targetPlayer = players.find((p) => p.user_id === targetId) ?? null;

  const now = new Date().toISOString();
  const canReplaceWithBot = room.phase === 'submitting' || room.phase === 'choosing' || room.phase === 'voting' || room.phase === 'reviewing';
  const isBusyPhase = room.phase === 'dealing' || room.phase === 'advancing' || room.phase === 'resolving';

  if (!targetPlayer) {
    const ok = await updatePvpRoomCas(roomId, expectedVersion, { last_activity_at: now });
    if (!ok) return json({ error: '踢出失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
    await removePvpRoomPlayer(roomId, targetId);
    await deletePvpRoomSubmission(roomId, targetId);
    await deletePvpRoomHand(roomId, targetId);
    return json({ success: true, kicked: { userId: targetId, role: targetMember.role }, nextVersion: expectedVersion + 1 });
  }
  if (isBusyPhase) {
    return json({ error: '房间正在推进/结算中，请稍后再踢出', code: 'PHASE_BUSY' }, { status: 409 });
  }

  if (canReplaceWithBot) {
    const seat = typeof targetPlayer.seat === 'number' ? Math.floor(targetPlayer.seat) : null;
    if (seat === null || seat < 0) return json({ error: '座位异常，无法托管', code: 'SEAT_INVALID' }, { status: 500 });

    const parsed = parsePvpRoomInternalState(room.rules_json);
    if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
    const internal = parsed.internal;
    const rules = internal.rules;

    if (internal.bots.some((b) => b.seat === seat)) {
      return json({ error: '座位冲突：该座位已存在机器人', code: 'SEAT_CONFLICT' }, { status: 409 });
    }

    const usedNames = new Set<string>([
      ...players.filter((p) => p.user_id !== targetId).map((p) => (typeof p.username === 'string' ? p.username.trim() : '')).filter(Boolean),
      ...internal.bots.map((b) => b.name),
    ]);
    const baseName = `托管·${(targetPlayer.username || '').trim() || `用户${targetId}`}`;
    const botName = buildUniqueBotName(baseName, usedNames);
    const botId = `bot_${generateUUID()}`;
    const strategyId = pickBotStrategyId(Math.random);

    const submissions = await getPvpRoomSubmissions(roomId);
    const existingSub = submissions.find((s) => s.user_id === targetId)?.submission_json ?? null;
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
    const handRow = hands.find((h) => h.user_id === targetId);
    const hand = handRow ? parseHand(handRow.hand_json) : null;

    const choicesByRoundId: Record<string, string> = {};
    if (room.phase === 'choosing' && room.current_match_id) {
      const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
      if (latestRound && latestRound.status === 'pending') {
        const choiceRows = await getPvpRoundChoices(latestRound.id);
        const targetChoice = choiceRows.find((c) => c.user_id === targetId)?.choice_ref_json ?? null;
        const snapshotId = targetChoice ? parseChoiceSnapshotId(targetChoice) : null;
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
    if (!ok) return json({ error: '踢出失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

    await removePvpRoomPlayer(roomId, targetId);
    await deletePvpRoomSubmission(roomId, targetId);
    await deletePvpRoomHand(roomId, targetId);

    return json({ success: true, replacedByBot: { botId, botName, seat }, nextVersion: expectedVersion + 1 });
  }

  const remaining = players.filter((p) => p.user_id !== targetId);
  const shouldClose = remaining.length <= 0;
  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: shouldClose ? 'closed' : 'waiting',
    last_activity_at: now,
    ...(shouldClose ? { status: 'closed' as const, rules_json: clearPvpRoomRuntimeFromRulesJson(room.rules_json) } : {}),
  });
  if (!ok) return json({ error: '踢出失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
  await removePvpRoomPlayer(roomId, targetId);

  if (shouldClose) {
    const cleanupPromise = clearPvpRoomEphemeralState(roomId);
    const executionContext = (req as any).context;
    if (executionContext?.waitUntil) {
      executionContext.waitUntil(cleanupPromise);
    } else {
      cleanupPromise.catch((error) => console.warn('PVP 房间临时数据清理失败（非阻塞）:', error));
    }
  }

  return json({ success: true, nextVersion: expectedVersion + 1 });
}

export const appRouteHandler = withPvpErrorBoundary(kickHandler);
export default appRouteHandler;
