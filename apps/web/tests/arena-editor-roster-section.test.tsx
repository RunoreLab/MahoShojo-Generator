// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CombatantList } from '@/components/arena/components/CombatantList';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import type { CombatantData } from '@/components/arena/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const dataCombatant = (filename: string, codename: string, teamId?: number): CombatantData => ({
  type: 'magical-girl',
  data: { codename, name: codename },
  filename,
  isValid: true,
  isPreset: false,
  isNonStandard: false,
  ...(teamId ? { teamId } : {}),
});

const resetStore = () => {
  useBattleStore.setState(useBattleStore.getInitialState(), true);
};

const setValue = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void => {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const button = (label: string): HTMLButtonElement => {
  const target = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return target;
};

const renderList = (): void => {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <CombatantList onShowDetails={() => undefined} />
      </QueryClientProvider>,
    );
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  resetStore();
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('shared Arena roster section via solo adapter', () => {
  it('渲染 roster 行与计数，并支持全局重排', () => {
    useBattleStore.setState({
      combatants: [dataCombatant('alpha.json', '阿尔法'), dataCombatant('beta.json', '贝塔')],
    });
    renderList();

    expect(container.textContent).toContain('已选角色 (2/无限制):');
    expect(container.textContent).toContain('阿尔法');
    expect(container.textContent).toContain('贝塔');
    expect(container.textContent).toContain('(魔法少女)');

    const moveDown = container.querySelector<HTMLButtonElement>('button[aria-label="下移 阿尔法"]');
    if (!moveDown) throw new Error('move button not found');
    act(() => moveDown.click());

    expect(useBattleStore.getState().combatants.map((item) => 'filename' in item ? item.filename : item.id))
      .toEqual(['beta.json', 'alpha.json']);
  });

  it('新建分队后可内联重命名，并把角色分配到分队', () => {
    useBattleStore.setState({
      combatants: [dataCombatant('alpha.json', '阿尔法')],
    });
    renderList();

    act(() => button('+ 新建分队').click());
    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="分队名称"]');
    if (!renameInput) throw new Error('team rename input not found');
    expect(useBattleStore.getState().teams.map((team) => team.name)).toEqual(['分队 1']);

    act(() => setValue(renameInput, '守护队'));
    act(() => {
      renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(useBattleStore.getState().teams.map((team) => team.name)).toEqual(['守护队']);

    const teamSelect = container.querySelector<HTMLSelectElement>('select[title="把角色加入/转移到该分队"]');
    if (!teamSelect) throw new Error('team member select not found');
    act(() => setValue(teamSelect, 'alpha.json'));

    expect(useBattleStore.getState().combatants[0]?.teamId).toBe(1);
    expect(container.textContent).toContain('未分队');
    expect(container.textContent).toContain('守护队');
  });

  it('重命名输入在折叠按钮外，点击输入与回车提交不会触发分队折叠', () => {
    useBattleStore.setState({
      combatants: [dataCombatant('alpha.json', '阿尔法')],
    });
    renderList();

    act(() => button('+ 新建分队').click());
    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="分队名称"]');
    if (!renameInput) throw new Error('team rename input not found');
    expect(container.textContent).toContain('暂无成员');

    // 点击输入框曾因嵌套在折叠 button 内冒泡触发折叠，导致队伍内容收起。
    act(() => renameInput.click());
    expect(container.textContent).toContain('暂无成员');

    act(() => setValue(renameInput, '守护队'));
    act(() => {
      renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(useBattleStore.getState().teams.map((team) => team.name)).toEqual(['守护队']);
    expect(container.textContent).toContain('暂无成员');
  });

  it('分队成员可移回未分队，删除分队需确认', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    useBattleStore.setState({
      combatants: [dataCombatant('alpha.json', '阿尔法', 1)],
      teams: [{ id: 1, name: '守护队', isCollapsed: false }],
    });
    renderList();

    const moveBackSelect = container.querySelector<HTMLSelectElement>('select[title="把某个已分队的角色移回未分队"]');
    if (!moveBackSelect) throw new Error('move-back select not found');
    act(() => setValue(moveBackSelect, 'alpha.json'));
    expect(useBattleStore.getState().combatants[0]?.teamId).toBeUndefined();

    act(() => button('删除').click());
    expect(globalThis.confirm).toHaveBeenCalled();
    expect(useBattleStore.getState().teams).toEqual([]);
  });

  it('行动引导编辑写入 store', () => {
    useBattleStore.setState({
      combatants: [dataCombatant('alpha.json', '阿尔法')],
    });
    renderList();

    const row = [...container.querySelectorAll('.group')]
      .find((candidate) => candidate.textContent?.includes('阿尔法'));
    if (!row) throw new Error('row not found');
    const actionButton = [...row.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '行动');
    if (!(actionButton instanceof HTMLButtonElement)) throw new Error('guidance button not found');
    act(() => actionButton.click());

    const guidance = container.querySelector<HTMLTextAreaElement>('textarea[id="arena-roster-guidance-alpha.json"]');
    if (!guidance) throw new Error('guidance textarea not found');
    act(() => setValue(guidance, '优先保护同伴'));

    expect(useBattleStore.getState().combatants[0]?.characterGuidance).toBe('优先保护同伴');
  });

  it('随机占位、移除与清空列表保持单人能力', () => {
    useBattleStore.setState({
      combatants: [dataCombatant('alpha.json', '阿尔法')],
      teams: [{ id: 1, name: '守护队', isCollapsed: false }],
    });
    renderList();

    act(() => button('+ 添加随机残兽').click());
    const identifiers = useBattleStore.getState().combatants.map((item) => 'id' in item ? item.id : item.filename);
    expect(identifiers[0]).toBe('alpha.json');
    expect(identifiers[1]).toMatch(/^random-canshou-/);

    const removeButton = container.querySelector<HTMLButtonElement>('button[aria-label="移除 阿尔法"]');
    if (!removeButton) throw new Error('remove button not found');
    act(() => removeButton.click());
    expect(useBattleStore.getState().combatants).toHaveLength(1);
    expect(useBattleStore.getState().combatants[0] && 'id' in useBattleStore.getState().combatants[0]!).toBe(true);

    act(() => button('清空列表').click());
    expect(useBattleStore.getState().combatants).toEqual([]);
    expect(useBattleStore.getState().teams).toEqual([]);
  });
});
