import {
  clearPvpRoomRuntimeState,
  getPvpRoomById,
  getPvpRoomPlayers,
  getPvpRoomSubmissions,
  updatePvpRoomCas,
} from '@/lib/d1';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import { parsePvpRules } from '@/lib/pvp/validate';

export const runtime = 'edge';

type RulesBody = { expectedVersion?: number; rules?: unknown; clearSubmissions?: boolean };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object');

async function rulesHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<RulesBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可操作' }, { status: 403 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'waiting' && room.phase !== 'submitting') {
    return json({ error: '当前阶段不允许修改规则', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const internal = internalParsed.internal;

  const patchRules = isObject(body.data.rules) ? (body.data.rules as Record<string, unknown>) : null;
  if (!patchRules) return json({ error: '缺少 rules' }, { status: 400 });

  const merged = { ...(internal.raw || {}), ...patchRules };
  const parsed = parsePvpRules(merged);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 400 });
  const nextRules = parsed.rules;

  const players = await getPvpRoomPlayers(roomId);
  const participantCount = players.length + internal.bots.length;
  if (participantCount > nextRules.participants) {
    return json({ error: '当前房间人数已超过新规则人数，请先踢出/移除机器人', code: 'PARTICIPANTS_TOO_MANY' }, { status: 409 });
  }
  if (players.some((p) => typeof p.seat === 'number' && p.seat >= nextRules.participants)) {
    return json({ error: '已有玩家座位超出新规则人数范围，请先踢出对应玩家', code: 'SEAT_OUT_OF_RANGE' }, { status: 409 });
  }
  if (internal.bots.some((b) => b.seat >= nextRules.participants)) {
    return json({ error: '已有机器人座位超出新规则人数范围，请先移除对应机器人', code: 'SEAT_OUT_OF_RANGE' }, { status: 409 });
  }

  const before = internal.rules;
  const changedCardsPerPlayer = before.cardsPerPlayer !== nextRules.cardsPerPlayer;

  const shouldClear = Boolean(body.data.clearSubmissions);
  if (room.phase === 'submitting' && changedCardsPerPlayer) {
    const subs = await getPvpRoomSubmissions(roomId);
    if (subs.length > 0 && !shouldClear) {
      return json({ error: '修改每人提交数量会清空已提交卡组，请确认后再保存', code: 'NEED_CLEAR_SUBMISSIONS' }, { status: 409 });
    }
    if (subs.length > 0 && shouldClear) {
      const cleared = await clearPvpRoomRuntimeState(roomId);
      if (!cleared) return json({ error: '清理已提交卡组失败，请稍后重试', code: 'CLEAR_FAILED' }, { status: 500 });
    }
  }

  internal.rules = { ...nextRules };
  const nextPhase = participantCount >= nextRules.participants ? 'submitting' : 'waiting';

  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    phase: nextPhase,
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: new Date().toISOString(),
  });

  if (!ok) return json({ error: '更新失败', code: 'UPDATE_FAILED' }, { status: 409 });
  return json({ success: true, phase: nextPhase, rules: nextRules, cleared: shouldClear && changedCardsPerPlayer });
}

export default withPvpErrorBoundary(rulesHandler);

