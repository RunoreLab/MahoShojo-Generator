import {
  normalizeQuestionnaireDefinition,
  type QuestionnaireKind,
} from '@mahoshojo/domain/questionnaire-definition';
import {
  normalizeStoredQuestionnaireSelection,
  questionnaireSelectionScopeId,
  resolveQuestionnaireSelectionNativeAllowedFallback,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import {
  DesktopGenerationSession,
  type GenerationDraftStorage,
  type GenerationSessionFamily,
  type GenerationSessionState,
  type StoredGenerationDraft,
} from '../generation/session';
import type {
  QuestionnaireCardKind,
  QuestionnaireGenerationInput,
  QuestionnaireGenerationIntent,
  QuestionnaireGenerationOutcome,
  QuestionnaireResultCardData,
} from './generation';

/**
 * 问卷页草稿（D5.1-G1 泛化）：回答、语言、选择集、保存方式偏好与「设定说明」
 * 抽屉状态。`/details` 与 `/canshou` 同形，仅存储键不同。
 */
export interface QuestionnaireDraft {
  answers: Record<string, string>;
  language: string;
  /** 多问卷选择集（含 Lore 开关与来源元数据；与 Web 草稿 `questionnaireSelections` 同口径）。 */
  questionnaireSelections?: QuestionnaireSelection[];
  /** 「允许同时回答多份问卷」偏好（与 Web 草稿 `allowMultipleQuestionnaires` 同口径）。 */
  allowMultipleQuestionnaires?: boolean;
  /** 保存方式偏好（与 Web 草稿字段同名；缺省由页面按终端推导）。 */
  imageSaveMode?: 'download' | 'modal';
  jsonSaveMode?: 'download' | 'text';
  /** 「设定说明」抽屉展开状态。 */
  showDetails?: boolean;
}

/** 问卷草稿的默认语言——页面 `initialDraft` 与设置页首写共用同一口径。 */
export const QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE = 'zh-CN';

/**
 * 「首写合法文档」工厂（D5.1-S1-r1）：设置页对空草稿键做字段级写入前，
 * 必须先建立一份能过 `parseDraft` 的空壳——`version`/`answers`/`language`
 * 是草稿协议必填面；只写偏好键的裸对象会被判成损坏草稿并触发数据保护
 * （`isDraftBlocked`）。产物不含用户内容，`isResidueDraft` 判真——页面
 * 下次打开静默应用并照常恢复其中残留的偏好字段，不弹「恢复草稿」门禁。
 */
export const createEmptyQuestionnaireDraftDocument = (): Record<string, unknown> => ({
  version: 1,
  answers: {},
  language: QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE,
});

/**
 * 问卷会话家族描述符：草稿键、内置问卷身份、结构化卡的归一化与标题映射。
 * 其余语义（草稿闸门、取消、uncertain 投影、保存 provenance）家族间一致，
 * 实现 D5.1-G2 起在 `features/generation/session.ts` 通用核。
 */
export interface QuestionnaireSessionFamily<
  TStructuredKind extends string = string,
  TIntent extends QuestionnaireGenerationIntent = QuestionnaireGenerationIntent,
> {
  /** 草稿 localStorage 键。 */
  draftKey: string;
  /** 内置问卷 canonical id——残余草稿判定用。 */
  builtinQuestionnaireId: string;
  /** 草稿 selection 归一化时未声明 kind 的兜底。 */
  draftFallbackKind: QuestionnaireKind;
  /** 结构化卡 kind 标识与保存到本地卡库时的标题字段/兜底标题。 */
  structuredCardKind: TStructuredKind;
  structuredTitleField: string;
  structuredTitleFallback: string;
  /** hosted JSON 结果卡归一化（schema 校验 + 透传字段）。 */
  normalizeStructuredCard(value: unknown): QuestionnaireResultCardData;
  /** 缺省生成执行器（家族绑定的 execute 包装；测试可经 `execute` 依赖注入替身）。 */
  executeGeneration: QuestionnaireExecutor<TIntent, TStructuredKind>;
}

export type QuestionnaireDraftStorage = GenerationDraftStorage;

export type QuestionnaireSessionState<TStructuredKind extends string = string> =
  GenerationSessionState<QuestionnaireDraft, QuestionnaireCardKind<TStructuredKind>>;

export type QuestionnaireExecutor<
  TIntent extends QuestionnaireGenerationIntent = QuestionnaireGenerationIntent,
  TStructuredKind extends string = string,
> = (
  options: DesktopAiExecutionOptions,
  input: QuestionnaireGenerationInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
) => Promise<QuestionnaireGenerationOutcome<TStructuredKind>>;

/**
 * 问卷草稿字段解析器工厂（D5.1-G3）：`/details`/`/canshou` 的草稿协议
 * （answers/language 必填面 + 选择集归一化 + 偏好字段）是问卷类页面的
 * 公共面，`/creator` 草稿在其上叠加创作工房字段后仍复用同一解析。
 */
export const createQuestionnaireDraftFieldsParser = (
  draftFallbackKind: QuestionnaireKind,
) =>
  (value: Record<string, unknown>): QuestionnaireDraft => {
    if (!object(value.answers) || typeof value.language !== 'string' || !Object.values(value.answers).every((answer) => typeof answer === 'string')) throw new Error('草稿版本不受支持或内容损坏');
    const draft: QuestionnaireDraft = { answers: value.answers as Record<string, string>, language: value.language };
    // 选择集逐条经共源归一化：损坏条目丢弃而不是让整个草稿报废（D5.1-P2）。
    const seenScopes = new Set<string>();
    const questionnaireSelections = (Array.isArray(value.questionnaireSelections) ? value.questionnaireSelections : [])
      .map((entry) => normalizeStoredQuestionnaireSelection(entry, {
        normalize: normalizeQuestionnaireDefinition,
        resolveFallback: (rawQuestionnaire, source) => {
          const record = rawQuestionnaire && typeof rawQuestionnaire === 'object'
            ? rawQuestionnaire as Record<string, unknown>
            : {};
          return {
            // 已声明的 kind 优先于兜底（normalize 口径一致），缺省按本家族。
            fallbackKind: record.kind === 'canshou' || record.kind === 'magical-girl' ? record.kind : draftFallbackKind,
            fallbackId: typeof record.id === 'string' ? record.id : 'questionnaire',
            fallbackTitle: typeof record.title === 'string' ? record.title : '未命名问卷',
            nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback(source, rawQuestionnaire),
          };
        },
      }))
      .filter((selection): selection is QuestionnaireSelection => selection !== null)
      // 篡改的草稿可以把本地副本（wire 'upload'）内嵌 questionnaire.nativeAllowed 写成 true：
      // 归一化优先采纳声明值，这里与卡库选择器对本地卡的强制口径保持一致（D5.1-P2-r1）。
      .map((selection) => selection.source === 'upload'
        ? { ...selection, questionnaire: { ...selection.questionnaire, nativeAllowed: false } }
        : selection)
      // 同一作用域的重复选择会让两份问卷的答案键互相覆盖——保留第一条，丢弃其余。
      .filter((selection) => {
        const scope = questionnaireSelectionScopeId(selection);
        if (seenScopes.has(scope)) return false;
        seenScopes.add(scope);
        return true;
      });
    if (questionnaireSelections.length) draft.questionnaireSelections = questionnaireSelections;
    if (value.allowMultipleQuestionnaires === true) draft.allowMultipleQuestionnaires = true;
    if (value.imageSaveMode === 'download' || value.imageSaveMode === 'modal') draft.imageSaveMode = value.imageSaveMode;
    if (value.jsonSaveMode === 'download' || value.jsonSaveMode === 'text') draft.jsonSaveMode = value.jsonSaveMode;
    if (value.showDetails === true) draft.showDetails = true;
    return draft;
  };

type Card = QuestionnaireResultCardData;
type StoredDraft<TStructuredKind extends string = string> =
  StoredGenerationDraft<QuestionnaireDraft, QuestionnaireCardKind<TStructuredKind>>;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isAnswerList = (value: unknown): boolean =>
  Array.isArray(value) && value.every((answer) => object(answer) && typeof answer.question === 'string' && typeof answer.answer === 'string');

const readTrimmedStringField = (card: Card, key: string): string | undefined =>
  typeof card[key] === 'string' && (card[key] as string).trim() ? (card[key] as string).trim() : undefined;

/**
 * 问卷会话家族 → 通用会话家族适配（D5.1-G2）：问卷草稿字段解析
 * （answers/language 必填面、选择集逐条归一化、篡改剥除与去重、
 * 保存方式/抽屉偏好）、残余草稿判定、'general'|结构化双 kind 卡校验、
 * 顶层 `signature` 归属与标题推导为问卷族共有语义。
 */
const adaptQuestionnaireSessionFamily = <
  TStructuredKind extends string,
  TIntent extends QuestionnaireGenerationIntent,
>(
  family: QuestionnaireSessionFamily<TStructuredKind, TIntent>,
): GenerationSessionFamily<
  QuestionnaireDraft,
  QuestionnaireGenerationInput,
  TIntent,
  QuestionnaireCardKind<TStructuredKind>
> => {
  const validateCard = (kind: QuestionnaireCardKind<TStructuredKind>, value: unknown): Card => {
    if (kind === 'general') {
      if (!object(value) || typeof value.name !== 'string' || typeof value.content !== 'string') throw new Error('角色卡损坏');
      if (value.userAnswers !== undefined && !isAnswerList(value.userAnswers)) throw new Error('角色卡无问卷记录');
      return { ...value };
    }
    const card = family.normalizeStructuredCard(value);
    if (!isAnswerList(card.userAnswers)) throw new Error('角色卡无问卷记录');
    return card;
  };

  const parseDraftFields = createQuestionnaireDraftFieldsParser(family.draftFallbackKind);

  /**
   * 「残余草稿」：自动写回的空壳——没有非空回答、没有生成结果或中断正文、
   * 选择集恰为默认内置问卷。它由「进页面即注入默认选择并落盘」产生，不携带
   * 任何用户内容；对这类草稿弹「发现上次草稿」属于噪声。这类草稿直接静默应用，
   * 而不是走 pending 门禁（D5.1-P2-r1）。注意判定只看用户内容——残留的偏好字段
   * （语言/保存方式等）仍照常恢复。
   */
  const isResidueDraft = (draft: StoredDraft<TStructuredKind>): boolean => {
    if (Object.values(draft.answers).some((answer) => answer.trim() !== '')) return false;
    const output = draft.output;
    if (output !== undefined && (output.phase !== 'idle' || output.card !== null || output.rawText !== '')) return false;
    const selections = draft.questionnaireSelections ?? [];
    return selections.length <= 1
      && selections.every(
        (selection) => selection.source === 'preset' && selection.questionnaire.id === family.builtinQuestionnaireId,
      );
  };

  return {
    draftKey: family.draftKey,
    defaultCardKind: family.structuredCardKind,
    parseDraftFields,
    normalizeStoredCardKind: (value) => (value === 'general' ? 'general' : family.structuredCardKind),
    isResidueDraft,
    validateCard,
    cardTypeOf: () => 'character',
    titleOf: (kind, card) =>
      kind === 'general'
        ? (readTrimmedStringField(card, 'name') ?? '未命名角色')
        : (readTrimmedStringField(card, family.structuredTitleField) ?? family.structuredTitleFallback),
    signatureFrom: (kind, card) =>
      // 如实记录原始签名串（trim 只用于判空，不回写裁剪值）。
      kind === family.structuredCardKind && typeof card.signature === 'string' && card.signature.trim()
        ? card.signature
        : undefined,
    stripSignature: (card) => { delete card.signature; },
    prepareLocalCard: (card) => { if (card.userAnswers === undefined) card.userAnswers = []; },
    executeGeneration: family.executeGeneration,
  };
};

/**
 * 单个页面生命周期中的意图所有者；同步上锁，异步完成后才释放。
 * `/details` 与 `/canshou` 共用（D5.1-G1），家族差异由 `family` 注入；
 * 通用会话实现 D5.1-G2 起在 `features/generation/session.ts`。
 */
export class QuestionnaireGenerationSession<
  TStructuredKind extends string = string,
  TIntent extends QuestionnaireGenerationIntent = QuestionnaireGenerationIntent,
> extends DesktopGenerationSession<
  QuestionnaireDraft,
  QuestionnaireGenerationInput,
  TIntent,
  QuestionnaireCardKind<TStructuredKind>
> {
  constructor(
    family: QuestionnaireSessionFamily<TStructuredKind, TIntent>,
    dependencies: {
      storage: QuestionnaireDraftStorage;
      repository: CardRepository;
      initialDraft: QuestionnaireDraft;
      execute?: QuestionnaireExecutor<TIntent, TStructuredKind>;
      requestId?: () => string;
    },
  ) {
    super(adaptQuestionnaireSessionFamily(family), dependencies);
  }
}
