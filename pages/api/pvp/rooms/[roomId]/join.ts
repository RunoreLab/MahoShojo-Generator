import { addPvpRoomPlayer, getPvpRoomById, getPvpRoomMembers, getPvpRoomPlayers, updatePvpRoomCas } from '@/lib/d1';
import { parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { constantTimeEqual, hashJoinCode } from '@/lib/pvp/crypto';
import { requiresPvpSubmissionPhase } from '@/lib/pvp/logic';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

const pickSeat = (existingSeats: Array<number | null>, maxPlayers: number): number | null => {
  const used = new Set(existingSeats.filter((s): s is number => typeof s === 'number'));
  for (let i = 0; i < maxPlayers; i++) {
    if (!used.has(i)) return i;
  }
  return null;
};

async function joinHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<{ expectedVersion?: number; password?: string }>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.status !== 'open' || room.phase === 'closed') return json({ error: '房间已关闭' }, { status: 410 });

  if (room.expires_at) {
    const expired = Date.now() > Date.parse(room.expires_at);
    if (expired) {
      await updatePvpRoomCas(roomId, room.version, { status: 'closed', phase: 'closed' });
      return json({ error: '房间已过期' }, { status: 410 });
    }
  }

  const internalParsed = parsePvpRoomInternalState(room.rules_json);
  if ('error' in internalParsed) return json({ error: internalParsed.error }, { status: 500 });
  const rules = internalParsed.internal.rules;
  const bots = internalParsed.internal.bots;

  const members = await getPvpRoomMembers(roomId);
  const alreadyJoined = members.some((p) => p.user_id === auth.user.id);
  if (alreadyJoined) return json({ success: true, alreadyJoined: true });

  const allowSpectators = rules.allowSpectators !== false;
  const joinAs: 'player' | 'spectator' = allowSpectators ? 'spectator' : 'player';

  // 注意：刷新页面时，已在房间内的成员需要能“重新加入”（幂等）。
  // 因此阶段限制应当只针对新增“玩家”，不应阻止“观众”加入。
  if (joinAs === 'player' && room.phase !== 'waiting' && room.phase !== 'submitting') {
    return json({ error: '房间已进入对局阶段，无法加入' }, { status: 409 });
  }

  const expectedVersion = Number.isFinite(body.data.expectedVersion)
    ? Math.floor(body.data.expectedVersion as number)
    : room.version;
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const players = await getPvpRoomPlayers(roomId);
  if (joinAs === 'player' && players.length + bots.length >= rules.participants) return json({ error: '房间已满' }, { status: 409 });

  if (room.join_code_hash) {
    const password = typeof body.data.password === 'string' ? body.data.password.trim() : '';
    if (!password) return json({ error: '需要房间口令', code: 'PASSWORD_REQUIRED' }, { status: 401 });
    const salt = room.join_code_salt || '';
    const computed = await hashJoinCode(password, salt);
    if (!constantTimeEqual(computed, room.join_code_hash)) {
      return json({ error: '口令错误', code: 'PASSWORD_INVALID' }, { status: 403 });
    }
  }

  const seat = joinAs === 'player'
    ? pickSeat([...players.map((p) => p.seat), ...bots.map((b) => b.seat)], rules.participants)
    : null;
  const ok = await addPvpRoomPlayer(roomId, auth.user.id, seat, joinAs);
  if (!ok) return json({ error: '加入房间失败' }, { status: 500 });

  const now = new Date().toISOString();
  const nextPlayers = joinAs === 'player' ? await getPvpRoomPlayers(roomId) : players;
  const shouldAdvance =
    joinAs === 'player' &&
    room.phase === 'waiting' &&
    requiresPvpSubmissionPhase(rules) &&
    (nextPlayers.length + bots.length) >= rules.participants;
  const casOk = await updatePvpRoomCas(roomId, expectedVersion, {
    ...(shouldAdvance ? { phase: 'submitting' } : {}),
    last_activity_at: now,
  });

  return json({ success: true, role: joinAs, advanced: shouldAdvance, casOk });
}

export default withPvpErrorBoundary(joinHandler);
