import { describe, expect, it } from 'vitest';

import {
  buildQuestionnaireFlow,
  collectQuestionnaireFlowAnswerItems,
  resolveQuestionnaireReferences,
  type QuestionnaireDefinition,
} from '../src/questionnaire-definition';
import { hasOverLimitQuestionnaireAnswers } from '../src/questionnaire';
import {
  buildQuestionnaireContextItems,
  buildQuestionnaireGenerationRequestBody,
  isQuestionnaireGenerationNativeSignatureAllowed,
  type QuestionnaireSelection,
  type QuestionnaireSelectionSource,
} from '../src/questionnaire-selection';
// 域包不得触达 node:fs（MONO-005-DOMAIN-RUNTIME）：夹具走静态 JSON import。
import fixtureJson from '../fixtures/details-generation-request-parity.json';

/**
 * D5.1a-r1 跨宿主 golden：夹具是权威 expected，本文件跑「选择集 → 可见流程
 * → answers → 请求体」的共源管线；Web/Desktop 各自再有一份宿主侧对拍测试
 * 证明它们消费同一管线与同一夹具。
 */
const fixture = fixtureJson as unknown as {
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
    expectedBody?: unknown;
    /** 拒绝用例：两宿主投影必须抛出包含该子串的错误，不产出请求体。 */
    expectedError?: string;
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

describe('details 生成请求 golden（domain 共源管线）', () => {
  it.each(fixture.cases)('$id → expectedBody/expectedError', (fixtureCase) => {
    const selections = buildSelections(fixtureCase.selections);
    const items = resolveQuestionnaireReferences(buildQuestionnaireContextItems(selections));
    const { flow } = buildQuestionnaireFlow(items, fixtureCase.answersByKey);
    if (fixtureCase.expectedError !== undefined) {
      expect(() => collectQuestionnaireFlowAnswerItems(flow, fixtureCase.answersByKey))
        .toThrow(fixtureCase.expectedError);
      return;
    }
    const answers = collectQuestionnaireFlowAnswerItems(flow, fixtureCase.answersByKey);
    const allowNativeSignature = isQuestionnaireGenerationNativeSignatureAllowed(
      selections,
      hasOverLimitQuestionnaireAnswers(flow, fixtureCase.answersByKey),
    );
    const body = buildQuestionnaireGenerationRequestBody({
      answers,
      selections,
      allowNativeSignature,
      language: fixture.language,
    });
    // 序列化往返后比较：夹具断言的是线路上的 JSON 形态（undefined 一律省略）。
    expect(JSON.parse(JSON.stringify(body))).toEqual(fixtureCase.expectedBody);
  });
});
