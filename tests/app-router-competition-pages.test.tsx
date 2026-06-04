import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams() {
    return { roomId: 'room-7' };
  },
  useRouter() {
    return {
      push: vi.fn(),
      replace: vi.fn(),
    };
  },
}));

vi.mock('@tanstack/react-query', () => ({
  QueryClient: class QueryClientMock {},
  QueryClientProvider: function QueryClientProviderMock({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
}));

vi.mock('@/components/arena/ArenaPage', () => ({
  ArenaPage: function ArenaPageMock() {
    return <main data-page="arena">完整竞技场</main>;
  },
}));

vi.mock('@/components/arena-lite/BattleLitePage', () => ({
  BattleLitePage: function BattleLitePageMock() {
    return <main data-page="battle">简洁竞技场</main>;
  },
}));

vi.mock('@/components/arena/stores/useBattleStore', () => ({
  useBattleStore: {
    getState: () => ({
      setGenerationMode: vi.fn(),
    }),
  },
}));

vi.mock('@/components/ranking/RankingPage', () => ({
  RankingPage: function RankingPageMock() {
    return <main data-page="ranking">排位排行榜</main>;
  },
}));

vi.mock('@/components/challenge/ChallengePage', () => ({
  ChallengePage: function ChallengePageMock() {
    return <main data-page="challenge">本轮挑战</main>;
  },
}));

vi.mock('@/components/investigation/InvestigationPage', () => ({
  InvestigationPage: function InvestigationPageMock() {
    return <main data-page="investigation">公开数据卡众查</main>;
  },
}));

vi.mock('@/components/pvp/PvpLobbyPage', () => ({
  PvpLobbyPage: function PvpLobbyPageMock() {
    return <main data-page="pvp">PVP 大厅</main>;
  },
}));

vi.mock('@/components/pvp/PvpRoomPage', () => ({
  PvpRoomPage: function PvpRoomPageMock() {
    return <main data-page="pvp-room">PVP 房间</main>;
  },
}));

vi.mock('@/components/competition/SublimationPage', () => ({
  SublimationPage: function SublimationPageMock() {
    return <main data-page="sublimation">成长升华</main>;
  },
}));

vi.mock('@/components/competition/ArrestedPage', () => ({
  ArrestedPage: function ArrestedPageMock() {
    return <main data-page="arrested">批准逮捕</main>;
  },
}));

vi.mock('@/components/competition/ChallengeRouteGate', () => ({
  ChallengeRouteGate: function ChallengeRouteGateMock() {
    return <main data-page="challenge">本轮挑战</main>;
  },
}));

const readProjectFile = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('competition domain App Router pages', () => {
  test('battle, arena and arena-stream routes render migrated pages with metadata', async () => {
    const { default: BattleRoute, metadata: battleMetadata } = await import('@/app/battle/page');
    const { default: ArenaRoute, metadata: arenaMetadata } = await import('@/app/arena/page');
    const { default: ArenaStreamRoute, metadata: arenaStreamMetadata } = await import('@/app/arena-stream/page');

    expect(renderToStaticMarkup(<BattleRoute />)).toContain('data-page="battle"');
    expect(renderToStaticMarkup(<ArenaRoute />)).toContain('data-page="arena"');
    expect(renderToStaticMarkup(<ArenaStreamRoute />)).toContain('data-page="arena"');
    expect(battleMetadata).toMatchObject({
      title: '魔法少女竞技场（简洁版） - MahoShojo Generator',
    });
    expect(arenaMetadata).toMatchObject({
      title: '魔法少女竞技场 - MahoShojo Generator',
    });
    expect(arenaStreamMetadata).toMatchObject({
      title: '魔法少女竞技场·流 - MahoShojo Generator',
    });
  });

  test('ranking, sublimation, challenge and investigation routes render migrated pages', async () => {
    const { default: RankingRoute, metadata: rankingMetadata } = await import('@/app/ranking/page');
    const { default: SublimationRoute, metadata: sublimationMetadata } = await import('@/app/sublimation/page');
    const { default: ChallengeRoute, metadata: challengeMetadata } = await import('@/app/challenge/page');
    const { default: InvestigationRoute, metadata: investigationMetadata } = await import('@/app/investigation/page');

    expect(renderToStaticMarkup(<RankingRoute />)).toContain('data-page="ranking"');
    expect(renderToStaticMarkup(<SublimationRoute />)).toContain('data-page="sublimation"');
    expect(renderToStaticMarkup(<ChallengeRoute />)).toContain('data-page="challenge"');
    expect(renderToStaticMarkup(<InvestigationRoute />)).toContain('data-page="investigation"');
    expect(rankingMetadata).toMatchObject({ title: '排位排行榜 - MahoShojo Generator' });
    expect(sublimationMetadata).toMatchObject({
      title: '成长升华 - MahoShojo Generator',
      description: '根据角色的历战记录，生成一个全新的成长后形态！',
    });
    expect(challengeMetadata).toMatchObject({ title: '魔女挑战 - MahoShojo Generator' });
    expect(investigationMetadata).toMatchObject({ title: '调查院 - MahoShojo Generator' });
  });

  test('pvp lobby and room routes render migrated pages and dynamic room metadata', async () => {
    const { default: PvpRoute, metadata: pvpMetadata } = await import('@/app/pvp/page');
    const { default: PvpRoomRoute, generateMetadata } = await import('@/app/pvp/[roomId]/page');

    expect(renderToStaticMarkup(<PvpRoute />)).toContain('data-page="pvp"');
    expect(renderToStaticMarkup(<PvpRoomRoute />)).toContain('data-page="pvp-room"');
    expect(pvpMetadata).toMatchObject({ title: 'PVP 大厅 - MahoShojo Generator' });
    await expect(generateMetadata({ params: Promise.resolve({ roomId: 'room-7' }) })).resolves.toMatchObject({
      title: 'PVP 房间 - room-7',
    });
  });

  test('arrested route renders migrated page and keeps topbar exclusion metadata', async () => {
    const { default: ArrestedRoute, metadata } = await import('@/app/arrested/page');
    const html = renderToStaticMarkup(<ArrestedRoute />);

    expect(html).toContain('data-page="arrested"');
    expect(metadata).toMatchObject({
      title: '调查院正在出动 - 魔法国度调查院',
      description: '魔法国度调查院逮捕令',
    });
  });

  test('migrated competition App Router surface does not import next/router or next/head', () => {
    const paths = [
      'app/battle/page.tsx',
      'app/arena/page.tsx',
      'app/arena-stream/page.tsx',
      'app/ranking/page.tsx',
      'app/sublimation/page.tsx',
      'app/challenge/page.tsx',
      'app/investigation/page.tsx',
      'app/pvp/page.tsx',
      'app/pvp/[roomId]/page.tsx',
      'app/arrested/page.tsx',
      'components/competition/CompetitionRouteProviders.tsx',
      'components/competition/ChallengeRouteGate.tsx',
      'components/arena/ArenaPage.tsx',
      'components/arena-lite/BattleLitePage.tsx',
      'components/ranking/RankingPage.tsx',
      'components/pvp/PvpLobbyPage.tsx',
      'components/pvp/PvpRoomPage.tsx',
      'components/pvp/PvpRoomBrowserModal.tsx',
      'components/arena/hooks/useBattleEngine.ts',
    ];

    const missing = paths.filter((path) => !existsSync(join(process.cwd(), path)));
    expect(missing).toEqual([]);

    for (const path of paths) {
      const source = readProjectFile(path);
      expect(source, path).not.toContain('next/router');
      expect(source, path).not.toContain('next/head');
    }
  });
});
