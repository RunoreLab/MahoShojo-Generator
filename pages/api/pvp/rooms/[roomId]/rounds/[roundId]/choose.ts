import { getPvpRoundById, getPvpRoomById, getPvpRoomHands, getPvpRoomPlayers, getPvpRoundChoices, upsertPvpRoundChoice } from '@/lib/d1';
import { getRequestOrigin } from '@/lib/pvp/origin';
import { getRoomIdFromRequestUrl, getRoundIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { PvpHandState, PvpSnapshotRef } from '@/lib/pvp/types';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';

export const runtime = 'edge';

type ChooseBody = {
  expectedVersion?: number;
  snapshotId?: string;
};

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

async function chooseHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<ChooseBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });
  if (room.phase !== 'choosing') return json({ error: '当前阶段不允许出牌', code: 'PHASE_FORBIDDEN' }, { status: 409 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  const players = await getPvpRoomPlayers(roomId);
  if (!players.some((p) => p.user_id === auth.user.id)) return json({ error: '你不在该房间中' }, { status: 403 });

  const round = await getPvpRoundById(roundId);
  if (!round || round.room_id !== roomId) return json({ error: '回合不存在' }, { status: 404 });
  if (round.status !== 'pending') return json({ error: '回合已结算或不可用', code: 'ROUND_NOT_PENDING' }, { status: 409 });

  const snapshotId = typeof body.data.snapshotId === 'string' ? body.data.snapshotId.trim() : '';
  if (!snapshotId) return json({ error: '缺少 snapshotId' }, { status: 400 });

  const hands = await getPvpRoomHands(roomId);
  const myHandRow = hands.find((h) => h.user_id === auth.user.id);
  if (!myHandRow) return json({ error: '未找到你的手牌，请刷新' }, { status: 409 });
  const hand = parseHand(myHandRow.hand_json);
  if (!hand) return json({ error: '手牌数据损坏，请刷新' }, { status: 500 });

  const hasCard = hand.cards.some((c) => c.kind === 'snapshot' && c.id === snapshotId);
  if (!hasCard) return json({ error: '只能从自己的手牌中选择出战卡', code: 'CARD_NOT_IN_HAND' }, { status: 403 });

  const choice: PvpSnapshotRef = { kind: 'snapshot', id: snapshotId };
  const ok = await upsertPvpRoundChoice(roundId, auth.user.id, JSON.stringify(choice));
  if (!ok) return json({ error: '提交选择失败' }, { status: 500 });

  // 自动结算：全员都已选则直接触发 resolve（幂等，多请求并发也安全）
  try {
    const players = await getPvpRoomPlayers(roomId);
    const choices = await getPvpRoundChoices(roundId);
    if (players.length >= 2 && choices.length >= players.length) {
      const origin = getRequestOrigin(req);
      const subrequestAuthHeaders = buildSubrequestAuthHeaders(req);
      const resolveRes = await fetch(new URL(`/api/pvp/rooms/${roomId}/rounds/${roundId}/resolve`, origin).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(req.headers.get('authorization') ? { Authorization: req.headers.get('authorization') as string } : {}),
          ...subrequestAuthHeaders,
        },
        body: JSON.stringify({ expectedVersion }),
      });
      if (resolveRes.ok) {
        const resolved = await resolveRes.json().catch(() => null);
        return json({ success: true, resolved });
      }
    }
  } catch {
    // 自动结算失败不影响出牌成功，交由房主/玩家手动点结算或等待轮询触发
  }

  return json({ success: true, readyToResolve: true });
}

export default withPvpErrorBoundary(chooseHandler);
