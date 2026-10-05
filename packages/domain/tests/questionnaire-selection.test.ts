import { describe, expect, test } from 'vitest';

import {
  normalizeQuestionnaireDefinition,
  type QuestionnaireDefinition,
} from '@mahoshojo/domain/questionnaire-definition';
import { buildQuestionnaireAnswerLookup } from '@mahoshojo/domain/questionnaire';
import {
  applyQuestionnaireSelection,
  buildQuestionnaireContextItems,
  buildQuestionnaireLoreText,
  buildQuestionnaireSelectionLoreText,
  collectUsedQuestionnaireSelectionIds,
  createStoredQuestionnaireSelectionNormalizer,
  ensureQuestionnaireSelectionId,
  isQuestionnaireGenerationNativeSignatureAllowed,
  isQuestionnaireSelectionNativeAllowed,
  pickDefaultQuestionnairePresetEntry,
  reconcileQuestionnaireSelectionsForSingleMode,
  remapAnswersToQuestionnaireChange,
  removeQuestionnaireSelection,
  resolveQuestionnaireSelectionNativeAllowedFallback,
  setQuestionnaireSelectionLore,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';

const makeQuestionnaire = (overrides: Partial<QuestionnaireDefinition> = {}): QuestionnaireDefinition => ({
  id: 'q-demo',
  kind: 'magical-girl',
  title: '示例问卷',
  questions: [{ id: 'q1', question: '你的名字？' }],
  ...overrides,
});

const makeSelection = (overrides: Partial<QuestionnaireSelection> = {}): QuestionnaireSelection => ({
  source: 'preset',
  questionnaire: makeQuestionnaire(),
  ...overrides,
});

let suffixCounter = 0;
const createSuffix = () => `s${++suffixCounter}`;

describe('ensureQuestionnaireSelectionId', () => {
  test('缺失 selectionId 时退回问卷 id；冲突时加随机后缀', () => {
    const used = new Set<string>();
    const first = ensureQuestionnaireSelectionId(makeSelection(), used, createSuffix);
    expect(first.selectionId).toBe('q-demo');
    const second = ensureQuestionnaireSelectionId(makeSelection(), used, createSuffix);
    expect(second.selectionId).toMatch(/^q-demo::/);
    expect(used.has('q-demo')).toBe(true);
  });

  test('已有 selectionId 与已用集合冲突时重新分配', () => {
    const used = new Set(['custom-id']);
    const next = ensureQuestionnaireSelectionId(makeSelection({ selectionId: 'custom-id' }), used, createSuffix);
    expect(next.selectionId).not.toBe('custom-id');
    expect(next.selectionId).toMatch(/^q-demo::/);
  });
});

describe('applyQuestionnaireSelection', () => {
  test('多选模式直接追加', () => {
    const prev = [makeSelection({ selectionId: 'a' })];
    const next = applyQuestionnaireSelection(prev, makeSelection({ questionnaire: makeQuestionnaire({ id: 'q2' }) }), {
      allowMultiple: true,
      createSuffix,
    });
    expect(next).toHaveLength(2);
  });

  test('单选模式：可作答问卷替换既有可作答问卷并保留纯 Lore 卡', () => {
    const loreOnly = makeSelection({
      selectionId: 'lore',
      questionnaire: makeQuestionnaire({ id: 'lore-q', questions: [], loreMarkdown: '世界观' }),
    });
    const answerable = makeSelection({ selectionId: 'old' });
    const next = applyQuestionnaireSelection([answerable, loreOnly], makeSelection({ questionnaire: makeQuestionnaire({ id: 'new-q' }) }), {
      allowMultiple: false,
      createSuffix,
    });
    expect(next.map((item) => item.selectionId)).toEqual(['new-q', 'lore']);
  });

  test('单选模式：纯 Lore 问卷附加到既有选择之后', () => {
    const answerable = makeSelection({ selectionId: 'main' });
    const loreOnly = makeSelection({
      questionnaire: makeQuestionnaire({ id: 'lore-q', questions: [], loreMarkdown: '设定' }),
    });
    const next = applyQuestionnaireSelection([answerable], loreOnly, {
      allowMultiple: false,
      createSuffix,
    });
    expect(next.map((item) => item.questionnaire.id)).toEqual(['q-demo', 'lore-q']);
  });
});

describe('reconcileQuestionnaireSelectionsForSingleMode', () => {
  test('无多余可作答问卷时返回 null', () => {
    const list = [makeSelection({ selectionId: 'a' })];
    expect(reconcileQuestionnaireSelectionsForSingleMode(list)).toBeNull();
  });

  test('多份可作答问卷时只保留第一份', () => {
    const loreOnly = makeSelection({
      selectionId: 'lore',
      questionnaire: makeQuestionnaire({ id: 'lore-q', questions: [], loreMarkdown: 'x' }),
    });
    const list = [
      makeSelection({ selectionId: 'a' }),
      makeSelection({ selectionId: 'b' }),
      loreOnly,
    ];
    const next = reconcileQuestionnaireSelectionsForSingleMode(list);
    expect(next?.map((item) => item.selectionId)).toEqual(['a', 'lore']);
  });
});

describe('removeQuestionnaireSelection / setQuestionnaireSelectionLore', () => {
  test('按 selectionId 移除与切换 Lore', () => {
    const list = [
      makeSelection({ selectionId: 'a' }),
      makeSelection({ selectionId: 'b' }),
    ];
    expect(removeQuestionnaireSelection(list, 'a').map((item) => item.selectionId)).toEqual(['b']);
    const toggled = setQuestionnaireSelectionLore(list, 'b', false);
    expect(toggled[1].useLore).toBe(false);
    expect(toggled[0].useLore).toBeUndefined();
  });
});

describe('buildQuestionnaireContextItems / lore 文本', () => {
  test('扁平化多问卷问题并拼接 lore', () => {
    const list = [
      makeSelection({
        selectionId: 'a',
        questionnaire: makeQuestionnaire({
          id: 'qa',
          title: '问卷A',
          loreMarkdown: '设定A',
          questions: [{ id: 'q1', question: '问题1' }, { id: 'q2', question: '问题2' }],
        }),
      }),
      makeSelection({
        selectionId: 'b',
        useLore: false,
        questionnaire: makeQuestionnaire({
          id: 'qb',
          title: '问卷B',
          loreMarkdown: '设定B',
          questions: [{ id: 'q1', question: '问题B' }],
        }),
      }),
    ];
    const items = buildQuestionnaireContextItems(list);
    expect(items).toHaveLength(3);
    expect(items[0].questionnaireScopeId).toBe('a');
    expect(items[2].questionnaireTitle).toBe('问卷B');

    const lore = buildQuestionnaireSelectionLoreText(list);
    expect(lore).toBe('【设定来源：问卷A】\n设定A');
    expect(buildQuestionnaireLoreText([{ title: 'T', loreMarkdown: '  ' }])).toBe('');
  });
});

describe('remapAnswersToQuestionnaireChange', () => {
  test('按题目元数据把旧答案迁移到新 key', () => {
    const previousTargets = [
      { key: 'old::q1', questionId: 'q1', question: '名字？', questionnaireId: 'qa', index: 0 },
    ];
    const nextTargets = [
      { key: 'new::q1', questionId: 'q1', question: '名字？', questionnaireId: 'qb', index: 0 },
    ];
    const lookup = buildQuestionnaireAnswerLookup(nextTargets);
    const remapped = remapAnswersToQuestionnaireChange({
      previousTargets,
      answersByKey: { 'old::q1': '小圆' },
      lookup,
    });
    expect(remapped).toEqual({ 'new::q1': '小圆' });
  });
});

describe('偏好恢复归一化', () => {
  test('preset 默认 nativeAllowed=true，upload 默认 false', () => {
    expect(resolveQuestionnaireSelectionNativeAllowedFallback('preset', {})).toBe(true);
    expect(resolveQuestionnaireSelectionNativeAllowedFallback('upload', { nativeAllowed: true })).toBe(false);
    expect(resolveQuestionnaireSelectionNativeAllowedFallback('database', { nativeAllowed: true })).toBe(true);
    expect(resolveQuestionnaireSelectionNativeAllowedFallback('database', {})).toBe(false);
  });

  test('createStoredQuestionnaireSelectionNormalizer 还原持久化条目', () => {
    const normalizeStored = createStoredQuestionnaireSelectionNormalizer({
      fallbackKind: 'magical-girl',
      normalize: (value, fallback) => normalizeQuestionnaireDefinition(value, fallback),
    });
    const restored = normalizeStored({
      source: 'database',
      questionnaire: { id: 'q-db', kind: 'magical-girl', title: '库问卷', questions: [{ question: 'Q?' }] },
      dataCardId: 'card-1',
      useLore: false,
    });
    expect(restored?.source).toBe('database');
    expect(restored?.dataCardId).toBe('card-1');
    expect(restored?.useLore).toBe(false);
    expect(restored?.questionnaire.nativeAllowed).toBe(false);

    expect(normalizeStored(null)).toBeNull();
    expect(normalizeStored({ questionnaire: 'not-an-object' })).toBeNull();
  });
});

describe('isQuestionnaireSelectionNativeAllowed / pickDefault', () => {
  test('空选择或非 nativeAllowed 问卷返回 false', () => {
    expect(isQuestionnaireSelectionNativeAllowed([])).toBe(false);
    expect(isQuestionnaireSelectionNativeAllowed([makeSelection()])).toBe(false);
    const allowed = makeSelection({ questionnaire: makeQuestionnaire({ nativeAllowed: true }) });
    expect(isQuestionnaireSelectionNativeAllowed([allowed])).toBe(true);
  });

  test('生成签名资格 = 全选择 native 许可且无超限回答', () => {
    const allowed = [makeSelection({ questionnaire: makeQuestionnaire({ nativeAllowed: true }) })];
    const blocked = [makeSelection()];
    expect(isQuestionnaireGenerationNativeSignatureAllowed(allowed, false)).toBe(true);
    // 超限回答关闭签名资格但不影响可生成性——调用方自行决定是否生成。
    expect(isQuestionnaireGenerationNativeSignatureAllowed(allowed, true)).toBe(false);
    expect(isQuestionnaireGenerationNativeSignatureAllowed(blocked, false)).toBe(false);
  });

  test('优先 isDefault 预设，可 kind 过滤', () => {
    const entries = [
      { kind: 'magical-girl', id: 'a' },
      { kind: 'magical-girl', id: 'b', isDefault: true },
      { kind: 'canshou', id: 'c' },
    ];
    expect(pickDefaultQuestionnairePresetEntry(entries)?.id).toBe('b');
    expect(pickDefaultQuestionnairePresetEntry(entries, 'canshou')?.id).toBe('c');
    expect(pickDefaultQuestionnairePresetEntry([], 'canshou')).toBeNull();
  });
});

describe('collectUsedQuestionnaireSelectionIds', () => {
  test('收集 selectionId 与问卷 id', () => {
    const used = collectUsedQuestionnaireSelectionIds([
      makeSelection({ selectionId: 'x' }),
      makeSelection({ questionnaire: makeQuestionnaire({ id: 'q-y' }) }),
    ]);
    expect(used.has('x')).toBe(true);
    expect(used.has('q-y')).toBe(true);
  });
});
