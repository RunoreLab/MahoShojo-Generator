import {
  buildQuestionKey,
  normalizeQuestionnaireDefinition,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from '@mahoshojo/domain/questionnaire-definition';
import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import type { BattleSelectionPayload } from '@mahoshojo/ui-web/card-library';

/**
 * /details 问卷定义（D5.0e）。
 *
 * 与 Web 共用 `@mahoshojo/domain/questionnaire-definition`：内置预设与数据卡
 * 问卷走同一个 `normalizeQuestionnaireDefinition`，条件题/跳题/选项引用的语义
 * 与 Web 既有产品一致——不另起 Desktop 问卷体系。
 */
export type DetailsQuestionnaire = QuestionnaireDefinition;
export type DetailsQuestion = QuestionnaireQuestion;

/**
 * 逐题流条目：key 由 `buildQuestionKey` 产出（`questionnaireId::questionId`），
 * 草稿回答、条件判定与最终答案收集都以它为锚——切换问卷来源后旧 key 自然失配，
 * 不会把上一张问卷的回答错投到新问卷的题目上。
 */
export interface DetailsFlowItem {
  key: string;
  questionnaireId: string;
  questionnaireTitle: string;
  question: QuestionnaireQuestion;
}

export const buildDetailsFlowItems = (questionnaire: DetailsQuestionnaire): DetailsFlowItem[] =>
  questionnaire.questions.map((question, index) => ({
    key: buildQuestionKey(questionnaire.id, question.id, index),
    questionnaireId: questionnaire.id,
    questionnaireTitle: questionnaire.title,
    question,
  }));

/** 问卷数据卡的当前选择来源；`cardId` 只存在于云端卡——本地卡没有服务器身份。 */
export interface QuestionnaireSource {
  kind: 'builtin' | 'local' | 'cloud';
  title: string;
  cardId?: string;
}

const DEFAULT_SOURCE: QuestionnaireSource = { kind: 'builtin', title: '' };

/** 数据卡选择载荷 → 问卷定义；非法正文返回错误文案而不是静默回退。 */
export const parseQuestionnaireSelection = (
  payload: BattleSelectionPayload,
): { questionnaire: DetailsQuestionnaire; source: QuestionnaireSource } | { error: string } => {
  if (payload._cardType !== 'questionnaire') {
    return { error: '这张数据卡不是问卷。' };
  }
  const cardName = typeof payload._cardName === 'string' && payload._cardName.trim()
    ? payload._cardName.trim()
    : '未命名问卷';
  const questionnaire = normalizeQuestionnaireDefinition(payload, {
    fallbackId: typeof payload._cardId === 'string' && payload._cardId ? `card-${payload._cardId}` : 'custom-questionnaire',
    fallbackKind: 'magical-girl',
    fallbackTitle: cardName,
  });
  if (!questionnaire || questionnaire.questions.length === 0) {
    return { error: '这张问卷数据卡没有可用题目。' };
  }
  // 与 hosted-runtime 同一口径：数据卡来源的问卷必须显式声明 nativeAllowed === true
  // 才允许在本机原生执行；未声明/显式拒绝一律 fail closed。
  if (questionnaire.nativeAllowed !== true) {
    return { error: '这张问卷数据卡未声明允许在客户端原生运行。' };
  }
  const isLocal = payload._storageLocation === 'local';
  return {
    questionnaire,
    source: {
      kind: isLocal ? 'local' : 'cloud',
      title: cardName,
      // 本地选择绝不携带服务器身份（DESK-ONLINE-010）。
      ...(isLocal ? {} : { cardId: String(payload._cardId ?? '') }),
    },
  };
};

export const loadDefaultQuestionnaire = async (signal: AbortSignal): Promise<DetailsQuestionnaire> => {
  const response = await fetch('/questionnaires/presets/magical-girl-default.json', { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('内置问卷加载失败，请重试。');
  const questionnaire = normalizeQuestionnaireDefinition(await response.json(), {
    fallbackId: 'magical-girl-default',
    fallbackKind: 'magical-girl',
  });
  if (!questionnaire || questionnaire.id !== 'magical-girl-default' || questionnaire.nativeAllowed === false) {
    throw new Error('内置问卷无法读取，请重新安装或更新客户端。');
  }
  return questionnaire;
};

export const builtinQuestionnaireSource = (questionnaire: DetailsQuestionnaire): QuestionnaireSource => ({
  ...DEFAULT_SOURCE,
  title: questionnaire.title,
});

const isOptionAllowed = (question: QuestionnaireQuestion, answer: string): boolean =>
  question.options?.some((option) =>
    typeof option === 'string' ? option === answer : !option.disabled && option.value === answer) ?? false;

/**
 * 从流程条目与按键回答收集生成载荷。
 *
 * 只收集当前可见流程内的题目（displayIf/jump 已按回答求值），与 Web
 * `collectStoredQuestionnaireAnswerItems` 同一口径；`allowCustom === false`
 * 的题只接受可用选项，避免把键盘输入混进封闭题。
 */
export const buildDetailsAnswers = (
  flow: readonly DetailsFlowItem[],
  answersByKey: Record<string, string>,
): QuestionnaireAnswerItem[] => {
  const items = flow.flatMap((item) => {
    const answer = answersByKey[item.key]?.trim() ?? '';
    if (!answer) return [];
    if (item.question.allowCustom === false && !isOptionAllowed(item.question, answer)) {
      throw new Error(`“${item.question.question}”请选择一个可用选项。`);
    }
    return [{
      question: item.question.question,
      answer,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    }];
  });
  if (!items.length) throw new Error('请至少填写一题后再生成。');
  return items;
};
