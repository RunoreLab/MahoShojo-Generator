import { getDataCardStatsByIds } from '@/lib/database/data-cards';
import { getPvpUserSummariesByUserIds } from '@/lib/database/pvp';
import type { PvpCardRef } from '@/lib/pvp/types';

import { getBotStrategyById } from './strategies';
import type { BotCandidateCard, DataCardStats, RandomFn } from './types';
import type { PvpRoomBotState } from './room';

type SnapshotRow = {
  id: string;
  name: string;
  data_json: string;
  ref_json: string;
};

type RefMeta = {
  ref: PvpCardRef | null;
  submittedByUserId: number | null;
  submittedByBot: boolean;
  submittedByBotName: string | null;
};

const parseRefMeta = (raw: string): RefMeta => {
  try {
    const parsed = JSON.parse(raw) as any;
    const kind = parsed?.kind;
    const isRef =
      (kind === 'data_card' && typeof parsed?.id === 'string') ||
      (kind === 'preset' && typeof parsed?.filename === 'string') ||
      (kind === 'snapshot' && typeof parsed?.id === 'string');
    const ref = isRef ? (parsed as PvpCardRef) : null;
    const submittedByUserId =
      typeof parsed?.submittedByUserId === 'number' && Number.isFinite(parsed.submittedByUserId)
        ? Math.floor(parsed.submittedByUserId)
        : null;
    const submittedByBot = parsed?.submittedByBot === true;
    const submittedByBotName = typeof parsed?.submittedByBotName === 'string' ? parsed.submittedByBotName : null;
    return { ref, submittedByUserId, submittedByBot, submittedByBotName };
  } catch {
    return { ref: null, submittedByUserId: null, submittedByBot: true, submittedByBotName: null };
  }
};

const computeWinRate = (row: { wins: number; losses: number; draws: number }): number => {
  const wins = row.wins ?? 0;
  const losses = row.losses ?? 0;
  const draws = row.draws ?? 0;
  const total = wins + losses + draws;
  return total > 0 ? wins / total : 0;
};

export async function pickBotChoiceSnapshotId(options: {
  bot: Pick<PvpRoomBotState, 'strategyId'>;
  snapshots: SnapshotRow[];
  rng?: RandomFn;
}): Promise<string | null> {
  const rng = options.rng ?? Math.random;
  const snaps = Array.isArray(options.snapshots) ? options.snapshots : [];
  if (snaps.length <= 0) return null;

  const metas = snaps.map((s) => parseRefMeta(s.ref_json));
  const dataCardIds = metas
    .map((m) => (m.ref?.kind === 'data_card' ? m.ref.id : null))
    .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));

  const statsRows = await getDataCardStatsByIds(dataCardIds);
  const statsById = new Map<string, DataCardStats>();
  for (const r of statsRows) {
    const id = typeof r?.id === 'string' ? r.id : '';
    if (!id) continue;
    statsById.set(id, {
      id,
      isPublic: Number((r as any).is_public) === 1,
      usageCount: Number((r as any).usage_count) || 0,
      likeCount: Number((r as any).like_count) || 0,
      favoriteCount: Number((r as any).favorite_count) || 0,
    });
  }

  const humanOwnerIds = metas
    .map((m) => (m.submittedByBot ? null : m.submittedByUserId))
    .filter((id): id is number => typeof id === 'number' && id > 0);

  const summaries = await getPvpUserSummariesByUserIds(humanOwnerIds);
  const winRateByUserId = new Map<number, number>();
  for (const s of summaries) {
    if (typeof s?.user_id !== 'number') continue;
    winRateByUserId.set(s.user_id, computeWinRate({ wins: s.wins ?? 0, losses: s.losses ?? 0, draws: s.draws ?? 0 }));
  }

  const candidates: BotCandidateCard[] = snaps.map((snap, index) => {
    const meta = metas[index]!;
    const ref = meta.ref;
    const stats = ref?.kind === 'data_card' ? (statsById.get(ref.id) ?? null) : null;
    const ownerUserId = meta.submittedByBot ? 0 : (meta.submittedByUserId ?? 0);
    const ownerIsBot = meta.submittedByBot || ownerUserId <= 0;
    return {
      snapshotId: snap.id,
      snapshotName: snap.name,
      snapshotDataJson: snap.data_json,
      ref,
      dataCardStats: stats,
      ownerUserId,
      ownerIsBot,
      ownerWinRate: ownerIsBot ? null : (winRateByUserId.get(ownerUserId) ?? 0),
    };
  });

  const strategy = getBotStrategyById(options.bot.strategyId);
  return strategy.pickSnapshotId(candidates, rng);
}

