import { describe, expect, it } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { ADVANCED_ARENA_DRAFT_KEY, ARENA_DRAFT_KEY, DesktopArenaSession, createInitialArenaDraft } from '../src/features/arena/session';

const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const repository = {} as CardRepository;

describe('advanced Arena shares the execution owner without sharing a product draft', () => {
  it('creates, explicitly restores and clears only its own key', () => {
    const storage = memory();
    const battle = new DesktopArenaSession({ repository, storage });
    const arena = new DesktopArenaSession({ repository, storage, product: 'arena' });
    const base = createInitialArenaDraft();
    battle.updateDraft({ ...base, settings: { ...base.settings, userGuidance: '简洁工作稿' } });
    arena.updateDraft({ ...base, settings: { ...base.settings, userGuidance: '高级工作稿' } });
    const originalBattle = storage.values.get(ARENA_DRAFT_KEY);
    expect(originalBattle).toContain('简洁工作稿');
    expect(storage.values.get(ADVANCED_ARENA_DRAFT_KEY)).toContain('高级工作稿');
    battle.dispose(); arena.dispose();
    const reopened = new DesktopArenaSession({ repository, storage, product: 'arena' });
    expect(reopened.getSnapshot().pendingRestore).toBe(true);
    expect(reopened.getSnapshot().draft.settings.userGuidance).toBe('');
    reopened.restoreDraft();
    expect(reopened.getSnapshot().draft.settings.userGuidance).toBe('高级工作稿');
    reopened.discardDraft();
    expect(storage.values.has(ADVANCED_ARENA_DRAFT_KEY)).toBe(false);
    expect(storage.values.get(ARENA_DRAFT_KEY)).toBe(originalBattle);
    reopened.dispose();
  });
  it('does not fall back to or overwrite a corrupt sibling product draft', () => {
    const storage = memory(); storage.values.set(ARENA_DRAFT_KEY, '{broken');
    const arena = new DesktopArenaSession({ repository, storage, product: 'arena' });
    expect(arena.getSnapshot().pendingRestore).toBe(false);
    expect(arena.getSnapshot().draftError).toBeNull();
    arena.updateDraft(createInitialArenaDraft());
    expect(storage.values.get(ARENA_DRAFT_KEY)).toBe('{broken');
    const battle = new DesktopArenaSession({ repository, storage });
    expect(battle.getSnapshot().draftError).toContain('旧草稿无法读取');
    battle.discardDraft();
    expect(storage.values.has(ADVANCED_ARENA_DRAFT_KEY)).toBe(true);
    battle.dispose(); arena.dispose();
  });
});
