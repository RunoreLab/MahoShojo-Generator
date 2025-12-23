import { getPvpRoomById, updatePvpRoomCas } from '@/lib/d1';
import { parsePvpRoomInternalState, stringifyPvpRoomInternalState } from '@/lib/pvp/bot/room';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type PermissionsBody = {
  expectedVersion?: number;
  allowNonHostControl?: boolean;
  allowSpectators?: boolean;
  allowSpectatorChat?: boolean;
};

async function permissionsHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<PermissionsBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.host_user_id !== auth.user.id) return json({ error: '仅房主可操作' }, { status: 403 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'waiting' && room.phase !== 'submitting' && room.phase !== 'choosing') {
    return json({ error: '当前阶段不允许修改设置', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const parsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
  const internal = parsed.internal;

  const allowNonHostControl = typeof (body.data as PermissionsBody).allowNonHostControl === 'boolean'
    ? (body.data as PermissionsBody).allowNonHostControl
    : internal.rules.allowNonHostControl;
  const allowSpectators = typeof (body.data as PermissionsBody).allowSpectators === 'boolean'
    ? (body.data as PermissionsBody).allowSpectators
    : internal.rules.allowSpectators;
  const allowSpectatorChat = typeof (body.data as PermissionsBody).allowSpectatorChat === 'boolean'
    ? (body.data as PermissionsBody).allowSpectatorChat
    : internal.rules.allowSpectatorChat;

  internal.rules = {
    ...internal.rules,
    allowNonHostControl,
    allowSpectators,
    allowSpectatorChat: allowSpectators ? allowSpectatorChat : false,
  };

  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    rules_json: stringifyPvpRoomInternalState(internal),
    last_activity_at: new Date().toISOString(),
  });

  if (!ok) return json({ error: '更新失败', code: 'UPDATE_FAILED' }, { status: 409 });
  return json({ success: true, allowNonHostControl, allowSpectators, allowSpectatorChat: internal.rules.allowSpectatorChat === true });
}

export default withPvpErrorBoundary(permissionsHandler);
