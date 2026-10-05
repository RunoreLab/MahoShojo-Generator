import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildQuestionnaireFlow,
  collectQuestionnaireFlowAnswerItems,
  resolveQuestionnaireReferences,
  type QuestionnaireDefinition,
} from '@/lib/questionnaires';
import { hasOverLimitQuestionnaireAnswers } from '@mahoshojo/domain/questionnaire';
import {
  buildQuestionnaireContextItems,
  buildQuestionnaireGenerationRequestBody,
  isQuestionnaireGenerationNativeSignatureAllowed,
  type QuestionnaireSelection,
  type QuestionnaireSelectionSource,
} from '@mahoshojo/domain/questionnaire-selection';

/**
 * D5.1a-r1 跨宿主 golden（Web 侧）：复刻 `/details` handleSubmit 的
 * 「selections → 可见流程 → answers → 请求体」链路与同一组装器，断言产出的
 * JSON 等于 golden expectedBody。`customProvider` 是 Web 宿主特有字段，
 * 无自定义供应商时为 undefined、序列化省略——golden 不覆盖它。
 */
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../packages/domain/fixtures/details-generation-request-parity.json', import.meta.url),
    'utf8',
  ),
) as {
  language: string;
  questionnaires: Record<string, QuestionnaireDefinition>;
  cases: Array<{
    id: string;
    selections: Array<{
      ref: string;
      source: QuestionnaireSelectionSource;
      dataCardId?: string;
      dataCardName?: string;
      selectionId?: string;
      useLore?: boolean;
    }>;
    answersByKey: Record<string, string>;
    expectedBody: unknown;
  }>;
};

const buildSelections = (entries: (typeof fixture.cases)[number]['selections']): QuestionnaireSelection[] =>
  entries.map((entry) => ({
    source: entry.source,
    questionnaire: fixture.questionnaires[entry.ref]!,
    ...(entry.dataCardId !== undefined ? { dataCardId: entry.dataCardId } : {}),
    ...(entry.dataCardName !== undefined ? { dataCardName: entry.dataCardName } : {}),
    ...(entry.selectionId !== undefined ? { selectionId: entry.selectionId } : {}),
    ...(entry.useLore !== undefined ? { useLore: entry.useLore } : {}),
  }));

describe('details 生成请求 golden（Web /details 提交链路）', () => {
  it.each(fixture.cases)('$id → 请求体等于 expectedBody', (fixtureCase) => {
    const selections = buildSelections(fixtureCase.selections);
    // 与 DetailsPage 同一链路：context items → 引用解析 → 条件流程 → 答案收集。
    const items = resolveQuestionnaireReferences(buildQuestionnaireContextItems(selections));
    const { flow } = buildQuestionnaireFlow(items, fixtureCase.answersByKey);
    const answers = collectQuestionnaireFlowAnswerItems(flow, fixtureCase.answersByKey);
    const allowNativeSignature = isQuestionnaireGenerationNativeSignatureAllowed(
      selections,
      hasOverLimitQuestionnaireAnswers(flow, fixtureCase.answersByKey),
    );
    const body = {
      ...buildQuestionnaireGenerationRequestBody({
        answers,
        selections,
        allowNativeSignature,
        language: fixture.language,
      }),
      // 无自定义供应商：payload 为 undefined，JSON.stringify 时省略。
      customProvider: undefined,
    };
    expect(JSON.parse(JSON.stringify(body))).toEqual(fixtureCase.expectedBody);
  });
});
