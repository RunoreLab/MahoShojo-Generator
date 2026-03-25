import { describe, expect, it, mock } from 'bun:test';
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

mock.module('next/head', () => ({
  default: function HeadMock({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
}));

mock.module('next/link', () => ({
  default: function LinkMock({
    children,
    href,
    ...props
  }: {
    children?: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

const buildItem = (overrides?: Partial<Record<string, unknown>>) => {
  return {
    rank: 1,
    entityType: 'data_card',
    entityId: 'card-1',
    displayName: '测试角色',
    authorName: '作者',
    rating: 1520,
    games: 30,
    wins: 18,
    losses: 11,
    draws: 1,
    tier: '权杖',
    techScore: null,
    techLevel: null,
    isNative: null,
    tagIds: [],
    ratingUpdatedAt: null,
    seasonPeak: null,
    seasonPeakTier: null,
    seasonLow: null,
    ...overrides,
  };
};

let mockedLeaderboardItems: unknown[] = [buildItem()];

mock.module('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey?.[0];
    if (key === 'arenaLeaderboard') {
      return {
        data: { success: true, items: mockedLeaderboardItems },
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: async () => ({ data: null }),
      };
    }
    return {
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: async () => ({ data: null }),
    };
  },
}));

const { RankingPage } = await import('@/components/ranking/RankingPage');

describe('RankingPage season extrema mount', () => {
  it('strict 队列在 season 信息全缺失时不挂载外层容器', () => {
    mockedLeaderboardItems = [buildItem()];
    const html = renderToStaticMarkup(<RankingPage />);

    expect(html).not.toContain('data-season-extrema-block="1"');
    expect(html).not.toContain('赛季最高段位');
  });

  it('strict 队列在 season 信息存在时挂载并展示', () => {
    mockedLeaderboardItems = [buildItem({ seasonPeakTier: '女王' })];
    const html = renderToStaticMarkup(<RankingPage />);

    expect(html).toContain('data-season-extrema-block="1"');
    expect(html).toContain('赛季最高段位');
    expect(html).toContain('女王');
  });
});
