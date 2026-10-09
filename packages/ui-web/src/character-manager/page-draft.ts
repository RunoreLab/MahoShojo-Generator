import type { InferableDataCardTemplate } from '@mahoshojo/domain/data-cards';

import {
  clearPageDraft,
  readPageDraftState,
  type PageDraftReadState,
  writePageDraft,
  type StoredPageDraft,
} from '../client/pageDraft';

export const CHARACTER_MANAGER_PAGE_DRAFT_KEY = 'mahoshojo.character-manager.page-draft.v1';
export const CHARACTER_MANAGER_PAGE_DRAFT_VERSION = 1;
export const CHARACTER_MANAGER_PAGE_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type CharacterManagerPageDraftPayload = {
  pastedJson: string;
  characterData: Record<string, unknown> | null;
  originalData: Record<string, unknown> | null;
  isNative: boolean;
  selectedTemplate: InferableDataCardTemplate;
};

export type RestoredCharacterManagerPageDraft = CharacterManagerPageDraftPayload & {
  mode: 'editor' | 'paste';
};

export type CharacterManagerPageDraftInput = {
  pastedJson: string;
  characterData: Record<string, unknown> | null;
  originalData: Record<string, unknown> | null;
  isNative: boolean;
  selectedTemplate: InferableDataCardTemplate;
};

const ALLOWED_TEMPLATES = new Set<InferableDataCardTemplate>([
  'unknown',
  'magical-girl',
  'canshou',
  'general',
  'scenario',
  'general-scenario',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeSelectedTemplate = (value: unknown): InferableDataCardTemplate =>
  typeof value === 'string' && ALLOWED_TEMPLATES.has(value as InferableDataCardTemplate)
    ? (value as InferableDataCardTemplate)
    : 'unknown';

const normalizeCharacterManagerDraftPayload = (input: unknown): CharacterManagerPageDraftPayload | null => {
  if (!isPlainObject(input)) return null;

  const pastedJson = typeof input.pastedJson === 'string' ? input.pastedJson : '';
  const characterData = isPlainObject(input.characterData) ? input.characterData : null;
  const originalData = isPlainObject(input.originalData) ? input.originalData : null;
  const isNative = input.isNative === true;
  const selectedTemplate = normalizeSelectedTemplate(input.selectedTemplate);

  const hasPasteDraft = pastedJson.trim().length > 0;
  const hasEditorDraft = characterData !== null && originalData !== null;

  if (!hasPasteDraft && !hasEditorDraft) {
    return null;
  }

  return {
    pastedJson,
    characterData: hasEditorDraft ? characterData : null,
    originalData: hasEditorDraft ? originalData : null,
    isNative: hasEditorDraft ? isNative : false,
    selectedTemplate: hasEditorDraft ? selectedTemplate : 'unknown',
  };
};

export const buildCharacterManagerPageDraftPayload = (
  input: CharacterManagerPageDraftInput,
): CharacterManagerPageDraftPayload | null => normalizeCharacterManagerDraftPayload(input);

export const restoreCharacterManagerPageDraft = (input: unknown): RestoredCharacterManagerPageDraft | null => {
  const payload = normalizeCharacterManagerDraftPayload(input);
  if (!payload) return null;

  if (payload.characterData && payload.originalData) {
    return {
      mode: 'editor',
      ...payload,
    };
  }

  return {
    mode: 'paste',
    ...payload,
  };
};

export const clearCharacterManagerPageDraft = (): boolean =>
  clearPageDraft(CHARACTER_MANAGER_PAGE_DRAFT_KEY);

export const readCharacterManagerPageDraftState = (): PageDraftReadState<CharacterManagerPageDraftPayload> => {
  const state = readPageDraftState<unknown>(CHARACTER_MANAGER_PAGE_DRAFT_KEY, {
    version: CHARACTER_MANAGER_PAGE_DRAFT_VERSION,
    ttlMs: CHARACTER_MANAGER_PAGE_DRAFT_TTL_MS,
  });
  if (state.kind !== 'ready') return state;
  const raw = state.stored.payload;
  if (isPlainObject(raw) && (
    ('pastedJson' in raw && typeof raw.pastedJson !== 'string')
    || ((raw.characterData != null || raw.originalData != null) && !(isPlainObject(raw.characterData) && isPlainObject(raw.originalData)))
  )) return { kind: 'blocked', reason: 'invalid' };
  const payload = normalizeCharacterManagerDraftPayload(raw);
  if (!payload) return { kind: 'blocked', reason: 'invalid' };
  return { kind: 'ready', stored: { ...state.stored, payload } };
};

/** 兼容原返回形状，但不再因读取失败而删除草稿。 */
export const readCharacterManagerPageDraft = (): StoredPageDraft<CharacterManagerPageDraftPayload> | null => {
  const state = readCharacterManagerPageDraftState();
  return state.kind === 'ready' ? state.stored : null;
};

export const writeCharacterManagerPageDraft = (
  input: CharacterManagerPageDraftInput,
): StoredPageDraft<CharacterManagerPageDraftPayload> | null => {
  if (readCharacterManagerPageDraftState().kind === 'blocked') return null;
  const payload = buildCharacterManagerPageDraftPayload(input);
  if (!payload) {
    clearCharacterManagerPageDraft();
    return null;
  }

  return writePageDraft(CHARACTER_MANAGER_PAGE_DRAFT_KEY, payload, {
    version: CHARACTER_MANAGER_PAGE_DRAFT_VERSION,
  });
};
