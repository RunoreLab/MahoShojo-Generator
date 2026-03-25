import { describe, expect, it } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProfileCard, type MeProfileCardPayload } from '@/components/me/ProfileCard';

function buildPayload(): MeProfileCardPayload {
  const payload: MeProfileCardPayload = {
    profile: {
      id: 1001,
      username: '测试用户',
      prefix: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      signature: '签名',
      avatarDataUrl: null,
    },
    badges: {
      equipped: [],
      recent: [],
      all: [],
    },
    topCards: {
      characters: [
        {
          id: 'char-top-1',
          type: 'character',
          name: '角色A',
          description: null,
          isPublic: true,
          reviewStatus: 'approved',
          likeCount: 10,
          favoriteCount: 8,
          usageCount: 30,
          engagementScore: 48,
          metrics: { techScore: 88, techLevel: 'A' },
          ratings: {
            strict: {
              rating: 1500,
              games: 30,
              tier: '权杖',
              publicRank: 12,
              publicTotal: 300,
            },
          },
        },
      ],
      topRatedCharacter: {
        id: 'char-rated-1',
        type: 'character',
        name: '排位角色',
        description: null,
        isPublic: true,
        reviewStatus: 'approved',
        likeCount: 20,
        favoriteCount: 10,
        usageCount: 40,
        engagementScore: 70,
        metrics: { techScore: 92, techLevel: 'S' },
        ratings: {
          strict: {
            rating: 1680,
            games: 42,
            tier: '女王',
            publicRank: 1,
            publicTotal: 300,
            seasonPeak: {
              rating: 1720,
              games: 50,
              tier: '权杖',
              occurredAt: '2026-03-20T10:00:00.000Z',
            },
            seasonPeakTier: '女王',
            seasonLow: {
              rating: 980,
              games: 6,
              tier: '白牌',
              occurredAt: '2026-01-05T10:00:00.000Z',
            },
          },
        },
      },
      scenario: null,
    },
    stats: {
      dataCards: {
        total: 2,
        characters: 2,
        scenarios: 0,
        history: 0,
        publicCards: 2,
        publicFavoriteTotal: 18,
        publicUsageTotal: 70,
        magicalGirl: 1,
        canshou: 1,
        general: 0,
        unknownCharacter: 0,
        likeTotal: 30,
        favoriteTotal: 18,
        usageTotal: 70,
      },
      battleReports7d: {
        total: 0,
        completed: 0,
        aborted: 0,
        failed: 0,
      },
      battleReportsAll: {
        total: 0,
      },
    },
    pvp: {
      summary: {
        completedMatches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        abortedMatches: 0,
        lastPlayedAt: null,
      },
      recentMatches: [],
    },
    recentBattleReports: [],
  };

  return payload;
}

describe('ProfileCard season extrema', () => {
  it('仅在排位最高角色卡区域渲染 strict 赛季极值与最高段位', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          enabled: false,
        },
      },
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProfileCard data={buildPayload()} />
      </QueryClientProvider>,
    );

    expect(html).toContain('赛季最高');
    expect(html).toContain('赛季最低');
    expect(html).toContain('赛季最高段位');
    expect(html).toContain('女王');
    expect((html.match(/赛季最高\s[0-9,]+/g) ?? []).length).toBe(1);
  });
});
