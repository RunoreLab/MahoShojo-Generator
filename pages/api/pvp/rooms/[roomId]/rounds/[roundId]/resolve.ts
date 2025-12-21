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
import { normalizeWinnerFromCandidates } from '@/lib/pvp/logic';
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
  if (sortedPlayers.length !== rules.participants) return json({ error: '房间玩家数量与规则不一致' }, { status: 500 });
  if (sortedPlayers.some((p) => typeof p.seat !== 'number')) return json({ error: '房间座位异常' }, { status: 500 });

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
  if (choices.length < rules.participants) return json({ error: '仍有玩家未选择出战卡' }, { status: 409 });

  const choiceByUserId = new Map<number, PvpSnapshotRef>();
  for (const row of choices) {
    const parsed = parseChoice(row.choice_ref_json);
    if (!parsed) return json({ error: '选择数据损坏' }, { status: 500 });
    choiceByUserId.set(row.user_id, parsed);
  }

  const missing = sortedPlayers.filter((p) => !choiceByUserId.has(p.user_id));
  if (missing.length > 0) return json({ error: '仍有玩家未选择出战卡' }, { status: 409 });

  const picked = [];
  for (let i = 0; i < sortedPlayers.length; i++) {
    const player = sortedPlayers[i]!;
    const choice = choiceByUserId.get(player.user_id)!;
    const snap = await getPvpCardSnapshotById(choice.id);
    if (!snap) return json({ error: '快照不存在，请重试' }, { status: 409 });
    picked.push({
      userId: player.user_id,
      seat: player.seat,
      username: player.username ?? null,
      prefix: player.prefix ?? null,
      token: `P${i + 1}`,
      snapshot: snap,
    });
  }

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

  const candidateTokens = picked.map((p) => p.token);
  const candidateNames = picked.map((p) => p.snapshot.name);

  const buildGuidance = (attempt: number) => {
    const mapping = picked.map((p) => `- ${p.token}：${p.snapshot.name}`).join('\n');
    const tokenList = candidateTokens.map((t) => `“${t}”`).join('、');
    const base = [
      '【PVP 裁判规则】',
      `本轮参战者：\n${mapping}`,
      `你必须在 officialReport.winner 字段只输出以下之一：${tokenList} 或 “平局”。`,
      '输出必须完全一致（不要加任何解释、标点或额外文字）。',
      '战报正文中请继续使用角色名叙述，不要在正文中使用 P1/P2…代号。',
    ].join('\n');
    if (attempt === 0) return base;
    return `${base}\n【纠错】你上一轮的 officialReport.winner 不符合规则，请严格按规则输出。`;
  };

  let report: any | null = null;
  let rawWinnerText: string | null = null;
  let attempts = 0;
  let winnerIndex: number | null = null;
  let isDraw = false;
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
          combatants: picked.map((p) => ({
            type: p.snapshot.card_type,
            data: JSON.parse(p.snapshot.data_json),
            isNative: false,
            isPreset: false,
          })),
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
      const byToken = normalizeWinnerFromCandidates(rawWinnerText, candidateTokens);
      if (byToken.kind === 'draw') {
        isDraw = true;
        winnerIndex = null;
        break;
      }
      if (byToken.kind === 'index') {
        isDraw = false;
        winnerIndex = byToken.index;
        break;
      }

      const byName = normalizeWinnerFromCandidates(rawWinnerText, candidateNames);
      if (byName.kind === 'draw') {
        isDraw = true;
        winnerIndex = null;
        break;
      }
      if (byName.kind === 'index') {
        const name = candidateNames[byName.index]!;
        const occurrences = candidateNames.filter((n) => n === name).length;
        if (occurrences === 1) {
          isDraw = false;
          winnerIndex = byName.index;
          break;
        }
      }

      lastError = 'winner 不合法，请重试';
    } catch (error) {
      lastError = error instanceof Error ? error.message : '战报生成失败';
    }
  }

  const resolvedWinnerUserId = isDraw || winnerIndex === null ? null : picked[winnerIndex]!.userId;
  const resolvedWinnerName = isDraw || winnerIndex === null ? '平局' : picked[winnerIndex]!.snapshot.name;

  if (report?.officialReport) {
    report.officialReport.winner = resolvedWinnerName;
  }

  const resultJson = JSON.stringify({
    winnerUserId: resolvedWinnerUserId,
    winnerName: resolvedWinnerName,
    rawWinnerText,
    attempts,
    error: winnerIndex === null && !isDraw ? (lastError || 'winner 不合法，已判平局') : null,
    combatants: picked.map((p) => ({
      token: p.token,
      userId: p.userId,
      seat: p.seat,
      snapshotId: p.snapshot.id,
      name: p.snapshot.name,
      type: p.snapshot.card_type,
    })),
    report,
  });

  await updatePvpRound(roundId, {
    status: 'completed',
    resultJson,
    winnerUserId: resolvedWinnerUserId,
    winnerName: resolvedWinnerName,
  });

  // 更新手牌：移除出牌并放入弃牌
  const hands = await getPvpRoomHands(roomId);
  for (const p of picked) {
    const handRow = hands.find((h) => h.user_id === p.userId);
    if (!handRow) continue;
    const parsed = parseHand(handRow.hand_json);
    if (!parsed) continue;
    await upsertPvpRoomHand(roomId, p.userId, JSON.stringify(moveToDiscard(parsed, p.snapshot.id)));
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
    const winCounts = new Map<number, number>();
    for (const p of sortedPlayers) winCounts.set(p.user_id, 0);
    for (const r of rounds) {
      if (!r.winner_user_id) continue;
      if (!winCounts.has(r.winner_user_id)) continue;
      winCounts.set(r.winner_user_id, (winCounts.get(r.winner_user_id) || 0) + 1);
    }

    let maxWins = 0;
    for (const wins of winCounts.values()) maxWins = Math.max(maxWins, wins);
    const top = [...winCounts.entries()].filter(([, wins]) => wins === maxWins).map(([userId]) => userId);
    matchWinnerUserId = top.length === 1 ? top[0]! : null;
  }

  await updatePvpRoomCas(roomId, resolvingVersion, { phase: 'finished', last_activity_at: new Date().toISOString() });

  return json({ success: true, roundResolved: true, result: JSON.parse(resultJson), matchWinnerUserId });
}
