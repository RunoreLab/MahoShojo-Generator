import React from 'react';
import { describe, expect, vi, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

type MockBetaAccessState = {
  status: 'loading' | 'allowed' | 'blocked' | 'error';
  stats: {
    publicCards: number;
    publicUsageTotal: number;
    publicFavoriteTotal: number;
  } | null;
  error: string | null;
};

const authState = {
  isAuthenticated: true,
  loading: false,
  userBadges: [],
  badgesLoading: false,
};

let betaAccessState: MockBetaAccessState = {
  status: 'blocked',
  stats: null,
  error: null,
};

vi.mock('next/router', () => ({
  default: {
    replace: async () => true,
  },
}));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/beta-access-client', () => ({
  useBetaAccessStatus: () => betaAccessState,
}));

describe('/challenge beta access route', () => {
  test('未通过内测门槛时不渲染挑战页主体', async () => {
    betaAccessState = {
      status: 'blocked',
      stats: null,
      error: null,
    };

    const { default: ChallengePageRoute } = await import('@/pages/challenge');
    const html = renderToStaticMarkup(<ChallengePageRoute />);

    expect(html).toContain('正在核验内测权限');
    expect(html).not.toContain('本轮挑战');
  });

  test('通过内测门槛时渲染挑战页主体', async () => {
    betaAccessState = {
      status: 'allowed',
      stats: {
        publicCards: 0,
        publicUsageTotal: 1000,
        publicFavoriteTotal: 100,
      },
      error: null,
    };

    const { default: ChallengePageRoute } = await import('@/pages/challenge');
    const html = renderToStaticMarkup(<ChallengePageRoute />);

    expect(html).toContain('本轮挑战');
    expect(html).not.toContain('正在核验内测权限');
  });
});
