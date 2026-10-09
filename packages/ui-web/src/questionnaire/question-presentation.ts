import { getAnswerLimitInfo } from '@mahoshojo/domain/questionnaire';
import type { QuestionnaireQuestion } from '@mahoshojo/domain/questionnaire-definition';

/** 两端消费 Web 问卷的同一套题目提示、快速选项和末题提交文案。 */
export function getQuestionnaireQuestionPresentation({
  variant, question, answer, index, total, busy = false, cooldownSeconds = 0,
}: {
  variant: 'details' | 'canshou'; question?: QuestionnaireQuestion;
  answer: string; index: number; total: number; busy?: boolean; cooldownSeconds?: number;
}) {
  const details = variant === 'details';
  const limitInfo = getAnswerLimitInfo(question?.maxLength ?? null);
  const limitLabel = limitInfo.source === 'question' ? `题目上限 ${limitInfo.limit} 字`
    : limitInfo.source === 'global' ? `原生统一上限 ${limitInfo.limit} 字` : '不限';
  const allowCustom = question?.allowCustom !== false;
  const showTextInput = allowCustom || !(question?.options?.length);
  const required = question?.required === true;
  return {
    progressLabel: `问题 ${index + 1} / ${total}`,
    quickOptions: allowCustom ? (details ? ['还没想好', '不想回答'] : ['记录未知', '稍后补充']) : [],
    optionsHintText: details
      ? (allowCustom ? '推荐选项（点击后自动跳转下一题，也可继续补充文本）' : '推荐选项（点击后自动跳转下一题，本题仅可从选项中选择）')
      : (allowCustom ? '推荐选项（点击后将自动进入下一题，可在下方补充）' : '推荐选项（点击后将自动进入下一题，本题仅可从选项中选择）'),
    showTextInput,
    suggestions: showTextInput ? (question?.suggestions ?? []).filter(Boolean) : [],
    placeholder: details ? (question?.placeholder ?? '请输入您的答案（建议控制在适中长度）') : (question?.placeholder || '请在此输入你的想法...'),
    maxLength: limitInfo.limit,
    limitLabel,
    showLimitLabel: limitInfo.source !== 'none' && Boolean(limitInfo.limit),
    overLimitText: `⚠️ 已超过${limitLabel}，继续提交将导致生成内容丧失原生性。`,
    prevLabel: '返回上题',
    nextButtonLabel: cooldownSeconds > 0
      ? (details ? `请等待 ${cooldownSeconds} 秒` : `冷却中 (${cooldownSeconds}s)`)
      : busy ? (details ? '提交中...' : '生成中...')
        : index === total - 1
          ? (required || answer.trim() ? (details ? '提交' : '生成档案') : (details ? '跳过并提交' : '跳过并生成'))
          : (!required && !answer.trim() ? '跳过并继续' : '下一题'),
  };
}
