// @vitest-environment jsdom

import React, { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseModal } from '@/components/shared/BaseModal';
import BattleDataModal from '@/components/BattleDataModal';
import { DataCardReportModal } from '@/components/data-card-reports/DataCardReportModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    user: null,
    userBadges: [],
  }),
}));

vi.mock('@/lib/auth', () => ({
  authStorage: {
    getAuthHeader: vi.fn(async () => null),
  },
  dataCardApi: {
    getCards: vi.fn(async () => []),
  },
  favoritesApi: {
    getFavorites: vi.fn(async () => ({ success: true, favorites: [] })),
    add: vi.fn(async () => ({ success: true })),
    remove: vi.fn(async () => ({ success: true })),
  },
  deckApi: {
    getDeckCards: vi.fn(async () => ({ cards: [] })),
  },
}));

vi.mock('@/lib/localStorage', () => ({
  addUsedCard: vi.fn(),
  isCardLiked: vi.fn(() => false),
  isCardUsed: vi.fn(() => true),
}));

const card = {
  id: 'card-1',
  name: '角色一',
  description: '公开角色卡',
  type: 'character',
  is_public: 1,
  review_status: 'approved',
  usage_count: 0,
  like_count: 0,
  favorite_count: 0,
  user_id: 1,
  username: 'tester',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  data: JSON.stringify({ codename: '角色一', templateId: 'magical-girl' }),
};

const jsonResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public-data-cards')) {
      return jsonResponse({ success: true, cards: [card] });
    }
    if (url.includes('/api/data-card-meta-batch')) {
      return jsonResponse({ success: true, items: {} });
    }
    if (url.includes('/api/data-card-meta?')) {
      return jsonResponse({
        success: true,
        dataCardId: card.id,
        tags: [],
        metrics: null,
        ratings: { strict: null, free: null },
      });
    }
    if (url.includes('/api/badges/batch')) {
      return jsonResponse({ success: true, items: {} });
    }
    if (url.includes('/api/tags')) {
      return jsonResponse({
        success: true,
        tags: [{
          id: 'tag-1',
          name: '公开',
          description: null,
          category: null,
          scope: 'system',
          isActive: true,
        }],
      });
    }
    return jsonResponse({ success: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.overflow = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BaseModal accessibility contract', () => {
  it('labels dialog, focuses close control, traps focus, restores focus, locks body, and closes on Escape', async () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = '打开';
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();

    await act(async () => root.render(
      <BaseModal isOpen title="测试窗口" onClose={onClose}>
        <button type="button">窗口操作</button>
      </BaseModal>,
    ));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? '')?.textContent).toContain('测试窗口');
    expect(document.body.style.overflow).toBe('hidden');
    const closeButton = dialog?.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]');
    expect(closeButton).not.toBeNull();
    expect(document.activeElement).toBe(closeButton);

    const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    const lastFocusable = focusable.at(-1);
    expect(lastFocusable).not.toBeUndefined();
    lastFocusable?.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(closeButton);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => root.render(
      <BaseModal isOpen={false} title="测试窗口" onClose={onClose}>
        <button type="button">窗口操作</button>
      </BaseModal>,
    ));
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe('DataCardReportModal accessibility contract', () => {
  it('is a labelled topmost dialog with focus trap, Escape close, and trigger restore', async () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = '举报此卡';
    document.body.append(trigger);
    trigger.focus();

    const Harness = () => {
      const [open, setOpen] = useState(true);
      return (
        <DataCardReportModal
          isOpen={open}
          cardName="角色一"
          reasons={[{ code: 'plagiarism', label: '疑似抄袭', description: '高度近似搬运' }]}
          initialReport={null}
          submitting={false}
          error={null}
          onClose={() => setOpen(false)}
          onSubmit={vi.fn()}
        />
      );
    };

    flushSync(() => root.render(<Harness />));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog?.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy ?? '')?.textContent).toContain('举报数据卡');
    const cancelButton = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.trim() === '取消');
    expect(document.activeElement).toBe(cancelButton);

    const submitButton = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.trim() === '提交举报');
    const firstFocusable = dialog?.querySelector<HTMLElement>('input:not([disabled])');
    submitButton?.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(firstFocusable);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe('BattleDataModal accessibility and capabilities', () => {
  it('renders a labelled dialog with keyboard-native single selection and restores focus on close', async () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = '选择角色';
    document.body.append(trigger);
    trigger.focus();
    const onSelectCard = vi.fn();

    const Harness = () => {
      const [open, setOpen] = useState(true);
      return (
        <BattleDataModal
          isOpen={open}
          onClose={() => setOpen(false)}
          selectedType="character"
          visibleTabs={['public']}
          selectionMode="single"
          onSelectCard={onSelectCard}
          allowDeckImport={false}
          allowCardDetails={false}
        />
      );
    };

    flushSync(() => root.render(<Harness />));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog?.getAttribute('aria-label')).toContain('角色');
    expect(document.body.style.overflow).toBe('hidden');
    const closeButton = dialog?.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]');
    expect(document.activeElement).toBe(closeButton);
    expect(dialog?.textContent).not.toContain('卡组导入');
    const detailButton = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.trim() === '详情');
    expect(detailButton).toBeUndefined();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    const selectionButton = dialog?.querySelector<HTMLButtonElement>('button[aria-label="选择角色一"]');
    expect(selectionButton).not.toBeNull();
    expect(selectionButton?.className).toContain('min-h-10');
    expect(selectionButton?.className).toContain('min-w-10');
    selectionButton?.focus();
    expect(document.activeElement).toBe(selectionButton);
    act(() => selectionButton?.click());
    expect(onSelectCard).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('keeps card details as the topmost keyboard modal and restores its trigger', async () => {
    flushSync(() => root.render(
      <BattleDataModal
        isOpen
        onClose={vi.fn()}
        selectedType="character"
        visibleTabs={['public']}
        selectionMode="single"
        onSelectCard={vi.fn()}
        allowDeckImport={false}
      />,
    ));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const outerDialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const detailButton = [...(outerDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.trim() === '详情');
    expect(detailButton).toBeDefined();
    detailButton?.focus();
    act(() => detailButton?.click());

    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
    expect(dialogs).toHaveLength(2);
    const detailsDialog = dialogs.at(-1);
    expect(detailsDialog?.getAttribute('aria-modal')).toBe('true');
    const detailsClose = detailsDialog?.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]');
    expect(detailsClose).not.toBeNull();
    expect(document.activeElement).toBe(detailsClose);

    const detailsFocusable = [...(detailsDialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    const lastDetailsFocusable = detailsFocusable.at(-1);
    lastDetailsFocusable?.focus();
    lastDetailsFocusable?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(detailsClose);

    act(() => detailsClose?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(outerDialog?.contains(document.activeElement)).toBe(true);
    if (document.contains(detailButton)) expect(document.activeElement).toBe(detailButton);
  });

});
