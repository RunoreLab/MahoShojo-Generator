import { addPvpRoomPlayer, createPvpRoom, getPvpRoomBrowseRows, getPvpRoomPlayers, updatePvpRoomCas } from '@/lib/d1';
import { parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { PVP_ROOM_TTL_MS } from '@/lib/pvp/constants';
import { DEFAULT_PVP_RULES } from '@/lib/pvp/defaults';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

const pickSeat = (existingSeats: Array<number | null>, maxPlayers: number): number | null => {
  const used = new Set(existingSeats.filter((s): s is number => typeof s === 'number'));
  for (let i = 0; i < maxPlayers; i++) {
    if (!used.has(i)) return i;
  }
  return null;
};

async function quickMatchHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const candidates = await getPvpRoomBrowseRows({
    password: 'no',
    phase: 'any',
    limit: 120,
    offset: 0,
  });

  for (const room of candidates) {
    if (room.status !== 'open') continue;
    if (room.phase !== 'waiting' && room.phase !== 'submitting') continue;
    if (room.join_code_hash) continue;

    const internalParsed = parsePvpRoomInternalState(room.rules_json);
    if ('error' in internalParsed) continue;
    const rules = internalParsed.internal.rules;
    const bots = internalParsed.internal.bots;

    if (rules.mode !== 'classic') continue;
    if (rules.participants !== 2) continue;

    const maxPlayers = 2;
    const humans = Number.isFinite(room.player_count) ? Math.max(0, Math.floor(room.player_count)) : 0;
    if (humans + bots.length >= maxPlayers) continue;

    const players = await getPvpRoomPlayers(room.id);
    const alreadyJoined = players.some((p) => p.user_id === auth.user.id);
    if (alreadyJoined) {
      return json({ success: true, roomId: room.id, joinedExisting: true, created: false, alreadyJoined: true });
    }

    const seat = pickSeat([...players.map((p) => p.seat), ...bots.map((b) => b.seat)], maxPlayers);
    const ok = await addPvpRoomPlayer(room.id, auth.user.id, seat);
    if (!ok) continue;

    const now = new Date().toISOString();
    const nextPlayers = await getPvpRoomPlayers(room.id);
    const shouldAdvance = room.phase === 'waiting' && (nextPlayers.length + bots.length) >= maxPlayers;
    await updatePvpRoomCas(room.id, room.version, {
      ...(shouldAdvance ? { phase: 'submitting' } : {}),
      last_activity_at: now,
    });

    return json({ success: true, roomId: room.id, joinedExisting: true, created: false, alreadyJoined: false });
  }

  const expiresAt = new Date(Date.now() + PVP_ROOM_TTL_MS).toISOString();
  const created = await createPvpRoom({
    hostUserId: auth.user.id,
    rulesJson: JSON.stringify(DEFAULT_PVP_RULES),
    joinCodeHash: null,
    joinCodeSalt: null,
    expiresAt,
  });

  if (!created) return json({ error: '快速匹配失败：创建房间失败' }, { status: 500 });
  return json({ success: true, roomId: created.roomId, joinedExisting: false, created: true });
}

export default withPvpErrorBoundary(quickMatchHandler);

