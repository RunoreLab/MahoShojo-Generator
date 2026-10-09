// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_CHARACTER_MANAGER_DRAFT_KEY as key, clearDesktopCharacterManagerDraft, readDesktopCharacterManagerDraftState, writeDesktopCharacterManagerDraft } from '../src/features/character-manager/draft-persistence';

const current = { pastedJson: '', draft: { cardType: 'character' as const, title: '新稿', data: { name: '新稿', future: [1] }, originalId: null, originalData: null } };
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe('Desktop 角色管理坏草稿保留', () => {
  it.each(['{broken', JSON.stringify({ version: 98, updatedAt: Date.now(), payload: {} }), JSON.stringify({ version: 1, updatedAt: 1, payload: current }), JSON.stringify({ version: 1, updatedAt: Date.now(), payload: {} })])('读取和自动保存均不覆盖原文 %s', (raw) => {
    localStorage.setItem(key, raw);
    expect(readDesktopCharacterManagerDraftState().kind).toBe('blocked');
    expect(writeDesktopCharacterManagerDraft(current).kind).toBe('blocked');
    expect(writeDesktopCharacterManagerDraft({ pastedJson: '', draft: null }).kind).toBe('blocked');
    expect(localStorage.getItem(key)).toBe(raw);
    expect(clearDesktopCharacterManagerDraft()).toBe(true);
    expect(writeDesktopCharacterManagerDraft(current).kind).toBe('written');
    expect(readDesktopCharacterManagerDraftState().kind).toBe('ready');
  });
  it('读取或清除失败保留原文，不能自动恢复写入', () => {
    localStorage.setItem(key, '{keep');
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readDesktopCharacterManagerDraftState()).toEqual({ kind: 'blocked', reason: 'read-failed' });
    expect(writeDesktopCharacterManagerDraft(current).kind).toBe('blocked');
    read.mockRestore();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(clearDesktopCharacterManagerDraft()).toBe(false);
    expect(localStorage.getItem(key)).toBe('{keep');
    expect(writeDesktopCharacterManagerDraft(current).kind).toBe('blocked');
  });
});
