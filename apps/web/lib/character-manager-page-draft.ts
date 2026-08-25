import { clearPageDraft, readPageDraft, type StoredPageDraft, writePageDraft } from '@/lib/page-draft-storage';
import type { InferableTemplate } from '@/lib/data-card-converter';

export const CHARACTER_MANAGER_PAGE_DRAFT_KEY = 'mahoshojo.character-manager.page-draft.v1';
export const CHARACTER_MANAGER_PAGE_DRAFT_VERSION = 1;
export const CHARACTER_MANAGER_PAGE_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type CharacterManagerPageDraftPayload = {
  pastedJson: string;
  characterData: Record<string, unknown> | null;
  originalData: Record<string, unknown> | null;
  isNative: boolean;
  selectedTemplate: InferableTemplate;
};

export type RestoredCharacterManagerPageDraft = CharacterManagerPageDraftPayload & {
  mode: 'editor' | 'paste';
};

type CharacterManagerPageDraftInput = {
  pastedJson: string;
  characterData: Record<string, unknown> | null;
  originalData: Record<string, unknown> | null;
  isNative: boolean;
  selectedTemplate: InferableTemplate;
};

const ALLOWED_TEMPLATES = new Set<InferableTemplate>([
  'unknown',
  'magical-girl',
  'canshou',
  'general',
  'scenario',
  'general-scenario',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeSelectedTemplate = (value: unknown): InferableTemplate =>
  typeof value === 'string' && ALLOWED_TEMPLATES.has(value as InferableTemplate)
    ? (value as InferableTemplate)
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

export const clearCharacterManagerPageDraft = () => {
  clearPageDraft(CHARACTER_MANAGER_PAGE_DRAFT_KEY);
};

export const readCharacterManagerPageDraft = (): StoredPageDraft<CharacterManagerPageDraftPayload> | null => {
  const stored = readPageDraft<CharacterManagerPageDraftPayload>(CHARACTER_MANAGER_PAGE_DRAFT_KEY, {
    version: CHARACTER_MANAGER_PAGE_DRAFT_VERSION,
    ttlMs: CHARACTER_MANAGER_PAGE_DRAFT_TTL_MS,
  });

  if (!stored) return null;

  const payload = buildCharacterManagerPageDraftPayload(stored.payload);
  if (!payload) {
    clearCharacterManagerPageDraft();
    return null;
  }

  return {
    ...stored,
    payload,
  };
};

export const writeCharacterManagerPageDraft = (
  input: CharacterManagerPageDraftInput,
): StoredPageDraft<CharacterManagerPageDraftPayload> | null => {
  const payload = buildCharacterManagerPageDraftPayload(input);
  if (!payload) {
    clearCharacterManagerPageDraft();
    return null;
  }

  return writePageDraft(CHARACTER_MANAGER_PAGE_DRAFT_KEY, payload, {
    version: CHARACTER_MANAGER_PAGE_DRAFT_VERSION,
  });
};
