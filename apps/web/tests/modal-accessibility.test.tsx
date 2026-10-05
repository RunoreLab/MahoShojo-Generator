// @vitest-environment jsdom

import React, { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseModal } from '@/components/shared/BaseModal';
import BattleDataModal from '@/components/BattleDataModal';
import { DataCardReportModal } from '@/components/data-card-reports/DataCardReportModal';
import { ArenaRoomDialog } from '@/components/arena/multiplayer/ArenaRoomDialog';

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
  addLikedCard: vi.fn(() => true),
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
      return jsonResponse({ success: true, items: { [card.id]: { metrics: null, strict: null } } });
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
      return jsonResponse({ success: true, items: { [card.user_id]: [] } });
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
    expect(dialog?.className).toContain('dark:bg-gray-950');
    expect(dialog?.querySelector('[id]')?.className).toContain('dark:text-gray-100');

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

  it('keeps keyboard ownership with the topmost dialog when two BaseModals are open', async () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();

    const draw = async (innerOpen: boolean) => {
      await act(async () => root.render(
        <>
          <BaseModal isOpen title="外层" onClose={outerClose}>
            <button type="button">外层操作</button>
          </BaseModal>
          <BaseModal isOpen={innerOpen} title="内层" onClose={innerClose}>
            <button type="button">取消</button>
            <button type="button">删除</button>
          </BaseModal>
        </>,
      ));
    };

    const innerDialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
      .find((dialog) => dialog.querySelector('div[id]')?.textContent === '内层')!;
    const pressTab = async (shiftKey = false) => {
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
      });
    };

    await draw(true);
    const inner = innerDialog();
    const closeButton = inner.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')!;
    const cancelButton = [...inner.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '取消')!;
    const deleteButton = [...inner.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '删除')!;
    expect(document.activeElement).toBe(closeButton);

    // 焦点停在内层中间的元素上时，背景对话框的 focus trap 不得把它拽回自己。
    // 修复前这里会跳到内层的关闭按钮，Tab 因此永远走不到「删除」。
    cancelButton.focus();
    await pressTab();
    expect(document.activeElement).toBe(cancelButton);

    // 边界仍然由内层自己闭环。
    deleteButton.focus();
    await pressTab();
    expect(document.activeElement).toBe(closeButton);
    await pressTab(true);
    expect(document.activeElement).toBe(deleteButton);

    // Escape 只关最上层，背景对话框必须留着（用户填好的搜索与页签不能被一起丢掉）。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();

    await draw(false);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
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

    await act(async () => root.render(<Harness />));
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

  it('focuses the dialog itself while all report actions are disabled', async () => {
    await act(async () => root.render(
      <DataCardReportModal
        isOpen
        cardName="角色一"
        reasons={[{ code: 'plagiarism', label: '疑似抄袭', description: '高度近似搬运' }]}
        initialReport={null}
        submitting
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    ));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
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

    await act(async () => root.render(<Harness />));

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
    const floatingSelectButton = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.trim() === '选择');
    expect(floatingSelectButton).toBeUndefined();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    const selectionTarget = dialog?.querySelector<HTMLDivElement>('div[role="button"][aria-label="选择角色一"]');
    expect(selectionTarget).not.toBeNull();
    expect(selectionTarget?.getAttribute('aria-disabled')).toBeNull();
    expect(selectionTarget?.tabIndex).toBe(0);
    selectionTarget?.focus();
    expect(document.activeElement).toBe(selectionTarget);
    act(() => {
      selectionTarget?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(onSelectCard).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('keeps the multi-mode quick toggle compact with an enlarged touch hit area', async () => {
    await act(async () => root.render(
      <BattleDataModal
        isOpen
        onClose={vi.fn()}
        selectedType="character"
        visibleTabs={['public']}
        selectionMode="multi"
        onToggleCard={vi.fn()}
        allowDeckImport={false}
        allowCardDetails={false}
      />,
    ));

    const dialog = document.querySelector('[role="dialog"]');
    const quickToggle = dialog?.querySelector<HTMLButtonElement>('button[aria-label="加入"]');
    expect(quickToggle).not.toBeNull();
    expect(quickToggle?.className).toContain('h-8');
    expect(quickToggle?.className).toContain('w-8');
    expect(quickToggle?.className).toContain('after:-inset-1');
    expect(quickToggle?.className).not.toContain('min-h-10');
    expect(quickToggle?.className).not.toContain('min-w-10');
  });

  it('keeps card details as the topmost keyboard modal and restores its trigger', async () => {
    await act(async () => root.render(
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
    await vi.waitFor(() => {
      expect([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .some((button) => button.textContent?.trim() === '详情')).toBe(true);
    });
    const outerDialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const detailButton = [...(outerDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.trim() === '详情');
    expect(detailButton).toBeDefined();
    detailButton?.focus();
    await act(async () => detailButton?.click());

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

/**
 * `ArenaRoomDialog` 是 `BaseModal` 的薄封装，但它**固定传 `closeOnBackdrop={false}`**，
 * 因此继承到的可访问性契约与上面 `BaseModal` 那一族（默认 `closeOnBackdrop=true`）不同，
 * 之前没有任何用例覆盖过这个差异。
 *
 * 关掉「点遮罩关闭」是有意的：房间提案窗口里有未提交的草稿，点错遮罩不该把它丢掉。
 * 但关掉之后键盘用户不能被关在窗外，所以真正要守的是这三条：
 *
 * 1. 遮罩从可访问性树和 tab 序里退出（`aria-hidden` + `tabindex="-1"`）且点击不触发关闭
 *    ——它不再是可用的关闭入口，就不能假装是；
 * 2. 唯一的关闭入口是那个带可访问名称的按钮；
 * 3. **Escape 仍然关闭**。这是关掉遮罩关闭之后键盘用户仅剩的出路，必须单独守住。
 *
 * 另外覆盖 `ArenaRoomDialog` 从 title 派生关闭按钮可访问名称的那段逻辑：title 是字符串时
 * 用它自己，不是字符串时回退到「房间」。回退分支此前从未被执行过。
 */
describe('ArenaRoomDialog accessibility contract', () => {
  const renderDialog = async (
    node: React.ReactNode,
  ): Promise<HTMLButtonElement> => {
    await act(async () => root.render(node));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    // 关闭按钮是初始焦点：遮罩不可用之后，它是第一个可达的控件
    const closeButton = dialog?.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]');
    expect(closeButton).not.toBeNull();
    expect(document.activeElement).toBe(closeButton);
    return closeButton as HTMLButtonElement;
  };

  const backdrop = (): HTMLButtonElement => {
    const target = document.querySelector<HTMLButtonElement>('button[aria-hidden="true"]');
    expect(target).not.toBeNull();
    return target as HTMLButtonElement;
  };

  it('closes via Escape and the labelled close button, but never via the backdrop', async () => {
    const onClose = vi.fn();
    const closeButton = await renderDialog(
      <ArenaRoomDialog
        open
        titleId="arena-room-dialog-title"
        title="房间邀请"
        onClose={onClose}
      >
        <button type="button">房间操作</button>
      </ArenaRoomDialog>,
    );

    // 标题通过 titleId 接到 aria-labelledby 上
    const labelledBy = document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('arena-room-dialog-title');
    expect(document.getElementById('arena-room-dialog-title')?.textContent).toBe('房间邀请');

    // 遮罩不再是关闭入口：被移出可访问性树与 tab 序，且没有 click handler
    const mask = backdrop();
    expect(mask.getAttribute('aria-hidden')).toBe('true');
    expect(mask.getAttribute('tabindex')).toBe('-1');
    expect(mask.getAttribute('aria-label')).toBeNull();
    await act(async () => mask.click());
    expect(onClose).not.toHaveBeenCalled();

    // 唯一关闭入口：带可访问名称的按钮
    expect(closeButton.getAttribute('aria-label')).toBe('关闭“房间邀请”对话框');
    await act(async () => closeButton.click());
    expect(onClose).toHaveBeenCalledOnce();

    // 键盘用户不能被关在窗外：Escape 仍然关闭
    onClose.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('falls back to a generic accessible name when the title is not a string', async () => {
    const closeButton = await renderDialog(
      <ArenaRoomDialog
        open
        titleId="arena-room-dialog-node-title"
        title={<span>房间状态</span>}
        description="非字符串标题"
        onClose={vi.fn()}
      >
        <button type="button">房间操作</button>
      </ArenaRoomDialog>,
    );

    expect(closeButton.getAttribute('aria-label')).toBe('关闭“房间”对话框');
  });
});
