import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import { CustomProviderRequestSchema } from '@mahoshojo/hosted-api/regular-generation';

import {
  resolveCustomProviderRuntime,
  type CustomProviderRuntimeDependencies,
} from './custom-provider-runtime';

export const formatQuestionnaireAnswers = (
  answers: QuestionnaireAnswerItem[],
): string => {
  if (answers.length === 0) return '';
  const grouped = new Map<string, QuestionnaireAnswerItem[]>();
  for (const item of answers) {
    const groupKey = item.questionnaireTitle?.trim() || '';
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(item);
  }

  const blocks: string[] = [];
  for (const [groupTitle, items] of grouped.entries()) {
    if (groupTitle) blocks.push(`【${groupTitle}】`);
    items.forEach((item, index) => {
      const label = item.question?.trim() || `问题 ${index + 1}`;
      blocks.push(`Q: ${label}`, `A: ${item.answer}`);
    });
  }
  return blocks.join('\n');
};

export const compactQuestionnaireAnswerItems = (
  answers: QuestionnaireAnswerItem[],
): QuestionnaireAnswerItem[] => answers.map((item) => {
  const compacted = { ...item };
  delete compacted.questionnaireId;
  delete compacted.questionnaireTitle;
  return compacted;
});

export type LegacyProviderRuntimeLogger = {
  logWarn(_message: string, _meta: Record<string, unknown>): void;
};

export const resolveLegacyQuestionnaireProviderRuntime = (
  payload: unknown,
  ports: CustomProviderRuntimeDependencies & LegacyProviderRuntimeLogger,
) => {
  if (!payload) {
    return resolveCustomProviderRuntime(undefined, ports, {
      nonSystemLoadBalanceStrategy: 'custom',
      exposeEmptyBaseUrlModelOverride: true,
    });
  }

  const parsed = CustomProviderRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const providerId = payload && typeof payload === 'object' && 'providerId' in payload
      ? payload.providerId
      : undefined;
    ports.logWarn('自定义 AI 供应商配置校验失败', {
      providerId,
      issues: parsed.error.issues,
    });
    return {
      response: new Response(
        JSON.stringify({ error: '自定义 AI 供应商配置无效' }),
        { status: 400 },
      ),
    } as const;
  }

  return resolveCustomProviderRuntime(parsed.data, ports, {
    nonSystemLoadBalanceStrategy: 'custom',
    exposeEmptyBaseUrlModelOverride: true,
  });
};
