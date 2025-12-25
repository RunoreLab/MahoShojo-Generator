import {
  getLatestPvpRoundByMatch,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  getPvpRoundChoices,
  upsertPvpRoomSubmission,
  upsertPvpRoundChoice,
  updatePvpRoomCas,
} from '@/lib/d1';
import { buildBotSubmissionPayload } from '@/lib/pvp/bot/submission';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { canForcePendingAction, computeLastPendingChooseAction, computeLastPendingConfirmAction, computeLastPendingSubmissionAction } from '@/lib/pvp/pending-action';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpHandState, PvpSnapshotRef } from '@/lib/pvp/types';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';

export const runtime = 'edge';

type ForceKind = 'submit' | 'choose' | 'confirm';
type ForceBody = { expectedVersion?: number; kind?: ForceKind };

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).cards) || !Array.isArray((parsed as any).discarded)) return null;
    return parsed;
  } catch {
    return null;
  }
};

async function forceHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<ForceBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可强制操作', code: 'HOST_ONLY' }, { status: 403 });
  if (room.status !== 'open' || room.phase === 'closed') return json({ error: '房间已关闭' }, { status: 410 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const kind = typeof body.data.kind === 'string' ? (body.data.kind as ForceKind) : null;
  if (!kind) return json({ error: '缺少 kind（submit/choose/confirm）' }, { status: 400 });

  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  const players = await getPvpRoomPlayers(roomId);
  if (!players.some((p) => p.user_id === auth.user.id)) return json({ error: '你不在该房间中' }, { status: 403 });

  if (kind === 'submit') {
    if (room.phase !== 'submitting') return json({ error: '当前阶段不允许强制提交', code: 'PHASE_FORBIDDEN' }, { status: 409 });

    const internalParsed = parsePvpRoomInternalState(room.rules_json);
    if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
    const rules = internalParsed.internal.rules;
    if (rules.submissionMode === 'hostOnly') {
      return json({ error: '当前房间为“仅房主提交牌堆”模式，不支持强制提交', code: 'SUBMISSION_HOST_ONLY' }, { status: 409 });
    }
    if (rules.cardsPerPlayer <= 0) return json({ error: '当前房间无需提交卡组', code: 'SUBMISSION_SKIPPED' }, { status: 409 });

    const submissions = await getPvpRoomSubmissions(roomId);
    const pending = computeLastPendingSubmissionAction({
      nowMs,
      phaseFallbackAt: room.last_activity_at ?? room.updated_at,
      players: players.map((p) => ({ userId: p.user_id })),
      submissions: submissions.map((r) => ({ userId: r.user_id, updatedAt: r.updated_at })),
    });
    if (!pending) return json({ error: '当前不满足“仅剩最后一人未提交”的强制条件', code: 'FORCE_NOT_AVAILABLE' }, { status: 409 });
    if (!canForcePendingAction(pending, nowMs)) {
      return json({ error: '倒计时未结束，暂不可强制', code: 'FORCE_TOO_EARLY', pending }, { status: 409 });
    }

    const origin = getRequestOrigin(req);
    const subrequestAuthHeaders = buildSubrequestAuthHeaders(req);
    const submission = await buildBotSubmissionPayload({
      rules,
      origin,
      forwardHeaders: subrequestAuthHeaders,
    });
    if (submission.cards.length !== rules.cardsPerPlayer) {
      return json({ error: '随机卡组构建失败（候选不足）', code: 'FORCED_SUBMISSION_FAILED' }, { status: 409 });
    }

    const ok = await upsertPvpRoomSubmission(roomId, pending.pendingUserId, JSON.stringify(submission));
    if (!ok) return json({ error: '强制提交失败' }, { status: 500 });

    const casOk = await updatePvpRoomCas(roomId, expectedVersion, { last_activity_at: nowIso });
    if (!casOk) return json({ error: '强制提交成功，但房间状态更新失败，请刷新', code: 'VERSION_CONFLICT' }, { status: 409 });

    return json({ success: true, forced: 'submit', targetUserId: pending.pendingUserId, nextVersion: expectedVersion + 1 });
  }

  if (kind === 'choose') {
    if (room.phase !== 'choosing') return json({ error: '当前阶段不允许强制出牌', code: 'PHASE_FORBIDDEN' }, { status: 409 });
    if (!room.current_match_id) return json({ error: '对战上下文缺失，请房主重开房间后再试', code: 'MATCH_CONTEXT_MISSING' }, { status: 409 });

    const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
    if (!latestRound) return json({ error: '回合不存在', code: 'ROUND_NOT_FOUND' }, { status: 404 });
    if (latestRound.status !== 'pending') return json({ error: '回合已结算或不可用', code: 'ROUND_NOT_PENDING' }, { status: 409 });

    const choices = await getPvpRoundChoices(latestRound.id);
    const pending = computeLastPendingChooseAction({
      nowMs,
      phaseFallbackAt: latestRound.created_at ?? room.last_activity_at ?? room.updated_at,
      players: players.map((p) => ({ userId: p.user_id })),
      choices: choices.map((c) => ({ userId: c.user_id, updatedAt: c.updated_at })),
    });
    if (!pending) return json({ error: '当前不满足“仅剩最后一人未出牌”的强制条件', code: 'FORCE_NOT_AVAILABLE' }, { status: 409 });
    if (!canForcePendingAction(pending, nowMs)) {
      return json({ error: '倒计时未结束，暂不可强制', code: 'FORCE_TOO_EARLY', pending }, { status: 409 });
    }

    const hands = await getPvpRoomHands(roomId);
    const handRow = hands.find((h) => h.user_id === pending.pendingUserId);
    if (!handRow) return json({ error: '未找到目标玩家手牌，请刷新', code: 'HAND_MISSING' }, { status: 409 });
    const hand = parseHand(handRow.hand_json);
    if (!hand) return json({ error: '手牌数据损坏，请刷新', code: 'HAND_INVALID' }, { status: 500 });

    const snapshotIds = hand.cards
      .map((c: any) => (c && typeof c === 'object' && c.kind === 'snapshot' && typeof c.id === 'string' ? c.id : null))
      .filter(Boolean) as string[];
    if (snapshotIds.length <= 0) return json({ error: '目标玩家手牌为空，无法强制出牌', code: 'HAND_EMPTY' }, { status: 409 });

    const picked = snapshotIds[Math.floor(Math.random() * snapshotIds.length)]!;
    const choice: PvpSnapshotRef = { kind: 'snapshot', id: picked };
    const ok = await upsertPvpRoundChoice(latestRound.id, pending.pendingUserId, JSON.stringify(choice));
    if (!ok) return json({ error: '强制出牌失败' }, { status: 500 });

    return json({ success: true, forced: 'choose', roundId: latestRound.id, targetUserId: pending.pendingUserId });
  }

  if (kind === 'confirm') {
    if (room.phase !== 'reviewing') return json({ error: '当前阶段不允许强制确认', code: 'PHASE_FORBIDDEN' }, { status: 409 });
    if (!room.current_match_id) return json({ error: '对战上下文缺失，请房主重开房间后再试', code: 'MATCH_CONTEXT_MISSING' }, { status: 409 });

    const latestRound = await getLatestPvpRoundByMatch(room.current_match_id);
    if (!latestRound) return json({ error: '回合不存在', code: 'ROUND_NOT_FOUND' }, { status: 404 });

    const internalParsed = parsePvpRoomInternalState(room.rules_json);
    if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
    const internal = internalParsed.internal;

    const postRoundRaw = (internal.raw as any)?._postRound;
    const roundId = typeof postRoundRaw?.roundId === 'string' ? String(postRoundRaw.roundId) : '';
    if (!roundId || roundId !== latestRound.id) return json({ error: '确认上下文缺失，请刷新', code: 'POST_ROUND_MISSING' }, { status: 409 });

    const confirmedUserIds = Array.isArray(postRoundRaw?.confirmedUserIds)
      ? postRoundRaw.confirmedUserIds.filter((x: any) => typeof x === 'number' && Number.isFinite(x)).map((x: number) => Math.floor(x))
      : [];
    const postRoundCreatedAt = typeof postRoundRaw?.createdAt === 'string' ? String(postRoundRaw.createdAt) : null;
    const confirmedAtByUserId = postRoundRaw?.confirmedAtByUserId && typeof postRoundRaw.confirmedAtByUserId === 'object'
      ? (postRoundRaw.confirmedAtByUserId as Record<string, string>)
      : null;

    const pending = computeLastPendingConfirmAction({
      nowMs,
      phaseFallbackAt: room.last_activity_at ?? room.updated_at,
      postRoundCreatedAt,
      players: players.map((p) => ({ userId: p.user_id })),
      confirmedUserIds,
      confirmedAtByUserId,
    });
    if (!pending) return json({ error: '当前不满足“仅剩最后一人未确认”的强制条件', code: 'FORCE_NOT_AVAILABLE' }, { status: 409 });
    if (!canForcePendingAction(pending, nowMs)) {
      return json({ error: '倒计时未结束，暂不可强制', code: 'FORCE_TOO_EARLY', pending }, { status: 409 });
    }

    const confirmedSet = new Set<number>(confirmedUserIds);
    confirmedSet.add(pending.pendingUserId);
    const nextConfirmedUserIds = [...confirmedSet];

    const nextConfirmedAtByUserId: Record<string, string> = { ...(confirmedAtByUserId ?? {}) };
    nextConfirmedAtByUserId[String(pending.pendingUserId)] = nowIso;

    (internal.raw as any)._postRound = {
      ...postRoundRaw,
      confirmedUserIds: nextConfirmedUserIds,
      confirmedAtByUserId: nextConfirmedAtByUserId,
      confirmedBotIds: internal.bots.map((b) => b.id),
      updatedAt: nowIso,
    };

    const ok = await updatePvpRoomCas(roomId, expectedVersion, {
      rules_json: stringifyPvpRoomInternalState(internal),
      last_activity_at: nowIso,
    });
    if (!ok) return json({ error: '强制确认失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

    return json({ success: true, forced: 'confirm', targetUserId: pending.pendingUserId, nextVersion: expectedVersion + 1 });
  }

  return json({ error: '未知 kind' }, { status: 400 });
}

export default withPvpErrorBoundary(forceHandler);
