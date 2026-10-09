import type { CardRepository } from '@mahoshojo/local-library/repository';
import {
  executeCanshouGeneration,
  normalizeCanshouResultCard,
  type CanshouGenerationIntent,
} from './generation';
import { CANSHOU_DEFAULT_QUESTIONNAIRE_ID } from './questionnaire';
import {
  QuestionnaireGenerationSession,
  validateQuestionnaireDraftDocument,
  type QuestionnaireDraft,
  type QuestionnaireDraftStorage,
  type QuestionnaireExecutor,
  type QuestionnaireSessionFamily,
  type QuestionnaireSessionState,
} from '../questionnaire/session';

export const CANSHOU_DRAFT_KEY = 'mahoshojo.desktop.canshou.draft.v1';

export type CanshouDraftStorage = QuestionnaireDraftStorage;
export type CanshouDraft = QuestionnaireDraft;
export type CanshouSessionState = QuestionnaireSessionState<'canshou'>;

const CANSHOU_SESSION_FAMILY: QuestionnaireSessionFamily<'canshou', CanshouGenerationIntent> = {
  draftKey: CANSHOU_DRAFT_KEY,
  builtinQuestionnaireId: CANSHOU_DEFAULT_QUESTIONNAIRE_ID,
  draftFallbackKind: 'canshou',
  structuredCardKind: 'canshou',
  structuredTitleField: 'name',
  structuredTitleFallback: '未命名残兽',
  normalizeStructuredCard: normalizeCanshouResultCard,
  executeGeneration: executeCanshouGeneration,
};

export const validateCanshouDraftDocument = (raw: string): void => {
  validateQuestionnaireDraftDocument(raw, CANSHOU_SESSION_FAMILY);
};

/**
 * /canshou 会话：草稿门禁、取消/uncertain 投影与保存 provenance 与 /details
 * 共用 `QuestionnaireGenerationSession`；本类只注入残兽家族参数。
 */
export class CanshouSession extends QuestionnaireGenerationSession<'canshou', CanshouGenerationIntent> {
  constructor(dependencies: {
    storage: CanshouDraftStorage;
    repository: CardRepository;
    initialDraft: CanshouDraft;
    execute?: QuestionnaireExecutor<CanshouGenerationIntent, 'canshou'>;
    requestId?: () => string;
  }) {
    super(CANSHOU_SESSION_FAMILY, dependencies);
  }
}
