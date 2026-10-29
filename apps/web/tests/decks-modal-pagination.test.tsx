// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deckApi, deckFavoritesApi } from '@/lib/auth';
import * as cardClient from '@/lib/data-card-list-client';
import type { DataCardSummaryPage } from '@mahoshojo/contracts/data-cards';
import DecksModal from '@/components/DecksModal';

vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ user: { id: 7 }, isAuthenticated: true }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const summaryPage: DataCardSummaryPage = { success: true, cards: [], total: 60, nextOffset: 12 };

beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.spyOn(deckApi, 'getMyDecks').mockResolvedValue({ decks: [{ id: 'deck-1', name: '测试卡组', userId: 7, isPublic: 0 }], capacity: 10, deckCount: 1 });
  vi.spyOn(deckApi, 'getPublicDecks').mockResolvedValue([]);
  vi.spyOn(deckApi, 'getDeckCards').mockResolvedValue({ deck: { id: 'deck-1', name: '测试卡组', userId: 7, isPublic: 0 }, cards: [] });
  vi.spyOn(deckFavoritesApi, 'getFavoriteIds').mockResolvedValue([]);
  vi.spyOn(deckFavoritesApi, 'getFavorites').mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks();
});

it('我的角色卡可直接跳到目标页，只发目标 offset 请求', async () => {
  const readPage = vi.spyOn(cardClient, 'getDataCardSummaryPage').mockResolvedValue(summaryPage);
  await act(async () => root.render(<DecksModal isOpen onClose={vi.fn()} onImportDeck={vi.fn()} />));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '编辑')!.click());

  const jumpInput = container.querySelector<HTMLInputElement>('input[aria-label="跳转页码"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(jumpInput, '4');
    jumpInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('跳转'))!.click());

  expect(readPage.mock.calls.map(([, query]) => query.offset)).toEqual([0, 36]);
});
