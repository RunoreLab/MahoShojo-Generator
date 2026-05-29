import { describe, expect, test } from 'vitest';

import type { CreatorTemplateId } from '@/lib/creator/templates';
import {
  filterCreatorQuestionnairePresetEntries,
  pickDefaultCreatorQuestionnairePresetEntry,
  reconcileQuestionnaireSelectionsForTemplate,
} from '@/lib/creator/questionnaire-template';

const presetEntries = [
  {
    id: 'magical-girl-default',
    kind: 'magical-girl',
    title: '魔法少女默认问卷',
    path: '/questionnaires/presets/magical-girl-default.json',
    isDefault: true,
  },
  {
    id: 'canshou-default',
    kind: 'canshou',
    title: '残兽默认问卷',
    path: '/questionnaires/presets/canshou-default.json',
    isDefault: true,
  },
  {
    id: 'canshou-extra',
    kind: 'canshou',
    title: '残兽扩展问卷',
    path: '/questionnaires/presets/canshou-extra.json',
  },
] as const;

const answerableMagicalGirlSelection = {
  source: 'preset' as const,
  selectionId: 'mg-1',
  questionnaire: {
    id: 'magical-girl-default',
    kind: 'magical-girl' as const,
    title: '魔法少女默认问卷',
    questions: [{ id: 'Q1', question: '你的愿望是什么？' }],
  },
};

const loreOnlySelection = {
  source: 'preset' as const,
  selectionId: 'lore-1',
  questionnaire: {
    id: 'world-lore',
    kind: 'magical-girl' as const,
    title: '世界观速查',
    questions: [],
    loreMarkdown: '设定文本',
  },
};

const canshouReplacementSelection = {
  source: 'preset' as const,
  selectionId: 'cs-1',
  questionnaire: {
    id: 'canshou-default',
    kind: 'canshou' as const,
    title: '残兽默认问卷',
    questions: [{ id: 'CS1', question: '你最强烈的本能是什么？' }],
  },
};

describe('creator questionnaire template helpers', () => {
  test.each([
    ['magical-girl', ['magical-girl-default']] as const,
    ['canshou', ['canshou-default', 'canshou-extra']] as const,
    ['general', ['magical-girl-default', 'canshou-default', 'canshou-extra']] as const,
    ['general-scenario', ['magical-girl-default', 'canshou-default', 'canshou-extra']] as const,
  ])('模板 %s 过滤出的预设问卷符合预期', (template, expectedIds) => {
    const result = filterCreatorQuestionnairePresetEntries(template satisfies CreatorTemplateId, [...presetEntries]);
    expect(result.map((item) => item.id)).toEqual(expectedIds);
  });

  test('残兽模板优先挑选残兽默认问卷', () => {
    const result = pickDefaultCreatorQuestionnairePresetEntry('canshou', [...presetEntries]);
    expect(result?.id).toBe('canshou-default');
  });

  test('切到残兽模板时替换可作答问卷并保留 Lore 卡', () => {
    const result = reconcileQuestionnaireSelectionsForTemplate({
      template: 'canshou',
      selections: [answerableMagicalGirlSelection, loreOnlySelection],
      replacementSelection: canshouReplacementSelection,
    });

    expect(result).toEqual([canshouReplacementSelection, loreOnlySelection]);
  });

  test('非残兽模板不会强制改写当前问卷选择', () => {
    const result = reconcileQuestionnaireSelectionsForTemplate({
      template: 'general',
      selections: [answerableMagicalGirlSelection, loreOnlySelection],
      replacementSelection: canshouReplacementSelection,
    });

    expect(result).toEqual([answerableMagicalGirlSelection, loreOnlySelection]);
  });
});
