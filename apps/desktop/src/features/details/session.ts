import type { CardRepository } from '@mahoshojo/local-library/repository';
import {
  executeDetailsGeneration,
  normalizeMagicalGirlDetailsResultCard,
  type DetailsGenerationIntent,
} from './generation';
import { BUILTIN_DEFAULT_QUESTIONNAIRE_ID } from './questionnaire';
import {
  QuestionnaireGenerationSession,
  type QuestionnaireDraft,
  type QuestionnaireDraftStorage,
  type QuestionnaireExecutor,
  type QuestionnaireSessionFamily,
  type QuestionnaireSessionState,
} from '../questionnaire/session';

export const DETAILS_DRAFT_KEY = 'mahoshojo.desktop.details.draft.v1';

export type DetailsDraftStorage = QuestionnaireDraftStorage;
export type DetailsDraft = QuestionnaireDraft;
export type DetailsSessionState = QuestionnaireSessionState<'magical-girl'>;

const DETAILS_SESSION_FAMILY: QuestionnaireSessionFamily<'magical-girl', DetailsGenerationIntent> = {
  draftKey: DETAILS_DRAFT_KEY,
  builtinQuestionnaireId: BUILTIN_DEFAULT_QUESTIONNAIRE_ID,
  draftFallbackKind: 'magical-girl',
  structuredCardKind: 'magical-girl',
  structuredTitleField: 'codename',
  structuredTitleFallback: '未命名魔法少女',
  normalizeStructuredCard: normalizeMagicalGirlDetailsResultCard,
  executeGeneration: executeDetailsGeneration,
};

/**
 * /details 会话（D5.1-G1 泛化）：草稿门禁、取消/uncertain 投影与保存
 * provenance 的通用实现上移至 `features/questionnaire/session.ts`；
 * 本类只注入 magical-girl 家族参数，API 与既有导出面保持兼容。
 */
export class DetailsSession extends QuestionnaireGenerationSession<'magical-girl', DetailsGenerationIntent> {
  constructor(dependencies: {
    storage: DetailsDraftStorage;
    repository: CardRepository;
    initialDraft: DetailsDraft;
    execute?: QuestionnaireExecutor<DetailsGenerationIntent, 'magical-girl'>;
    requestId?: () => string;
  }) {
    super(DETAILS_SESSION_FAMILY, dependencies);
  }
}
