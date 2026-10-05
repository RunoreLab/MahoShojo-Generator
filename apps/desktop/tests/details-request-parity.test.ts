import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  buildQuestionnaireFlow,
  resolveQuestionnaireReferences,
  type QuestionnaireDefinition,
} from '@mahoshojo/domain/questionnaire-definition';
import { hasOverLimitQuestionnaireAnswers } from '@mahoshojo/domain/questionnaire';
import {
  isQuestionnaireGenerationNativeSignatureAllowed,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';

import { executeDetailsGeneration } from '../src/features/details/generation';
import {
  buildDetailsAnswers,
  buildSelectionFlowItems,
  toQuestionnaireSelection,
  type QuestionnaireSource,
} from '../src/features/details/questionnaire';
import { HOSTED_AI_REQUEST_COMMAND } from '../src/platform/cloud-bridge';

/**
 * D5.1a-r1 跨宿主 golden（Desktop 侧）：夹具选择集先映射回 Desktop 的
 * QuestionnaireSource（builtin/cloud/local），经 `toQuestionnaireSelection`
 * 还原为共源 selection 后，跑 `executeDetailsGeneration` hosted-json 通路，
 * 断言上线路的业务请求体逐字段等于 golden expectedBody。
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
      source: 'preset' | 'upload' | 'database';
      dataCardId?: string;
      dataCardName?: string;
      selectionId?: string;
      useLore?: boolean;
    }>;
    answersByKey: Record<string, string>;
    expectedBody: unknown;
  }>;
};

const DESKTOP_KIND: Record<'preset' | 'upload' | 'database', QuestionnaireSource['kind']> = {
  preset: 'builtin',
  database: 'cloud',
  upload: 'local',
};

const toDesktopSource = (entry: (typeof fixture.cases)[number]['selections'][number]): QuestionnaireSource => ({
  kind: DESKTOP_KIND[entry.source],
  // 本地/云端来源的标题来自数据卡名；内置预设用问卷自身标题。
  title: entry.source === 'preset'
    ? fixture.questionnaires[entry.ref]!.title
    : entry.dataCardName ?? fixture.questionnaires[entry.ref]!.title,
  ...(entry.source === 'database' && entry.dataCardId !== undefined ? { cardId: entry.dataCardId } : {}),
  selectionId: entry.selectionId ?? fixture.questionnaires[entry.ref]!.id,
});

describe('details 生成请求 golden（Desktop hosted-json 通路）', () => {
  it.each(fixture.cases)('$id → 上线路 body 等于 expectedBody', async (fixtureCase) => {
    const entries = fixtureCase.selections.map((entry) => ({
      source: toDesktopSource(entry),
      questionnaire: fixture.questionnaires[entry.ref]!,
      useLore: entry.useLore,
    }));
    const selections: QuestionnaireSelection[] = entries.map(({ source, questionnaire, useLore }) =>
      toQuestionnaireSelection(source, questionnaire, useLore));

    const flowItems = resolveQuestionnaireReferences(buildSelectionFlowItems(entries));
    const { flow } = buildQuestionnaireFlow(flowItems, fixtureCase.answersByKey);
    const answers = buildDetailsAnswers(flow, fixtureCase.answersByKey);
    const allowNativeSignature = isQuestionnaireGenerationNativeSignatureAllowed(
      selections,
      hasOverLimitQuestionnaireAnswers(flow, fixtureCase.answersByKey),
    );

    let capturedBody: unknown;
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== HOSTED_AI_REQUEST_COMMAND) throw new Error(`unexpected command: ${command}`);
      capturedBody = (args!.request as { body: unknown }).body;
      return { status: 200, body: { data: {}, aiMeta: null } };
    });
    await executeDetailsGeneration(
      { invoke, profileId: '' },
      {
        answers,
        language: fixture.language,
        loreText: '',
        hosted: { selections, allowNativeSignature },
      },
      { requestId: `parity-${fixtureCase.id}`, mode: 'hosted-json', flowers: '百合' },
      new AbortController().signal,
    );

    expect(JSON.parse(JSON.stringify(capturedBody))).toEqual(fixtureCase.expectedBody);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
