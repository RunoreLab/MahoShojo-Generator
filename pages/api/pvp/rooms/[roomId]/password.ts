import { getPvpRoomById, updatePvpRoomCas } from '@/lib/database/pvp';
import { generateSaltHex, hashJoinCode } from '@/lib/pvp/crypto';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

async function passwordHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<{ expectedVersion?: number; password?: string | null }>(req);
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
    return json({ error: '当前阶段不允许修改口令', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const password = typeof body.data.password === 'string' ? body.data.password.trim() : '';
  const joinCodeSalt = password ? generateSaltHex() : null;
  const joinCodeHash = password && joinCodeSalt ? await hashJoinCode(password, joinCodeSalt) : null;

  const ok = await updatePvpRoomCas(roomId, expectedVersion, {
    join_code_hash: joinCodeHash,
    join_code_salt: joinCodeSalt,
    last_activity_at: new Date().toISOString(),
  });

  if (!ok) return json({ error: '更新失败', code: 'UPDATE_FAILED' }, { status: 409 });
  return json({ success: true, enabled: Boolean(joinCodeHash) });
}

export default withPvpErrorBoundary(passwordHandler);
