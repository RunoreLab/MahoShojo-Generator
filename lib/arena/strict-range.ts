import { computeArenaBaseTier, type ArenaBaseTier } from '@/lib/arena/tier';

export type StrictRangeRating = { rating: number; games: number };

export const isArenaTierAtLeastFlower = (tier: ArenaBaseTier): boolean => tier === '花牌' || tier === '权杖';

export const shouldEnforceStrictRangeLimit = (a: StrictRangeRating, b: StrictRangeRating): boolean => {
  const aTier = computeArenaBaseTier(a.rating, a.games);
  const bTier = computeArenaBaseTier(b.rating, b.games);
  return isArenaTierAtLeastFlower(aTier) || isArenaTierAtLeastFlower(bTier);
};

