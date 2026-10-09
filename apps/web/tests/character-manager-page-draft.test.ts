import { describe, expect, test } from 'vitest';

import {
  buildCharacterManagerPageDraftPayload,
  CHARACTER_MANAGER_PAGE_DRAFT_KEY,
  readCharacterManagerPageDraftState,
  writeCharacterManagerPageDraft,
  clearCharacterManagerPageDraft,
  restoreCharacterManagerPageDraft,
} from '@/lib/character-manager-page-draft';

describe('character manager page draft helpers', () => {
  test('builds editor draft payload with editing context', () => {
    const payload = buildCharacterManagerPageDraftPayload({
      pastedJson: '{"name":"雾灯"}',
      characterData: { name: '雾灯', templateId: 'general' },
      originalData: { name: '雾灯', templateId: 'general' },
      isNative: true,
      selectedTemplate: 'general',
    });

    expect(payload).toEqual({
      pastedJson: '{"name":"雾灯"}',
      characterData: { name: '雾灯', templateId: 'general' },
      originalData: { name: '雾灯', templateId: 'general' },
      isNative: true,
      selectedTemplate: 'general',
    });
  });

  test('returns null when there is neither paste draft nor editor draft', () => {
    expect(
      buildCharacterManagerPageDraftPayload({
        pastedJson: '   ',
        characterData: null,
        originalData: null,
        isNative: false,
        selectedTemplate: 'unknown',
      }),
    ).toBeNull();
  });

  test('restores editor mode first when editor draft exists', () => {
    const restored = restoreCharacterManagerPageDraft({
      pastedJson: '{"name":"旧粘贴"}',
      characterData: { name: '雾灯', templateId: 'general' },
      originalData: { name: '雾灯', templateId: 'general' },
      isNative: true,
      selectedTemplate: 'general',
      message: { type: 'info', text: '不应恢复' },
    });

    expect(restored).toEqual({
      mode: 'editor',
      pastedJson: '{"name":"旧粘贴"}',
      characterData: { name: '雾灯', templateId: 'general' },
      originalData: { name: '雾灯', templateId: 'general' },
      isNative: true,
      selectedTemplate: 'general',
    });
  });

  test('falls back to paste mode when only paste draft exists', () => {
    const restored = restoreCharacterManagerPageDraft({
      pastedJson: '{"title":"废都决战"}',
      characterData: null,
      originalData: null,
      isNative: false,
      selectedTemplate: 'unknown',
    });

    expect(restored).toEqual({
      mode: 'paste',
      pastedJson: '{"title":"废都决战"}',
      characterData: null,
      originalData: null,
      isNative: false,
      selectedTemplate: 'unknown',
    });
  });

  test('returns null for broken payloads', () => {
    expect(restoreCharacterManagerPageDraft(null)).toBeNull();
    expect(restoreCharacterManagerPageDraft('broken')).toBeNull();
  });
});


describe('Web 角色管理非破坏草稿持久化', () => {
  test.each(['{broken', JSON.stringify({ version: 20, updatedAt: Date.now(), payload: {} }), JSON.stringify({ version: 1, updatedAt: 1, payload: {} }), JSON.stringify({ version: 1, updatedAt: Date.now(), payload: { pastedJson: 'keep', characterData: 'broken', originalData: {} } })])('自动保存与空态清理都保留原字节：%s', (raw) => {
    localStorage.setItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY, raw);
    expect(readCharacterManagerPageDraftState().kind).toBe('blocked');
    const input = { pastedJson: '新输入', characterData: null, originalData: null, isNative: false, selectedTemplate: 'unknown' as const };
    expect(writeCharacterManagerPageDraft(input)).toBeNull();
    expect(writeCharacterManagerPageDraft({ ...input, pastedJson: '' })).toBeNull();
    expect(localStorage.getItem(CHARACTER_MANAGER_PAGE_DRAFT_KEY)).toBe(raw);
    expect(clearCharacterManagerPageDraft()).toBe(true);
    expect(writeCharacterManagerPageDraft(input)).not.toBeNull();
    expect(readCharacterManagerPageDraftState().kind).toBe('ready');
    clearCharacterManagerPageDraft();
  });
});
