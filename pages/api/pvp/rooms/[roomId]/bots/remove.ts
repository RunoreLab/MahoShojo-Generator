import { getPvpRoomById, getPvpRoomPlayers, updatePvpRoomCas } from '@/lib/database/pvp';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { requiresPvpSubmissionPhase } from '@/lib/pvp/logic';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

type RemoveBotBody = { expectedVersion?: number; botId?: string };

async function removeBotHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<RemoveBotBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可移除机器人', code: 'HOST_ONLY' }, { status: 403 });
  if (room.status !== 'open' || room.phase === 'closed') return json({ error: '房间已关闭' }, { status: 410 });
  if (room.phase !== 'waiting' && room.phase !== 'submitting') {
    return json({ error: '当前阶段不允许移除机器人', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const botId = typeof body.data.botId === 'string' ? body.data.botId.trim() : '';
  if (!botId) return json({ error: '缺少 botId' }, { status: 400 });

  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
  const internal = parsed.internal;

  const before = internal.bots.length;
  internal.bots = internal.bots.filter((b) => b.id !== botId);
  if (internal.bots.length === before) return json({ error: '机器人不存在', code: 'BOT_NOT_FOUND' }, { status: 404 });

  const players = await getPvpRoomPlayers(roomId);
  const total = players.length + internal.bots.length;
  const nextPhase =
    total >= internal.rules.participants
      ? (requiresPvpSubmissionPhase(internal.rules) ? 'submitting' : 'waiting')
      : 'waiting';

  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    rules_json: stringifyPvpRoomInternalState(internal),
    phase: nextPhase,
    last_activity_at: new Date().toISOString(),
  });

  if (!ok) return json({ error: '移除失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
  return json({ success: true, nextVersion: expectedVersion + 1 });
}

export default withPvpErrorBoundary(removeBotHandler);
