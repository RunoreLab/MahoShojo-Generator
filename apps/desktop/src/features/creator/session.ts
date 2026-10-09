import {
  CREATOR_TEMPLATE_IDS,
  type CreatorTemplateId,
} from '@mahoshojo/domain/creator/templates';
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
  createQuestionnaireDraftFieldsParser,
  QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE,
  type QuestionnaireDraft,
} from '../questionnaire/session';
import {
  executeCreatorGeneration,
  validateCreatorResultCard,
  type CreatorCardKind,
  type CreatorGenerationInput,
  type CreatorGenerationIntent,
  type CreatorGenerationOutcome,
  type CreatorResultCardData,
} from './generation';

export const CREATOR_DRAFT_KEY = 'mahoshojo.desktop.creator.draft.v1';

/** 页面初始规则选择（与 Web `CreatorPage` `selectedBuildRuleIds` 缺省同口径）。 */
export const CREATOR_DRAFT_DEFAULT_RULE_IDS: readonly string[] = ['arena-trpg-lite'];

/**
 * /creator 草稿（D5.1-G3）：在问卷族草稿面（answers/language/选择集/偏好）
 * 上叠加创作工房字段——模板、生成模式、自由补充说明与规则车卡编辑态。
 * 草稿是 Desktop 私有协议（Web 侧只持久化答案与规则选择偏好），字段名与
 * Web 对应状态同名以降低对读成本。
 */
export interface CreatorDraft extends QuestionnaireDraft {
  template: CreatorTemplateId;
  generationMode: 'stream' | 'non-stream';
  freeformBrief: string;
  /** 已选构建规则 preset id（去重后原序）。 */
  selectedRuleIds?: string[];
  /** 各规则的用户输入值（ruleId → 表单值）；默认输入不落草稿。 */
  ruleInputsById?: Record<string, Record<string, unknown>>;
  primaryRuleId?: string | null;
}


/** 页面真实初值；设置首写复用，Creator 默认流式且与 general 模板配对。 */
export const createInitialCreatorDraft = (): CreatorDraft => ({
  answers: {}, language: QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE,
  template: 'general', generationMode: 'stream', freeformBrief: '',
  selectedRuleIds: [...CREATOR_DRAFT_DEFAULT_RULE_IDS],
  primaryRuleId: CREATOR_DRAFT_DEFAULT_RULE_IDS[0] ?? null,
});
export const createEmptyCreatorDraftDocument = () => ({ version: 1 as const, ...createInitialCreatorDraft() });

export type CreatorDraftStorage = GenerationDraftStorage;

export type CreatorSessionState = GenerationSessionState<CreatorDraft, CreatorCardKind>;

export type CreatorExecutor = GenerationExecutor<
  CreatorGenerationInput,
  CreatorGenerationIntent,
  CreatorCardKind
>;

type StoredCreatorDraft = StoredGenerationDraft<CreatorDraft, CreatorCardKind>;

const CREATOR_CARD_KINDS: readonly CreatorCardKind[] = [
  'magical-girl',
  'canshou',
  'general',
  'general-scenario',
];

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const trimmedOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

/** 草稿字段解析：先定模板（决定选择集归一化兜底 kind），再走问卷公共面。 */
const parseDraftFields = (value: Record<string, unknown>): CreatorDraft => {
  if (typeof value.template !== 'string'
    || !(CREATOR_TEMPLATE_IDS as readonly string[]).includes(value.template)
    || (value.generationMode !== 'stream' && value.generationMode !== 'non-stream')
    || typeof value.freeformBrief !== 'string') {
    throw new Error('草稿版本不受支持或内容损坏');
  }
  const template = value.template as CreatorTemplateId;
  // 模板决定问卷归一化兜底 kind：canshou 模板下未声明 kind 的问卷按残兽族
  // 解析（与 Web `questionnaireFallbackKind` 推导一致）。
  const base = createQuestionnaireDraftFieldsParser(
    template === 'canshou' ? 'canshou' : 'magical-girl',
  )(value);
  // Creator 的设置手术与页面恢复采用同一合法性判断；枚举沿问卷 parser
  // 认可的值，不另写一份列表。缺失/false 仍合法，非法显式值保留原文。
  if ((value.imageSaveMode !== undefined && value.imageSaveMode !== base.imageSaveMode)
    || (value.jsonSaveMode !== undefined && value.jsonSaveMode !== base.jsonSaveMode)
    || (value.showDetails !== undefined && typeof value.showDetails !== 'boolean')
    || (value.allowMultipleQuestionnaires !== undefined && typeof value.allowMultipleQuestionnaires !== 'boolean')) {
    throw new Error('草稿偏好损坏');
  }
  const draft: CreatorDraft = {
    ...base,
    template,
    generationMode: value.generationMode,
    freeformBrief: value.freeformBrief,
  };
  // Creator 允许只用自由说明/规则；显式空选择不能当成旧草稿缺字段而回填默认问卷。
  if (Array.isArray(value.questionnaireSelections) && value.questionnaireSelections.length === 0) {
    draft.questionnaireSelections = [];
  }
  if (Array.isArray(value.selectedRuleIds)
    && value.selectedRuleIds.every((id) => typeof id === 'string')) {
    draft.selectedRuleIds = [...new Set(value.selectedRuleIds)];
  }
  if (object(value.ruleInputsById)
    && Object.values(value.ruleInputsById).every(object)) {
    draft.ruleInputsById = value.ruleInputsById as Record<string, Record<string, unknown>>;
  }
  if (value.primaryRuleId === null) {
    draft.primaryRuleId = null;
  } else if (typeof value.primaryRuleId === 'string') {
    draft.primaryRuleId = value.primaryRuleId;
  }
  return draft;
};

/**
 * 「残余草稿」：自动写回的空壳——无非空回答、无自由说明、无生成结果或
 * 中断正文、选择集为单份 preset、规则选择恰为页面缺省。它由「进页面即
 * 注入默认选择并落盘」产生，不携带用户内容；直接静默应用而不走 pending
 * 门禁（与问卷族 `isResidueDraft` 同一口径，见 D5.1-P2-r1）。
 */
const isResidueDraft = (draft: StoredCreatorDraft): boolean => {
  if (Object.values(draft.answers).some((answer) => answer.trim() !== '')) return false;
  if (draft.freeformBrief.trim() !== '') return false;
  const output = draft.output;
  if (output !== undefined && (output.phase !== 'idle' || output.card !== null || output.rawText !== '')) return false;
  const selections = draft.questionnaireSelections ?? [];
  if (!(selections.length <= 1 && selections.every((selection) => selection.source === 'preset'))) return false;
  if (draft.selectedRuleIds !== undefined
    && (draft.selectedRuleIds.length !== CREATOR_DRAFT_DEFAULT_RULE_IDS.length
      || !draft.selectedRuleIds.every((id, index) => id === CREATOR_DRAFT_DEFAULT_RULE_IDS[index]))) {
    return false;
  }
  return draft.ruleInputsById === undefined || Object.keys(draft.ruleInputsById).length === 0;
};

/**
 * /creator 会话家族（D5.1-G3）：草稿字段解析、残余判定、卡校验/标题/类型、
 * 签名归属按创作工房注入；闸门、取消、uncertain 投影与保存 provenance
 * 走 `DesktopGenerationSession` 通用核。
 *
 * 签名不变量与问卷族一致：`signature` 字段只如实存在于结构化两族结果卡；
 * 可信级别由通用核按「本会话 hosted-json 新鲜响应」投影——草稿恢复或
 * 非 hosted-json 通路混入的签名一律 signature-unverified 或被剥除。
 */
const CREATOR_SESSION_FAMILY: GenerationSessionFamily<
  CreatorDraft,
  CreatorGenerationInput,
  CreatorGenerationIntent,
  CreatorCardKind
> = {
  draftKey: CREATOR_DRAFT_KEY,
  defaultCardKind: 'magical-girl',
  parseDraftFields,
  normalizeStoredCardKind: (value) =>
    (CREATOR_CARD_KINDS as readonly string[]).includes(value as string)
      ? (value as CreatorCardKind)
      : 'magical-girl',
  isResidueDraft,
  validateCard: validateCreatorResultCard,
  cardTypeOf: (kind) => (kind === 'general-scenario' ? 'scenario' : 'character'),
  titleOf: (kind, card) => {
    switch (kind) {
      case 'magical-girl':
        return trimmedOr(card.codename, trimmedOr(card.name, '未命名魔法少女'));
      case 'canshou':
        return trimmedOr(card.name, '未命名残兽');
      case 'general-scenario':
        return trimmedOr(card.title, '未命名情景');
      default:
        return trimmedOr(card.name, trimmedOr(card.codename, '未命名角色'));
    }
  },
  // 签名只可能存在于 hosted-json 结构化两族结果；流式通用卡无签名字段可记。
  signatureFrom: (kind, card) =>
    (kind === 'magical-girl' || kind === 'canshou')
      && typeof card.signature === 'string' && card.signature.trim()
      ? card.signature
      : undefined,
  stripSignature: (card) => { delete card.signature; },
  executeGeneration: executeCreatorGeneration,
};

/** 校验复用会话 owner，规范化结果绝不用于设置写回。 */
export const validateCreatorDraftDocument = (raw: string): void => { parseStoredGenerationDraft(raw, CREATOR_SESSION_FAMILY); };

/**
 * /creator 会话：草稿闸门、取消/uncertain 投影与保存 provenance 走
 * `DesktopGenerationSession` 通用核；本类只注入创作工房家族参数。
 */
export class CreatorSession extends DesktopGenerationSession<
  CreatorDraft,
  CreatorGenerationInput,
  CreatorGenerationIntent,
  CreatorCardKind
> {
  constructor(dependencies: {
    storage: CreatorDraftStorage;
    repository: CardRepository;
    initialDraft: CreatorDraft;
    execute?: CreatorExecutor;
    requestId?: () => string;
  }) {
    super(CREATOR_SESSION_FAMILY, dependencies);
  }
}

export type {
  CreatorCardKind,
  CreatorGenerationInput,
  CreatorGenerationIntent,
  CreatorGenerationOutcome,
  CreatorResultCardData,
  StoredCreatorDraft,
};
