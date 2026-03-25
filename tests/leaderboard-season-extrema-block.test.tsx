import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { formatDateTime } from '@/lib/constants';
import type { LeaderboardSeasonExtreme } from '@/lib/ranking/season-extrema';

import { LeaderboardSeasonExtrema } from '@/components/ranking/LeaderboardSeasonExtrema';

describe('LeaderboardSeasonExtrema', () => {
  it('strict season 信息会渲染最高/最低/最高段位', () => {
    const peak: LeaderboardSeasonExtreme = {
      rating: 1630,
      games: 30,
      occurredAt: '2026-03-21T10:00:00.000Z',
      tier: '权杖',
    };
    const low: LeaderboardSeasonExtreme = {
      rating: 980,
      games: 6,
      occurredAt: '2026-01-20T10:00:00.000Z',
      tier: '白牌',
    };

    const html = renderToStaticMarkup(
      <LeaderboardSeasonExtrema seasonPeak={peak} seasonPeakTier="女王" seasonLow={low} />,
    );

    expect(html).toContain('赛季最高');
    expect(html).toContain('1630');
    expect(html).toContain('权杖');
    expect(html).toContain(formatDateTime(peak.occurredAt));

    expect(html).toContain('赛季最低');
    expect(html).toContain('980');
    expect(html).toContain('白牌');
    expect(html).toContain(formatDateTime(low.occurredAt));

    expect(html).toContain('赛季最高段位');
    expect(html).toContain('女王');
  });

  it('season 信息全缺失时为空渲染', () => {
    const html = renderToStaticMarkup(
      <LeaderboardSeasonExtrema seasonPeak={null} seasonPeakTier={null} seasonLow={null} />,
    );

    expect(html).toBe('');
  });
});

