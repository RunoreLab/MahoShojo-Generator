import {
  createPvpRound,
  getPvpCardSnapshotById,
  getPvpRoomById,
  getPvpRoomHands,
  getPvpRoomPlayers,
  getPvpRoundById,
  getPvpRoundChoices,
  getPvpRoundsByRoom,
  updatePvpRoomCas,
  updatePvpRound,
  upsertPvpRoomHand,
} from '@/lib/d1';
import { normalizeWinner } from '@/lib/pvp/logic';
import { getRoomIdFromRequestUrl, getRoundIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser } from '@/lib/pvp/server';
import type { PvpHandState, PvpRoomRules, PvpSnapshotRef } from '@/lib/pvp/types';

export const runtime = 'edge';

type ResolveBody = { expectedVersion?: number };

const parseRules = (rulesJson: string): PvpRoomRules | null => {
  try {
    return JSON.parse(rulesJson) as PvpRoomRules;
  } catch {
    return null;
  }
};

const parseChoice = (raw: string): PvpSnapshotRef | null => {
  try {
    const parsed = JSON.parse(raw) as PvpSnapshotRef;
    if (!parsed || parsed.kind !== 'snapshot' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
};

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards) || !Array.isArray(parsed.discarded)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const moveToDiscard = (hand: PvpHandState, snapshotId: string): PvpHandState => {
  const cards = hand.cards.filter((c) => c.kind === 'snapshot' && c.id !== snapshotId);
  const discarded = [...hand.discarded, { kind: 'snapshot', id: snapshotId } as PvpSnapshotRef];
  return { ...hand, cards, discarded };
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readJson<ResolveBody>(req);
  if ('response' in body) return body.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  const roundId = getRoundIdFromRequestUrl(req.url);
  if (!roomId || !roundId) return json({ error: '缺少参数' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  const expectedVersion = Number.isFinite(body.data.expectedVersion) ? Math.floor(body.data.expectedVersion as number) : null;
  if (expectedVersion === null) return json({ error: '缺少 expectedVersion' }, { status: 400 });
  if (expectedVersion !== room.version) return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });

  if (room.phase !== 'choosing' && room.phase !== 'resolving') {
    return json({ error: '当前阶段不允许结算', code: 'PHASE_FORBIDDEN' }, { status: 409 });
  }

  const rules = parseRules(room.rules_json);
  if (!rules) return json({ error: '房间规则损坏' }, { status: 500 });

  const players = await getPvpRoomPlayers(roomId);
  const sortedPlayers = [...players].sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
  if (!sortedPlayers.some((p) => p.user_id === auth.user.id)) return json({ error: '你不在该房间中' }, { status: 403 });
  if (sortedPlayers.length !== 2) return json({ error: '房间玩家异常' }, { status: 500 });
  const playerA = sortedPlayers[0]!;
  const playerB = sortedPlayers[1]!;

  const round = await getPvpRoundById(roundId);
  if (!round || round.room_id !== roomId) return json({ error: '回合不存在' }, { status: 404 });

  // 幂等：回合已完成则直接返回结果
  if (round.status === 'completed' && round.result_json) {
    return json({ success: true, alreadyResolved: true, result: JSON.parse(round.result_json) });
  }
  if (round.status !== 'pending' && round.status !== 'resolving') {
    return json({ error: '回合不可结算', code: 'ROUND_FORBIDDEN' }, { status: 409 });
  }

  const choices = await getPvpRoundChoices(roundId);
  if (choices.length < 2) return json({ error: '仍有玩家未选择出战卡' }, { status: 409 });

  const choiceA = choices.find((c) => c.user_id === playerA.user_id);
  const choiceB = choices.find((c) => c.user_id === playerB.user_id);
  if (!choiceA || !choiceB) return json({ error: '选择数据不完整' }, { status: 409 });

  const parsedChoiceA = parseChoice(choiceA.choice_ref_json);
  const parsedChoiceB = parseChoice(choiceB.choice_ref_json);
  if (!parsedChoiceA || !parsedChoiceB) return json({ error: '选择数据损坏' }, { status: 500 });

  const snapA = await getPvpCardSnapshotById(parsedChoiceA.id);
  const snapB = await getPvpCardSnapshotById(parsedChoiceB.id);
  if (!snapA || !snapB) return json({ error: '快照不存在，请重试' }, { status: 409 });

  // CAS：进入 resolving（避免重复触发）
  if (room.phase === 'choosing') {
    const ok = await updatePvpRoomCas(roomId, expectedVersion, { phase: 'resolving', last_activity_at: new Date().toISOString() });
    if (!ok) {
      // 竞争下可能被其它请求先推进，读取最新状态后继续（幂等）
      const refreshed = await getPvpRoomById(roomId);
      if (!refreshed) return json({ error: '房间不存在' }, { status: 404 });
      if (refreshed.phase !== 'resolving' && refreshed.phase !== 'finished') {
        return json({ error: '版本冲突，请刷新后重试', code: 'VERSION_CONFLICT' }, { status: 409 });
      }
    }
  }
  const resolvingVersion = room.phase === 'choosing' ? expectedVersion + 1 : expectedVersion;

  await updatePvpRound(roundId, { status: 'resolving' });

  const origin = new URL(req.url).origin;
  const authHeader = req.headers.get('authorization') || '';

  const buildGuidance = (attempt: number) => {
    const base = `【PVP 裁判规则】胜利者必须是“${snapA.name}”或“${snapB.name}”或“平局”，只能写其中一个，不得输出其他名字或多个胜利者。`;
    if (attempt === 0) return base;
    return `${base}\n【纠错】你上一轮输出的胜利者不符合规则，请严格按规则重新输出。`;
  };

  let report: any | null = null;
  let rawWinnerText: string | null = null;
  let attempts = 0;
  let canonical: 'A' | 'B' | 'draw' | 'invalid' = 'invalid';
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    attempts = attempt + 1;
    try {
      const res = await fetch(new URL('/api/generate-battle-story', origin).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({
          combatants: [
            { type: snapA.card_type, data: JSON.parse(snapA.data_json), isNative: false, isPreset: false },
            { type: snapB.card_type, data: JSON.parse(snapB.data_json), isNative: false, isPreset: false },
          ],
          mode: rules.mode,
          language: 'zh-CN',
          userGuidance: buildGuidance(attempt),
          readArenaHistory: false,
          writeArenaHistory: false,
          readCurrentState: false,
          writeCurrentState: false,
          useArenaHistory: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        lastError = text || '战报生成失败';
        continue;
      }

      const data = await res.json();
      report = data?.report ?? null;
      rawWinnerText = report?.officialReport?.winner ?? null;
      const normalized = normalizeWinner(rawWinnerText, snapA.name, snapB.name);
      canonical = normalized;
      if (canonical !== 'invalid') break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : '战报生成失败';
    }
  }

  const finalWinner = canonical === 'invalid' ? 'draw' : canonical;
  const winnerUserId =
    finalWinner === 'A' ? playerA.user_id : finalWinner === 'B' ? playerB.user_id : null;
  const winnerName =
    finalWinner === 'A' ? snapA.name : finalWinner === 'B' ? snapB.name : '平局';

  const resultJson = JSON.stringify({
    winner: finalWinner,
    winnerName,
    rawWinnerText,
    attempts,
    error: canonical === 'invalid' ? (lastError || 'winner 不合法，已判平局') : null,
    combatants: {
      A: { snapshotId: snapA.id, name: snapA.name, type: snapA.card_type },
      B: { snapshotId: snapB.id, name: snapB.name, type: snapB.card_type },
    },
    report,
  });

  await updatePvpRound(roundId, {
    status: 'completed',
    resultJson,
    winnerUserId,
    winnerName,
  });

  // 更新手牌：移除出牌并放入弃牌
  const hands = await getPvpRoomHands(roomId);
  const handRowA = hands.find((h) => h.user_id === playerA.user_id);
  const handRowB = hands.find((h) => h.user_id === playerB.user_id);
  if (handRowA) {
    const parsed = parseHand(handRowA.hand_json);
    if (parsed) {
      await upsertPvpRoomHand(roomId, playerA.user_id, JSON.stringify(moveToDiscard(parsed, snapA.id)));
    }
  }
  if (handRowB) {
    const parsed = parseHand(handRowB.hand_json);
    if (parsed) {
      await upsertPvpRoomHand(roomId, playerB.user_id, JSON.stringify(moveToDiscard(parsed, snapB.id)));
    }
  }

  // 多局制：到达 maxRounds 才结算整场胜负，否则继续下一轮
  if (rules.bestOf.enabled && round.round_index < rules.bestOf.maxRounds) {
    const nextRoundId = await createPvpRound({ roomId, roundIndex: round.round_index + 1, status: 'pending' });
    await updatePvpRoomCas(roomId, resolvingVersion, { phase: 'choosing', last_activity_at: new Date().toISOString() });
    return json({ success: true, roundResolved: true, result: JSON.parse(resultJson), nextRoundId });
  }

  // 若启用 bestOf，计算整场胜负（最多 wins），平局则 draw
  let matchWinnerUserId: number | null = null;
  if (rules.bestOf.enabled) {
    const rounds = await getPvpRoundsByRoom(roomId);
    const aWins = rounds.filter((r) => r.winner_user_id === playerA.user_id).length;
    const bWins = rounds.filter((r) => r.winner_user_id === playerB.user_id).length;
    matchWinnerUserId = aWins === bWins ? null : (aWins > bWins ? playerA.user_id : playerB.user_id);
  }

  await updatePvpRoomCas(roomId, resolvingVersion, { phase: 'finished', last_activity_at: new Date().toISOString() });

  return json({ success: true, roundResolved: true, result: JSON.parse(resultJson), matchWinnerUserId });
}
