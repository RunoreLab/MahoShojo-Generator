import { addPvpRoomPlayer, getPvpRoomById, getPvpRoomPlayers, updatePvpRoomCas } from '@/lib/d1';
import { constantTimeEqual, hashJoinCode } from '@/lib/pvp/crypto';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpRoomRules } from '@/lib/pvp/types';

export const runtime = 'edge';

const parseRules = (rulesJson: string): PvpRoomRules | null => {
  try {
    return JSON.parse(rulesJson) as PvpRoomRules;
  } catch {
    return null;
  }
};

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
  if (room.phase !== 'waiting' && room.phase !== 'submitting') {
    return json({ error: '房间已进入对局阶段，无法加入' }, { status: 409 });
  }

  if (room.expires_at) {
    const expired = Date.now() > Date.parse(room.expires_at);
    if (expired) {
      await updatePvpRoomCas(roomId, room.version, { status: 'closed', phase: 'closed' });
      return json({ error: '房间已过期' }, { status: 410 });
    }
  }

  const expectedVersion = Number.isFinite(body.data.expectedVersion)
    ? Math.floor(body.data.expectedVersion as number)
    : room.version;
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const rules = parseRules(room.rules_json);
  if (!rules) return json({ error: '房间规则损坏' }, { status: 500 });

  const players = await getPvpRoomPlayers(roomId);
  const alreadyJoined = players.some((p) => p.user_id === auth.user.id);
  if (alreadyJoined) return json({ success: true, alreadyJoined: true });

  if (players.length >= rules.participants) return json({ error: '房间已满' }, { status: 409 });

  if (room.join_code_hash) {
    const password = typeof body.data.password === 'string' ? body.data.password.trim() : '';
    if (!password) return json({ error: '需要房间口令', code: 'PASSWORD_REQUIRED' }, { status: 401 });
    const salt = room.join_code_salt || '';
    const computed = await hashJoinCode(password, salt);
    if (!constantTimeEqual(computed, room.join_code_hash)) {
      return json({ error: '口令错误', code: 'PASSWORD_INVALID' }, { status: 403 });
    }
  }

  const seat = pickSeat(players.map((p) => p.seat), rules.participants);
  const ok = await addPvpRoomPlayer(roomId, auth.user.id, seat);
  if (!ok) return json({ error: '加入房间失败' }, { status: 500 });

  const now = new Date().toISOString();
  const nextPlayers = await getPvpRoomPlayers(roomId);
  const shouldAdvance = room.phase === 'waiting' && nextPlayers.length >= rules.participants;
  const casOk = await updatePvpRoomCas(roomId, expectedVersion, {
    ...(shouldAdvance ? { phase: 'submitting' } : {}),
    last_activity_at: now,
  });

  return json({ success: true, advanced: shouldAdvance, casOk });
}

export default withPvpErrorBoundary(joinHandler);
