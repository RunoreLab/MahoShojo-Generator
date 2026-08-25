'use client';

import React from 'react';

import { TierBadge } from '@/components/ranking/TierBadge';
import { formatDateTime } from '@/lib/constants';
import type { LeaderboardSeasonExtreme } from '@/lib/ranking/season-extrema';

type Props = {
  seasonPeak: LeaderboardSeasonExtreme | null;
  seasonPeakTier: string | null;
  seasonLow: LeaderboardSeasonExtreme | null;
};

export function LeaderboardSeasonExtrema({ seasonPeak, seasonPeakTier, seasonLow }: Props) {
  if (!seasonPeak && !seasonLow && !seasonPeakTier) return null;

  return (
    <div className="flex flex-col gap-1 text-[11px] text-gray-600">
      {seasonPeak ? (
        <div className="flex flex-wrap items-center gap-1">
          <span>
            赛季最高 {seasonPeak.rating}（
            <TierBadge tier={seasonPeak.tier} className="mx-1 align-middle" />
            ）
          </span>
          <span className="text-[10px] text-gray-400" title={seasonPeak.occurredAt}>
            {formatDateTime(seasonPeak.occurredAt)}
          </span>
        </div>
      ) : null}

      {seasonLow ? (
        <div className="flex flex-wrap items-center gap-1">
          <span>
            赛季最低 {seasonLow.rating}（
            <TierBadge tier={seasonLow.tier} className="mx-1 align-middle" />
            ）
          </span>
          <span className="text-[10px] text-gray-400" title={seasonLow.occurredAt}>
            {formatDateTime(seasonLow.occurredAt)}
          </span>
        </div>
      ) : null}

      {seasonPeakTier ? (
        <div>
          赛季最高段位 <TierBadge tier={seasonPeakTier} className="mx-1 align-middle" />
        </div>
      ) : null}
    </div>
  );
}

