import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const questionnaireEditorSource = readFileSync(
  join(process.cwd(), 'components/creation/QuestionnaireEditorPage.tsx'),
  'utf8',
);
const characterManagerSource = readFileSync(
  join(process.cwd(), 'components/character/CharacterManagerPage.tsx'),
  'utf8',
);
const compatModalSource = readFileSync(
  join(process.cwd(), 'components/CharManager/QuestionnaireCompatModal.tsx'),
  'utf8',
);

describe('legacy questionnaire data-card recovery wiring', () => {
  test('问卷编辑器把内容识别出的旧卡投影到问卷库', () => {
    expect(questionnaireEditorSource).toContain('normalizeQuestionnaireDataCard');
    expect(questionnaireEditorSource).toContain('isLegacyQuestionnaire');
    expect(questionnaireEditorSource).toContain('repairQuestionnaireType');
  });

  test('角色管理中心按内容识别错标问卷并绑定真实卡片', () => {
    expect(characterManagerSource).toContain('isQuestionnaireDataCard');
    expect(characterManagerSource).toContain('openQuestionnaireCompat(raw, {');
  });

  test('兼容编辑器在替换前恢复数据卡类型', () => {
    const repairIndex = compatModalSource.indexOf('repairQuestionnaireType');
    const replaceIndex = compatModalSource.indexOf('replaceCard');

    expect(repairIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeGreaterThan(repairIndex);
  });
});
