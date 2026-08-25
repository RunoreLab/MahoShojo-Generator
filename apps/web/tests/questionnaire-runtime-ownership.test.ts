import { readFileSync } from 'node:fs';

import * as packageRuntime from '@mahoshojo/hosted-runtime/questionnaire-generation-runtime';
import * as legacyRuntime from '@/lib/hosted-api/questionnaire-generation-runtime';
import * as questionnaireDomain from '@mahoshojo/domain/questionnaire';
import * as legacyQuestionnaires from '@/lib/questionnaires';
import * as legacyLimits from '@/lib/questionnaire-limits';

describe('questionnaire runtime ownership', () => {
  test('legacy modules 复用 package/domain 的同一实现 identity', () => {
    expect(legacyRuntime.resolveNativeQuestionnaires).toBe(packageRuntime.resolveNativeQuestionnaires);
    expect(legacyRuntime.resolveAnswerItems).toBe(packageRuntime.resolveAnswerItems);
    expect(legacyQuestionnaires.normalizeUserAnswers).toBe(questionnaireDomain.normalizeUserAnswers);
    expect(legacyQuestionnaires.buildQuestionnaireAnswerLookup)
      .toBe(questionnaireDomain.buildQuestionnaireAnswerLookup);
    expect(legacyLimits.getAnswerLimitInfo).toBe(questionnaireDomain.getAnswerLimitInfo);
  });

  test('hosted-runtime source 不回连 root/app/runtime framework', () => {
    const source = readFileSync(
      new URL('../../../packages/hosted-runtime/src/questionnaire-generation-runtime.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/from\s+['"]@\//);
    expect(source).not.toMatch(/from\s+['"](?:next|hono)(?:\/|['"])/);
    expect(source).not.toMatch(/process\.env|cloudflare|app\/|server\//i);
  });
});
