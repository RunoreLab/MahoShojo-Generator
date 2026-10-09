import type { CardRepository } from '@mahoshojo/local-library/repository';
import { mergeNarrativeHistoryText } from '@mahoshojo/domain/narrative-history-operations';
import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import {
  DesktopGenerationSession,
  type GenerationDraftStorage,
  type GenerationExecutor,
  type GenerationSessionFamily,
  type GenerationSessionState,
  type StoredGenerationDraft,
} from '../generation/session';
import {
  executeSublimationGeneration,
  isSublimationCardKind,
  stripSublimationSignature,
  validateSublimationCard,
  type SublimationCardKind,
  type SublimationGenerationInput,
  type SublimationGenerationIntent,
} from './generation';

export const SUBLIMATION_DRAFT_KEY = 'mahoshojo.desktop.sublimation.draft.v1';
export interface SublimationDraft extends Omit<SublimationGenerationInput, 'originalData' | 'language' | 'defaultQuestions'> {
  originalData: Record<string, unknown> | null;
  selectedLanguage: string;
  generationMode: 'stream' | 'non-stream';
  isAdvancedVisible?: boolean;
  selectedHistoryReference?: string;
  sourceLabel?: string;
}
export type SublimationDraftStorage = GenerationDraftStorage;
export type SublimationSessionState = GenerationSessionState<SublimationDraft, SublimationCardKind>;
export type SublimationExecutor = GenerationExecutor<SublimationGenerationInput, SublimationGenerationIntent, SublimationCardKind>;
export type StoredSublimationDraft = StoredGenerationDraft<SublimationDraft, SublimationCardKind>;
export const createInitialSublimationDraft = (): SublimationDraft => ({
  originalData: null,
  selectedHistoryReference: '',
  sourceLabel: '',
  targetTemplate: 'general',
  selectedLanguage: 'zh-CN',
  generationMode: 'non-stream',
  fieldsToPreserve: [],
  userGuidance: '',
  narrativeHistory: '',
  loreText: '',
  allowReshapeNames: false,
  isDowngrade: false,
  readArenaHistory: true,
  writeArenaHistory: true,
  readCurrentState: true,
  writeCurrentState: true,
  arenaHistoryRetentionStrategy: 'keep-sublimation-only',
});
export const buildSublimationInput = (draft: SublimationDraft): SublimationGenerationInput => {
  if (draft.originalData === null) throw new Error('请先选择原始数据卡。');
  const { selectedLanguage, generationMode: _mode, isAdvancedVisible: _advanced, selectedHistoryReference, sourceLabel: _sourceLabel, ...fields } = draft;
  return { ...fields, originalData: draft.originalData, language: selectedLanguage, narrativeHistory: mergeNarrativeHistoryText(selectedHistoryReference, draft.narrativeHistory) };
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const SUBLIMATION_SESSION_FAMILY: GenerationSessionFamily<SublimationDraft, SublimationGenerationInput, SublimationGenerationIntent, SublimationCardKind> = {
  draftKey: SUBLIMATION_DRAFT_KEY,
  defaultCardKind: 'general',
  parseDraftFields: (value) => {
    if ((value.originalData !== null && (!record(value.originalData) || !SafeJsonValueSchema.safeParse(value.originalData).success))
      || !isSublimationCardKind(value.targetTemplate)
      || (value.sourceTemplate !== undefined && !['magical-girl', 'canshou', 'general', 'scenario', 'general-scenario', 'unknown'].includes(String(value.sourceTemplate)))
      || !['stream', 'non-stream'].includes(String(value.generationMode))
      || !['selectedLanguage', 'userGuidance', 'narrativeHistory', 'loreText'].every((key) => typeof value[key] === 'string')
      || !['readArenaHistory', 'writeArenaHistory', 'readCurrentState', 'writeCurrentState', 'allowReshapeNames'].every((key) => typeof value[key] === 'boolean')
      || !Array.isArray(value.fieldsToPreserve) || !value.fieldsToPreserve.every((field) => typeof field === 'string')
      || !['keep-all', 'keep-sublimation-only', 'reset-all'].includes(String(value.arenaHistoryRetentionStrategy))
      || (value.selectedHistoryReference !== undefined && typeof value.selectedHistoryReference !== 'string')
      || (value.sourceLabel !== undefined && typeof value.sourceLabel !== 'string')
      || (value.isDowngrade !== undefined && typeof value.isDowngrade !== 'boolean')) throw new Error('草稿版本不受支持或内容损坏');
    const keys = Object.keys(createInitialSublimationDraft());
    const fields = Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, clone(value[key])]));
    if (value.sourceTemplate !== undefined) fields.sourceTemplate = value.sourceTemplate;
    if (value.isAdvancedVisible === true) fields.isAdvancedVisible = true;
    return fields as unknown as SublimationDraft;
  },
  normalizeStoredCardKind: (value) => isSublimationCardKind(value) ? value : 'general',
  isResidueDraft: (draft) => draft.originalData === null && !draft.userGuidance.trim()
    && !draft.selectedHistoryReference?.trim() && !draft.narrativeHistory.trim() && !draft.loreText.trim()
    && (draft.output === undefined || (draft.output.phase === 'idle' && draft.output.card === null && draft.output.rawText === '')),
  validateCard: validateSublimationCard,
  cardTypeOf: () => 'character',
  titleOf: (kind, card) => {
    const title = kind === 'magical-girl' ? card.codename : card.name;
    return typeof title === 'string' && title.trim() ? title.trim() : '未命名角色';
  },
  signatureFrom: (_kind, card) => typeof card.signature === 'string' && card.signature.trim() ? card.signature : undefined,
  stripSignature: stripSublimationSignature,
  executeGeneration: executeSublimationGeneration,
};

/** 草稿、取消、重复生成、墓碑、保存及签名来源均复用通用会话。 */
export class SublimationSession extends DesktopGenerationSession<SublimationDraft, SublimationGenerationInput, SublimationGenerationIntent, SublimationCardKind> {
  constructor(dependencies: {
    storage: SublimationDraftStorage;
    repository: CardRepository;
    initialDraft: SublimationDraft;
    execute?: SublimationExecutor;
    requestId?: () => string;
  }) { super(SUBLIMATION_SESSION_FAMILY, dependencies); }
}
export type { SublimationCardKind, SublimationGenerationInput, SublimationGenerationIntent, SublimationGenerationOutcome, SublimationResultCardData } from './generation';
