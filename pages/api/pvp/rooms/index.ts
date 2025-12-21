import { createPvpRoom } from '@/lib/d1';
import { PVP_ROOM_TTL_MS } from '@/lib/pvp/constants';
import { generateSaltHex, hashJoinCode } from '@/lib/pvp/crypto';
import { json, readJson, requireAuthUser } from '@/lib/pvp/server';
import { parsePvpRules } from '@/lib/pvp/validate';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<{ rules?: unknown; password?: string }>(req);
  if ('response' in body) return body.response;

  const parsed = parsePvpRules(body.data.rules);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 400 });

  const password = typeof body.data.password === 'string' ? body.data.password.trim() : '';
  const joinCodeSalt = password ? generateSaltHex() : null;
  const joinCodeHash = password && joinCodeSalt ? await hashJoinCode(password, joinCodeSalt) : null;

  const expiresAt = new Date(Date.now() + PVP_ROOM_TTL_MS).toISOString();
  const room = await createPvpRoom({
    hostUserId: auth.user.id,
    rulesJson: JSON.stringify(parsed.rules),
    joinCodeHash,
    joinCodeSalt,
    expiresAt,
  });

  if (!room) return json({ error: '创建房间失败' }, { status: 500 });

  return json({ success: true, roomId: room.roomId });
}

