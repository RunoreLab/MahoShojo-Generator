// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { favoritesApi, authStorage } from '@/lib/auth';
import BattleDataModal from '@/components/BattleDataModal';
import { IndexedDbCardRepository, resetLocalCardRepository } from '@/lib/local-library/card-repository';
import { LOCAL_LIBRARY_DB_NAME, resetLocalLibraryDbConnection } from '@/lib/local-library/db';
import { saveLocalDataCard } from '@/lib/local-library/data-card-digest';

const authState = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({
  isAuthenticated: authState.isAuthenticated,
  user: null,
  userBadges: [],
}) }));
vi.mock('@/components/DataCard', () => ({ default: (props: any) => (
  <div data-testid={`card-${props.id}`}><span>{props.name}</span></div>
) }));
vi.mock('@/components/DataCardDetailsModal', () => ({ default: () => null }));
vi.mock('@/components/DecksModal', () => ({ default: (props: any) => (
  props.isOpen ? <div data-testid="decks-modal">卡组弹窗</div> : null
) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let repository: IndexedDbCardRepository;

beforeEach(async () => {
  authState.isAuthenticated = false;
  resetLocalLibraryDbConnection();
  resetLocalCardRepository();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_LIBRARY_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  repository = new IndexedDbCardRepository();
  vi.spyOn(authStorage, 'getAuthHeader').mockResolvedValue(null);
  vi.spyOn(favoritesApi, 'getFavorites').mockResolvedValue({ success: true, favorites: [] });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, cards: [], items: {}, tags: [] })));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = async (props: Record<string, unknown> = {}): Promise<void> => {
  await act(async () => root.render(
    <BattleDataModal isOpen onClose={() => {}} selectedType="character" onSelectCard={() => {}} {...props} />,
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
};

const rail = (): HTMLElement => document.body.querySelector<HTMLElement>('[role="tablist"]')!;
const tab = (value: string): HTMLButtonElement => document.body.querySelector<HTMLButtonElement>(`#battle-data-source-tab-${value}`)!;
const panel = (): HTMLElement => document.body.querySelector<HTMLElement>('[role="tabpanel"]')!;
const press = async (key: string): Promise<void> => {
  await act(async () => {
    rail().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

describe('数据卡页签的 ARIA 与窄屏承载', () => {
  it('tab 与 tabpanel 双向绑定，tablist 只占一个 Tab 停靠点', async () => {
    await render();

    expect(rail().getAttribute('aria-label')).toBe('数据卡来源');
    expect(rail().getAttribute('aria-orientation')).toBe('horizontal');
    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(3);
    expect(tab('public').getAttribute('aria-selected')).toBe('true');
    expect(tab('public').getAttribute('aria-controls')).toBe('battle-data-source-panel-public');
    expect(tab('local').getAttribute('aria-controls')).toBe('battle-data-source-panel-local');
    expect(panel().id).toBe('battle-data-source-panel-public');
    expect(panel().getAttribute('aria-labelledby')).toBe('battle-data-source-tab-public');
    // roving tabIndex：只有当前页签能 Tab 到达，其余靠方向键。
    expect([...document.body.querySelectorAll('[role="tab"]')].map((node) => node.tabIndex))
      .toEqual([...document.body.querySelectorAll('[role="tab"]')].map((node) => node.getAttribute('aria-selected') === 'true' ? 0 : -1));
  });

  it('窄屏靠横向滚动承载，不再让 flex 把中文标签压成竖排', async () => {
    await render();

    expect(rail().className).toContain('overflow-x-auto');
    for (const node of document.body.querySelectorAll<HTMLElement>('[role="tab"]')) {
      // 少了这两条，中文会在窄屏被逐字拆成竖排——这正是本次要修的故障。
      expect(node.className).toContain('shrink-0');
      expect(node.className).toContain('whitespace-nowrap');
      // 触控目标不低于 44px（Apple HIG / WCAG 2.5.5）。
      expect(node.className).toContain('min-h-11');
    }
  });

  it('标签顺序与数量文案照旧，数量用等宽数字避免整条 rail 抖动', async () => {
    await render();

    expect([...document.body.querySelectorAll('[role="tab"]')].map((node) => node.textContent)).toEqual([
      '本地库 (—)',
      '公开角色',
      '管理员推荐',
    ]);
    const counts = document.body.querySelectorAll('[role="tab"] .tabular-nums');
    expect([...counts].map((node) => node.textContent)).toEqual([' (—)']);
  });

  it('卡组导入不是页签，必须留在滚动 rail 之外', async () => {
    authState.isAuthenticated = true;
    await render({ allowDeckImport: true, selectionMode: 'multi' });

    const importButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === '卡组导入');
    expect(importButton).toBeDefined();
    // 进了 rail 就会跟着横向滚动被卷走，窄屏下等于消失。
    expect(rail().contains(importButton!)).toBe(false);

    await act(async () => (importButton as HTMLButtonElement).click());
    expect(document.body.querySelector('[data-testid="decks-modal"]')).toBeTruthy();
  });

  it('方向键在页签间移动并即时选中，首尾硬停而不是无限循环', async () => {
    await render();

    await press('ArrowRight');
    expect(tab('recommended').getAttribute('aria-selected')).toBe('true');
    expect(panel().id).toBe('battle-data-source-panel-recommended');
    expect(document.activeElement).toBe(tab('recommended'));

    // Material 明确不建议让可横向滚动的 tab 集无限循环。
    await press('ArrowRight');
    expect(tab('recommended').getAttribute('aria-selected')).toBe('true');

    await press('ArrowLeft');
    await press('ArrowLeft');
    expect(tab('local').getAttribute('aria-selected')).toBe('true');
    await press('ArrowLeft');
    expect(tab('local').getAttribute('aria-selected')).toBe('true');

    await press('End');
    expect(tab('recommended').getAttribute('aria-selected')).toBe('true');
    await press('Home');
    expect(tab('local').getAttribute('aria-selected')).toBe('true');
  });

  it('横向 tablist 不吞上下方向键，把滚动页面的能力留给用户', async () => {
    await render();

    await press('ArrowDown');
    expect(tab('public').getAttribute('aria-selected')).toBe('true');
    await press('ArrowUp');
    expect(tab('public').getAttribute('aria-selected')).toBe('true');
  });

  it('再次点击当前页签仍然刷新而不是切走，收敛到统一入口后不能丢这个交互', async () => {
    await render();

    const before = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    await act(async () => tab('public').click());

    expect(tab('public').getAttribute('aria-selected')).toBe('true');
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBeGreaterThan(before);
  });

  it('initialTab 指定的页签即使在 rail 末端也是选中态', async () => {
    await render({ initialTab: 'recommended' });

    expect(tab('recommended').getAttribute('aria-selected')).toBe('true');
    expect(panel().id).toBe('battle-data-source-panel-recommended');
  });

  it('页签行 sticky 留在滚动容器内，往下翻列表时仍能切页签', async () => {
    await render();

    const row = rail().closest<HTMLElement>('[class*="sticky"]')!;
    expect(row).toBeTruthy();
    expect(row.className).toContain('sticky');
    expect(row.className).toContain('bg-white');
    // 不透明底色是必须的，否则卡片会从页签行底下透出来。
  });

  it('弹窗外壳不再用 vw 定量宽，移动端不会被遮罩 padding 顶出横向滚动', async () => {
    await render();

    const shell = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    // 遮罩自带 p-4，再叠 w-[96vw] 必然超出视口；高度也要用 dvh 才不会被地址栏吃掉。
    expect(shell.className).not.toContain('vw]');
    expect(shell.className).not.toMatch(/(^|[^d])vh\]/);
    expect(shell.className).toContain('w-full');
    expect(shell.className).toContain('dvh]');
  });

  it('卡片网格自成一个层叠上下文，卡内浮层不会穿透到 sticky 页签行之上', async () => {
    await saveLocalDataCard(
      repository,
      { cardType: 'character', title: '本机焰', payload: { name: '本机焰', codename: '本机焰', age: 15 } },
      () => '2026-09-30T00:00:00.000Z',
    );
    await render({ initialTab: 'local', selectionMode: 'multi' });

    const toggle = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === '+' || button.textContent === '-');
    expect(toggle).toBeDefined();
    // 浮层自身是 absolute z-20：它必须只和卡片内容比层级，不能和弹窗 chrome 比。
    expect(toggle!.className).toContain('absolute');
    expect(toggle!.className).toContain('z-20');

    // jsdom 不做层叠计算，这里锁的是「网格必须是独立层叠上下文」这个类名契约：
    // 少了 isolate，卡片容器（relative、z-index auto）不构成层叠上下文，
    // z-20 会直接压过 sticky 页签行的 z-10。
    const grid = toggle!.closest<HTMLElement>('.grid');
    expect(grid?.className).toContain('isolate');
  });
});
