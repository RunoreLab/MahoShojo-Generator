// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ArenaRosterSection, type ArenaRosterSectionModel } from '../src/arena';
const createModel = (): ArenaRosterSectionModel => ({
  disabled: false, combatantCountLabel: '0/32', combatantCapReached: false, rows: [], teams: [{ key: 'team', name: '原名', memberKeys: [], collapsed: false }],
  capabilities: { reorderRows: false, removeRows: false, editGuidance: false, ranking: false, addPlaceholders: false, clearRoster: false, createTeams: false, renameTeams: true, removeTeams: false, reorderTeams: false, assignTeamMembers: false, reorderTeamMembers: false, collapseTeams: false },
  actions: { moveRow: vi.fn(), removeRow: vi.fn(), setGuidance: vi.fn(), addPlaceholder: vi.fn(), clearRoster: vi.fn(), createTeam: () => 'team', renameTeam: vi.fn(), removeTeam: vi.fn(), moveTeam: vi.fn(), assignCombatant: vi.fn(), moveTeamMember: vi.fn(), toggleTeamCollapsed: vi.fn() },
});
const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
describe('team rename transient dirty port', () => {
  it('notifies only changed uncommitted text, clears on undo, Escape, commit and unmount', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const model = createModel(); const dirty = vi.fn();
    const rename = async () => {
      await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '改名')!.click());
      return container.querySelector<HTMLInputElement>('input[aria-label="分队名称"]')!;
    };
    try {
      await act(async () => root.render(<ArenaRosterSection model={model} emptyLabel="无角色" onDirtyChange={dirty} />));
      expect(dirty).toHaveBeenLastCalledWith(false);
      let input = await rename(); expect(dirty).toHaveBeenLastCalledWith(false);
      await act(async () => setValue(input, '新名')); expect(dirty).toHaveBeenLastCalledWith(true);
      await act(async () => setValue(input, '原名')); expect(dirty).toHaveBeenLastCalledWith(false);
      await act(async () => setValue(input, '取消')); expect(dirty).toHaveBeenLastCalledWith(true);
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(dirty).toHaveBeenLastCalledWith(false); expect(model.actions.renameTeam).not.toHaveBeenCalled();
      input = await rename(); await act(async () => setValue(input, '提交'));
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(model.actions.renameTeam).toHaveBeenCalledWith('team', '提交'); expect(dirty).toHaveBeenLastCalledWith(false);
      input = await rename(); await act(async () => setValue(input, '未提交')); expect(dirty).toHaveBeenLastCalledWith(true);
    } finally { await act(async () => root.unmount()); container.remove(); }
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('follows the current controlled team name and clears when that editor disappears', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const model = createModel(); const dirty = vi.fn();
    try {
      await act(async () => root.render(<ArenaRosterSection model={model} emptyLabel="无角色" onDirtyChange={dirty} />));
      await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '改名')!.click());
      const input = container.querySelector<HTMLInputElement>('input[aria-label="分队名称"]')!;
      await act(async () => setValue(input, '同步名')); expect(dirty).toHaveBeenLastCalledWith(true);
      await act(async () => root.render(<ArenaRosterSection model={{ ...model, teams: [{ ...model.teams[0], name: '同步名' }] }} emptyLabel="无角色" onDirtyChange={dirty} />));
      expect(dirty).toHaveBeenLastCalledWith(false);
      await act(async () => setValue(input, '待改')); expect(dirty).toHaveBeenLastCalledWith(true);
      await act(async () => root.render(<ArenaRosterSection model={{ ...model, teams: [] }} emptyLabel="无角色" onDirtyChange={dirty} />));
      expect(dirty).toHaveBeenLastCalledWith(false); expect(container.querySelector('input[aria-label="分队名称"]')).toBeNull();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
