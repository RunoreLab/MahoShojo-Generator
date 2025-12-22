import {
  getDataCardStatsByIds,
  getPvpCardSnapshotById,
  getPvpRoomBots,
  getPvpRoomHands,
  getPvpRoomPlayers,
  getPvpRoundChoices,
  getPvpUserSummariesByUserIds,
  getUsersBotFlagsByIds,
  upsertPvpRoomBot,
  upsertPvpRoundChoice,
} from '@/lib/d1';
import type { PvpCardRef, PvpHandState, PvpSnapshotRef } from '@/lib/pvp/types';

import { getBotStrategyById, pickBotStrategyId } from './strategies';
import type { BotCandidateCard } from './types';

const parseHand = (raw: string): PvpHandState | null => {
  try {
    const parsed = JSON.parse(raw) as PvpHandState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const parseRef = (raw: string): PvpCardRef | null => {
  try {
    const parsed = JSON.parse(raw) as PvpCardRef;
    if (!parsed || typeof parsed !== 'object') return null;
    if ((parsed as any).kind === 'data_card' && typeof (parsed as any).id === 'string') return parsed;
    if ((parsed as any).kind === 'preset' && typeof (parsed as any).filename === 'string') return parsed;
    if ((parsed as any).kind === 'snapshot' && typeof (parsed as any).id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
};

const computeWinRate = (row: { wins: number; losses: number; draws: number }): number => {
  const wins = row.wins ?? 0;
  const losses = row.losses ?? 0;
  const draws = row.draws ?? 0;
  const total = wins + losses + draws;
  return total > 0 ? wins / total : 0;
};

export async function autoChooseBotsForRound(roomId: string, roundId: string): Promise<{ chosen: number }> {
  const players = await getPvpRoomPlayers(roomId);
  const botPlayers = players.filter((p) => Boolean((p as any).is_bot));
  if (botPlayers.length <= 0) return { chosen: 0 };

  const choices = await getPvpRoundChoices(roundId);
  const chosenByUserId = new Set(choices.map((c) => c.user_id));

  const botsConfig = await getPvpRoomBots(roomId);
  const strategyByBotUserId = new Map<number, string>();
  for (const b of botsConfig) strategyByBotUserId.set(b.user_id, b.strategy_id);

  const hands = await getPvpRoomHands(roomId);

  let chosen = 0;
  for (const bot of botPlayers) {
    const botUserId = bot.user_id;
    if (chosenByUserId.has(botUserId)) continue;

    const handRow = hands.find((h) => h.user_id === botUserId);
    if (!handRow) continue;
    const hand = parseHand(handRow.hand_json);
    if (!hand || hand.cards.length <= 0) continue;

    const snapshotIds = hand.cards
      .map((c) => (c && (c as any).kind === 'snapshot' ? (c as any).id : null))
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));

    const snapshots = [];
    for (const snapshotId of snapshotIds) {
      const snap = await getPvpCardSnapshotById(snapshotId);
      if (snap) snapshots.push(snap);
    }
    if (snapshots.length <= 0) continue;

    const refBySnapshotId = new Map<string, PvpCardRef | null>();
    const dataCardIds: string[] = [];
    const ownerIds: number[] = [];
    for (const snap of snapshots) {
      const ref = snap.ref_json ? parseRef(snap.ref_json) : null;
      refBySnapshotId.set(snap.id, ref);
      if (ref?.kind === 'data_card') dataCardIds.push(ref.id);
      ownerIds.push(snap.owner_user_id);
    }

    const dataCardStatsRows = await getDataCardStatsByIds(dataCardIds);
    const statsByCardId = new Map<string, { isPublic: boolean; usageCount: number; likeCount: number; favoriteCount: number }>();
    for (const row of dataCardStatsRows) {
      const id = typeof row.id === 'string' ? row.id : '';
      if (!id) continue;
      statsByCardId.set(id, {
        isPublic: Number((row as any).is_public) === 1,
        usageCount: Number((row as any).usage_count) || 0,
        likeCount: Number((row as any).like_count) || 0,
        favoriteCount: Number((row as any).favorite_count) || 0,
      });
    }

    const botFlags = await getUsersBotFlagsByIds(ownerIds);
    const ownerIsBotById = new Map<number, boolean>();
    for (const row of botFlags) {
      if (typeof row?.id !== 'number') continue;
      ownerIsBotById.set(row.id, Boolean((row as any).is_bot));
    }

    const humanOwnerIds = ownerIds.filter((id) => !ownerIsBotById.get(id));
    const summaryRows = await getPvpUserSummariesByUserIds(humanOwnerIds);
    const winRateByOwnerId = new Map<number, number>();
    for (const s of summaryRows) {
      if (typeof s?.user_id !== 'number') continue;
      winRateByOwnerId.set(s.user_id, computeWinRate({ wins: s.wins ?? 0, losses: s.losses ?? 0, draws: s.draws ?? 0 }));
    }

    const candidates: BotCandidateCard[] = snapshots.map((snap) => {
      const ref = refBySnapshotId.get(snap.id) ?? null;
      const stats =
        ref?.kind === 'data_card'
          ? (statsByCardId.get(ref.id)
              ? {
                  id: ref.id,
                  isPublic: statsByCardId.get(ref.id)!.isPublic,
                  usageCount: statsByCardId.get(ref.id)!.usageCount,
                  likeCount: statsByCardId.get(ref.id)!.likeCount,
                  favoriteCount: statsByCardId.get(ref.id)!.favoriteCount,
                }
              : null)
          : null;
      const ownerUserId = snap.owner_user_id;
      const ownerIsBot = ownerIsBotById.get(ownerUserId) ?? false;
      return {
        snapshotId: snap.id,
        snapshotName: snap.name,
        snapshotDataJson: snap.data_json,
        ref,
        dataCardStats: stats,
        ownerUserId,
        ownerIsBot,
        ownerWinRate: winRateByOwnerId.get(ownerUserId) ?? null,
      };
    });

    let strategyId = strategyByBotUserId.get(botUserId) ?? null;
    if (!strategyId) {
      strategyId = pickBotStrategyId(Math.random);
      await upsertPvpRoomBot(roomId, botUserId, strategyId);
    }

    const strategy = getBotStrategyById(strategyId);
    const pickedSnapshotId = strategy.pickSnapshotId(candidates, Math.random) ?? candidates[0]?.snapshotId ?? null;
    if (!pickedSnapshotId) continue;

    const choice: PvpSnapshotRef = { kind: 'snapshot', id: pickedSnapshotId };
    const ok = await upsertPvpRoundChoice(roundId, botUserId, JSON.stringify(choice));
    if (ok) chosen += 1;
  }

  return { chosen };
}
