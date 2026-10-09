import { FREE_GENERATION_SCHEMA_IDS, type FreeSchemaId } from '@mahoshojo/ai-core/free-generation';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import {
  DesktopGenerationSession,
  parseStoredGenerationDraft,
  type GenerationDraftStorage,
  type GenerationSessionFamily,
  type GenerationSessionState,
  type StoredGenerationDraft,
} from '../generation/session';
import type { GenerationExecutor } from '../generation/session';
import {
  executeFreeGeneration,
  validateFreeCard,
  type FreeCardKind,
  type FreeGenerationInput,
  type FreeGenerationIntent,
  type FreeGenerationOutcome,
  type FreeResultCardData,
} from './generation';

export const FREE_DRAFT_KEY = 'mahoshojo.desktop.free.draft.v1';

/**
 * /free 草稿（D5.1-G2）：字段名与 Web `LOCAL_STORAGE_KEY` 持久化面一致
 * （schemaId/generationMode/prompt/selectedLanguage + 两个抽屉开关）。
 * 附件不入草稿——与 Web 同口径（附件是会话态，不落盘）。
 */
export interface FreeDraft {
  schemaId: FreeSchemaId;
  generationMode: 'stream' | 'non-stream';
  prompt: string;
  selectedLanguage: string;
  showFieldGuide?: boolean;
  showLanguageSection?: boolean;
}

export type FreeDraftStorage = GenerationDraftStorage;

export type FreeSessionState = GenerationSessionState<FreeDraft, FreeCardKind>;

export type FreeExecutor = GenerationExecutor<FreeGenerationInput, FreeGenerationIntent, FreeCardKind>;

export const FREE_DRAFT_DEFAULT_LANGUAGE = 'zh-CN';

/** 页面原初始化；设置首写复用，false 沿原 schema 规范化为缺省。 */
export const createEmptyFreeDraftDocument = () => ({
  version: 1 as const,
  schemaId: 'general' as FreeSchemaId,
  generationMode: 'non-stream' as const,
  prompt: '',
  selectedLanguage: FREE_DRAFT_DEFAULT_LANGUAGE,
});

type StoredFreeDraft = StoredGenerationDraft<FreeDraft, FreeCardKind>;

const isSchemaId = (value: unknown): value is FreeSchemaId =>
  (FREE_GENERATION_SCHEMA_IDS as readonly string[]).includes(value as string);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const trimmedOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const FREE_SESSION_FAMILY: GenerationSessionFamily<
  FreeDraft,
  FreeGenerationInput,
  FreeGenerationIntent,
  FreeCardKind
> = {
  draftKey: FREE_DRAFT_KEY,
  defaultCardKind: 'general',
  parseDraftFields: (value) => {
    if (!isSchemaId(value.schemaId)
      || (value.generationMode !== 'stream' && value.generationMode !== 'non-stream')
      || typeof value.prompt !== 'string'
      || typeof value.selectedLanguage !== 'string') {
      throw new Error('草稿版本不受支持或内容损坏');
    }
    const draft: FreeDraft = {
      schemaId: value.schemaId,
      generationMode: value.generationMode,
      prompt: value.prompt,
      selectedLanguage: value.selectedLanguage,
    };
    if (value.showFieldGuide === true) draft.showFieldGuide = true;
    if (value.showLanguageSection === true) draft.showLanguageSection = true;
    return draft;
  },
  normalizeStoredCardKind: (value) => (isSchemaId(value) ? value : 'general'),
  isResidueDraft: (draft) => {
    if (draft.prompt.trim() !== '') return false;
    const output = draft.output;
    return output === undefined
      || (output.phase === 'idle' && output.card === null && output.rawText === '');
  },
  validateCard: validateFreeCard,
  cardTypeOf: (kind) => (kind === 'scenario' || kind === 'general-scenario' ? 'scenario' : 'character'),
  titleOf: (kind, card) => {
    switch (kind) {
      case 'magical-girl': return trimmedOr(card.codename, trimmedOr(card.name, '未命名魔法少女'));
      case 'canshou': return trimmedOr(card.name, '未命名残兽');
      case 'scenario': return trimmedOr(card.title, trimmedOr(card.name, '未命名情景'));
      case 'general-scenario': return trimmedOr(card.title, '未命名情景');
      default: return trimmedOr(card.name, '未命名角色');
    }
  },
  // 自由生成永不签名：无签名通路可归属。
  signatureFrom: () => undefined,
  stripSignature: (card) => {
    delete card.signature;
    if (isRecord(card.metadata)) delete (card.metadata as Record<string, unknown>).signature;
  },
  executeGeneration: executeFreeGeneration,
};

/** 只校验、不采用规范化输出；设置修改须保留原文档的未知字段与结果。 */
export const validateFreeDraftDocument = (raw: string): void => {
  parseStoredGenerationDraft(raw, FREE_SESSION_FAMILY);
};

/**
 * /free 会话：草稿闸门、取消/uncertain 投影与保存 provenance 走
 * `DesktopGenerationSession` 通用核；本类只注入自由生成家族参数。
 */
export class FreeSession extends DesktopGenerationSession<
  FreeDraft,
  FreeGenerationInput,
  FreeGenerationIntent,
  FreeCardKind
> {
  constructor(dependencies: {
    storage: FreeDraftStorage;
    repository: CardRepository;
    initialDraft: FreeDraft;
    execute?: FreeExecutor;
    requestId?: () => string;
  }) {
    super(FREE_SESSION_FAMILY, dependencies);
  }
}

export type { FreeCardKind, FreeGenerationInput, FreeGenerationIntent, FreeGenerationOutcome, FreeResultCardData, StoredFreeDraft };
