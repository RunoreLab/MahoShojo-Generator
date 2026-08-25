import type { PvpDrawSource } from '@/lib/pvp/types';

export type PvpFallbackDrawKind = 'preset' | 'public';

export function getPvpFallbackDrawOrder(drawSource: PvpDrawSource, rng: () => number = Math.random): PvpFallbackDrawKind[] {
  if (drawSource === 'preset') return ['preset'];
  if (drawSource === 'public') return ['public'];
  return rng() < 0.5 ? ['preset', 'public'] : ['public', 'preset'];
}

