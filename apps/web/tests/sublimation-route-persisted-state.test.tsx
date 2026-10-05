// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useNarrativeHistoryStore } from '@/components/arena/stores/useNarrativeHistoryStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/components/competition/SublimationPage', () => ({
  SublimationPage: function SublimationPageMock() {
    return <main data-page="sublimation">成长升华</main>;
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  useNarrativeHistoryStore.setState({
    entries: [],
    lastUpdatedAt: null,
    sort: 'updated_desc',
  });
  localStorage.clear();

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('/sublimation restores Arena narrative history before rendering the page', async () => {
  localStorage.setItem('arena-narrative-history-v1', JSON.stringify({
    state: {
      entries: [{
        id: 'persisted-entry',
        title: '持久化战报',
        content: '战报正文',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }],
      lastUpdatedAt: '2026-09-01T00:00:00.000Z',
      sort: 'created_asc',
    },
    version: 2,
  }));

  const { default: SublimationRoute } = await import('@/app/sublimation/page');
  await act(async () => root.render(<SublimationRoute />));

  await vi.waitFor(() => {
    expect(container.querySelector('[data-page="sublimation"]')).not.toBeNull();
    expect(useNarrativeHistoryStore.getState()).toMatchObject({
      entries: [{
        id: 'persisted-entry',
        title: '持久化战报',
        content: '战报正文',
      }],
      lastUpdatedAt: '2026-09-01T00:00:00.000Z',
      sort: 'created_asc',
    });
  });
});
