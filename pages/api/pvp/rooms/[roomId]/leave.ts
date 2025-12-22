import { getPvpRoomById, getPvpRoomPlayers, removePvpRoomPlayer, updatePvpMatch, updatePvpRoomCas } from '@/lib/d1';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

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

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const players = await getPvpRoomPlayers(roomId);
  if (!players.some((p) => p.user_id === auth.user.id)) {
    return json({ error: '你不在该房间中' }, { status: 403 });
  }

  await removePvpRoomPlayer(roomId, auth.user.id);
  const remaining = (await getPvpRoomPlayers(roomId)).filter((p) => p.user_id !== auth.user.id);

  const now = new Date().toISOString();
  const isHostLeaving = room.host_user_id === auth.user.id;
  const isInMatch = room.phase === 'choosing' || room.phase === 'reviewing' || room.phase === 'advancing' || room.phase === 'resolving';

  const patch =
    isHostLeaving
      ? { status: 'closed' as const, phase: 'closed' as const }
      : isInMatch
        ? { status: 'closed' as const, phase: 'aborted' as const }
        : remaining.length <= 0
          ? { status: 'closed' as const, phase: 'closed' as const }
          : { phase: 'waiting' as const };

  const ok = await updatePvpRoomCas(roomId, expectedVersion, { ...patch, last_activity_at: now });
  if (!ok) return json({ error: '离开房间时状态更新失败', code: 'UPDATE_FAILED' }, { status: 409 });

  if (room.current_match_id && (isInMatch || room.phase === 'dealing')) {
    await updatePvpMatch(room.current_match_id, {
      status: 'aborted',
      endedAt: now,
      winnerUserId: null,
      resultJson: JSON.stringify({
        reason: 'player-left',
        leavingUserId: auth.user.id,
        isHostLeaving,
      }),
    });
  }

  return json({ success: true });
}

export default withPvpErrorBoundary(leaveHandler);
