// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/components/arena-lite/BattleLitePage', async () => {
  const ReactModule = await import('react');
  const { useBattleStore: battleStore } = await vi.importActual<
    typeof import('@/components/arena/stores/useBattleStore')
  >('@/components/arena/stores/useBattleStore');

  return {
    BattleLitePage: function BattleLitePageMock() {
      ReactModule.useEffect(() => {
        battleStore.getState().setUserProviderConfig({
          providerId: 'openai',
          apiKey: 'test-only',
          modelId: 'test-model',
        });
      }, []);
      return <main data-page="battle">简洁竞技场</main>;
    },
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  useBattleStore.setState((state) => ({
    ...state,
    battleMode: 'classic',
    generationMode: 'non-stream',
    arenaFreeRankingEnabled: false,
    storyLength: 'default',
    customStoryLength: '',
    selectedLanguage: 'zh-CN',
    adjudicationEvents: [],
  }));
  localStorage.clear();

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('competition routes restore persisted Arena state before mounting page effects', () => {
  it('/battle restores every shared setting and does not overwrite it on a later unrelated set()', async () => {
    localStorage.setItem('arena-storage', JSON.stringify({
      state: {
        battleMode: 'daily',
        generationMode: 'stream',
        arenaFreeRankingEnabled: true,
        storyLength: 'long',
        customStoryLength: '1350',
        selectedLanguage: 'en-US',
        settings: {
          readArenaHistory: false,
          readArenaHistoryLimit: 7,
          isArenaHistoryUnlimited: false,
          writeArenaHistory: false,
          readCurrentState: false,
          writeCurrentState: false,
          readNarrativeHistory: true,
          readNarrativeHistoryLimit: 4,
          isNarrativeHistoryUnlimited: false,
          writeNarrativeHistory: true,
          streamTransport: 'sse',
          userGuidance: '保留这段故事方向',
          battleReportCardWidthMode: 'manual',
          battleReportCardWidthPx: 960,
        },
      },
      version: 1,
    }));

    const { BattleRouteProviders } = await import('@/components/competition/BattleRouteProviders');
    await act(async () => root.render(<BattleRouteProviders />));

    await vi.waitFor(() => {
      expect(container.querySelector('[data-page="battle"]')).not.toBeNull();
      expect(useBattleStore.getState()).toMatchObject({
        battleMode: 'daily',
        generationMode: 'stream',
        arenaFreeRankingEnabled: true,
        storyLength: 'long',
        customStoryLength: '1350',
        selectedLanguage: 'en-US',
        settings: {
          readArenaHistory: false,
          readArenaHistoryLimit: 7,
          writeArenaHistory: false,
          readCurrentState: false,
          writeCurrentState: false,
          readNarrativeHistory: true,
          readNarrativeHistoryLimit: 4,
          writeNarrativeHistory: true,
          streamTransport: 'sse',
          userGuidance: '保留这段故事方向',
          battleReportCardWidthMode: 'manual',
          battleReportCardWidthPx: 960,
        },
      });
    });

    const persisted = JSON.parse(localStorage.getItem('arena-storage') ?? '{}');
    expect(persisted.state).toMatchObject({
      battleMode: 'daily',
      generationMode: 'stream',
      arenaFreeRankingEnabled: true,
      storyLength: 'long',
      customStoryLength: '1350',
      selectedLanguage: 'en-US',
      settings: {
        readArenaHistory: false,
        streamTransport: 'sse',
        userGuidance: '保留这段故事方向',
        battleReportCardWidthMode: 'manual',
        battleReportCardWidthPx: 960,
      },
    });
  });
});
