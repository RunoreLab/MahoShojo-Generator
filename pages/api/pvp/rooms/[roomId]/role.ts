import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import {
  deletePvpRoomHand,
  deletePvpRoomSubmission,
  getPvpRoomById,
  getPvpRoomMembers,
  getPvpRoomPlayers,
  updatePvpRoomCas,
  updatePvpRoomMember,
} from '@/lib/database/pvp';
import { parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { requiresPvpSubmissionPhase } from '@/lib/pvp/logic';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

type RoleBody = { expectedVersion?: number; role?: 'player' | 'spectator' };

const pickSeat = (existingSeats: Array<number | null>, maxPlayers: number): number | null => {
  const used = new Set(existingSeats.filter((s): s is number => typeof s === 'number'));
  for (let i = 0; i < maxPlayers; i++) {
    if (!used.has(i)) return i;
  }
  return null;
};

async function roleHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<RoleBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.status !== 'open' || room.phase === 'closed') return json({ error: '房间已关闭' }, { status: 410 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const desiredRole = (body.data.role === 'player' || body.data.role === 'spectator') ? body.data.role : null;
  if (!desiredRole) return json({ error: '缺少 role（player/spectator）' }, { status: 400 });

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const rules = internalParsed.internal.rules;
  const bots = internalParsed.internal.bots;

  const members = await getPvpRoomMembers(roomId);
  const me = members.find((m) => m.user_id === auth.user.id) ?? null;
  if (!me) return json({ error: '你不在该房间中' }, { status: 403 });

  const currentRole = me.role === 'spectator' ? 'spectator' : 'player';
  if (currentRole === desiredRole) return json({ success: true, role: currentRole, unchanged: true });

  const canSwitchPhase = room.phase === 'waiting' || room.phase === 'submitting';
  if (!canSwitchPhase) return json({ error: '当前阶段不允许切换身份', code: 'PHASE_FORBIDDEN' }, { status: 409 });

  const now = new Date().toISOString();

  if (desiredRole === 'spectator') {
    if (auth.user.id === room.host_user_id) return json({ error: '房主不可转为观众', code: 'HOST_FORBIDDEN' }, { status: 403 });
    if (rules.allowSpectators === false) return json({ error: '房间已关闭观战', code: 'SPECTATORS_DISABLED' }, { status: 409 });

    const updated = await updatePvpRoomMember({ roomId, userId: auth.user.id, role: 'spectator', seat: null });
    if (!updated) return json({ error: '切换失败：未找到成员记录', code: 'MEMBER_NOT_FOUND' }, { status: 404 });

    await deletePvpRoomSubmission(roomId, auth.user.id);
    await deletePvpRoomHand(roomId, auth.user.id);

    const currentPlayers = await getPvpRoomPlayers(roomId);
    const shouldRollbackToWaiting =
      room.phase === 'submitting' &&
      requiresPvpSubmissionPhase(rules) &&
      (currentPlayers.length + bots.length) < rules.participants;

    const casOk = await updatePvpRoomCas(roomId, expectedVersion, {
      ...(shouldRollbackToWaiting ? { phase: 'waiting' } : {}),
      last_activity_at: now,
    });
    if (!casOk) return json({ error: '切换失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

    return json({ success: true, role: 'spectator' });
  }

  // desiredRole === 'player'
  const players = await getPvpRoomPlayers(roomId);
  if (players.length + bots.length >= rules.participants) return json({ error: '房间已满，无法成为玩家', code: 'ROOM_FULL' }, { status: 409 });

  const seat = pickSeat([...players.map((p) => p.seat), ...bots.map((b) => b.seat)], rules.participants);
  if (seat === null) return json({ error: '房间座位已满', code: 'SEAT_FULL' }, { status: 409 });

  const updated = await updatePvpRoomMember({ roomId, userId: auth.user.id, role: 'player', seat });
  if (!updated) return json({ error: '切换失败：未找到成员记录', code: 'MEMBER_NOT_FOUND' }, { status: 404 });

  const shouldAdvance =
    room.phase === 'waiting' &&
    requiresPvpSubmissionPhase(rules) &&
    (players.length + 1 + bots.length) >= rules.participants;

  const casOk = await updatePvpRoomCas(roomId, expectedVersion, {
    ...(shouldAdvance ? { phase: 'submitting' } : {}),
    last_activity_at: now,
  });
  if (!casOk) return json({ error: '切换失败（版本冲突），请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  return json({ success: true, role: 'player', seat });
}

export default withPagesApiResponse(withPvpErrorBoundary(roleHandler));

