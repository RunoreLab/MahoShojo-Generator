// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/components/arena/ArenaPage', () => ({
  ArenaPage: function ArenaPageMock() {
    return <main data-page="arena-stream">流式竞技场</main>;
  },
}));

vi.mock('@/config/arena-multiplayer', () => ({
  arenaMultiplayerConfig: {
    enabled: true,
    origin: 'http://127.0.0.1:8787',
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  useBattleStore.setState((state) => ({
    ...state,
    battleMode: 'classic',
    generationMode: 'non-stream',
    storyLength: 'default',
    selectedLanguage: 'zh-CN',
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

it('/arena-stream restores shared settings before forcing generation mode to stream', async () => {
  localStorage.setItem('arena-storage', JSON.stringify({
    state: {
      battleMode: 'daily',
      generationMode: 'non-stream',
      storyLength: 'long',
      selectedLanguage: 'en-US',
    },
    version: 1,
  }));

  const { ArenaStreamRouteProviders } = await import('@/components/competition/ArenaRouteProviders');
  await act(async () => root.render(<ArenaStreamRouteProviders />));

  await vi.waitFor(() => {
    expect(container.querySelector('[data-page="arena-stream"]')).not.toBeNull();
    expect(useBattleStore.getState()).toMatchObject({
      battleMode: 'daily',
      generationMode: 'stream',
      storyLength: 'long',
      selectedLanguage: 'en-US',
    });
  });

  const persisted = JSON.parse(localStorage.getItem('arena-storage') ?? '{}');
  expect(persisted.state).toMatchObject({
    battleMode: 'daily',
    generationMode: 'stream',
    storyLength: 'long',
    selectedLanguage: 'en-US',
  });
});
