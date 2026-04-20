import { describe, expect, test } from 'bun:test';

import {
  buildCharacterManagerPageDraftPayload,
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
