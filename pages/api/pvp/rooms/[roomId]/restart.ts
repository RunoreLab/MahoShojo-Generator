import { clearPvpRoomRuntimeState, getPvpRoomById, getPvpRoomPlayers, updatePvpRoomCas } from '@/lib/d1';
import { clearBotsFromRulesJson, parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type RestartBody = { expectedVersion?: number };

async function restartHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<RestartBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可重开' }, { status: 403 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase === 'choosing' || room.phase === 'resolving' || room.phase === 'dealing') {
    return json({ error: '对局进行中，不能重开（请先结束/离开）', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
  const rules = parsed.internal.rules;

  const players = await getPvpRoomPlayers(roomId);
  if (players.length <= 0) return json({ error: '房间玩家异常' }, { status: 500 });

  const cleared = await clearPvpRoomRuntimeState(roomId);
  if (!cleared) return json({ error: '清理对局数据失败' }, { status: 500 });

  const nextRulesJson = clearBotsFromRulesJson(room.rules_json);
  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    status: 'open',
    phase: players.length >= rules.participants ? 'submitting' : 'waiting',
    current_match_id: null,
    rules_json: nextRulesJson,
    last_activity_at: new Date().toISOString(),
  });

  if (!ok) return json({ error: '重开失败（版本冲突）', code: 'VERSION_CONFLICT' }, { status: 409 });
  return json({ success: true });
}

export default withPvpErrorBoundary(restartHandler);
