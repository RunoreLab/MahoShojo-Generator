import type { PvpCardRef } from '@/lib/pvp/types';

export type BotStrategyId = 'default_weighted' | 'random' | 'copycat' | 'keyword_boost';

export type RandomFn = () => number;

export type DataCardStats = {
  id: string;
  isPublic: boolean;
  usageCount: number;
  likeCount: number;
  favoriteCount: number;
};

export type BotCandidateCard = {
  snapshotId: string;
  snapshotName: string;
  snapshotDataJson: string;
  ref: PvpCardRef | null;
  dataCardStats?: DataCardStats | null;
  ownerUserId: number;
  ownerIsBot: boolean;
  ownerWinRate?: number | null; // 0-1
};

export type BotStrategy = {
  id: BotStrategyId;
  label: string;
  description: string;
  pickSnapshotId: (cards: BotCandidateCard[], rng: RandomFn) => string | null;
};

