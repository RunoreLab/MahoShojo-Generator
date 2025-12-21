import { getPvpRoomById, getPvpRoomPlayers, removePvpRoomPlayer, updatePvpMatch, updatePvpRoomCas } from '@/lib/d1';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type KickBody = { expectedVersion?: number; userId?: number };

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
  if (targetId === auth.user.id) return json({ error: '不能踢自己' }, { status: 400 });

  const players = await getPvpRoomPlayers(roomId);
  if (!players.some((p) => p.user_id === targetId)) return json({ error: '该用户不在房间中' }, { status: 404 });

  await removePvpRoomPlayer(roomId, targetId);
  const now = new Date().toISOString();

  const isInMatch = room.phase === 'choosing' || room.phase === 'resolving' || room.phase === 'dealing';
  const patch = isInMatch
    ? { status: 'closed' as const, phase: 'aborted' as const }
    : { phase: 'waiting' as const };

  const ok = await updatePvpRoomCas(roomId, expectedVersion, { ...patch, last_activity_at: now });
  if (!ok) return json({ error: '踢人成功，但状态更新失败，请刷新', code: 'UPDATE_FAILED' }, { status: 409 });

  if (room.current_match_id && isInMatch) {
    await updatePvpMatch(room.current_match_id, {
      status: 'aborted',
      endedAt: now,
      winnerUserId: null,
      resultJson: JSON.stringify({
        reason: 'kicked',
        kickedUserId: targetId,
        byUserId: auth.user.id,
      }),
    });
  }

  return json({ success: true });
}

export default withPvpErrorBoundary(kickHandler);
