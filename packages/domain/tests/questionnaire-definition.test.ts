import { describe, expect, test } from 'vitest';

import {
  buildQuestionKey,
  buildQuestionnaireFlow,
  collectStoredQuestionnaireAnswerItems,
  MAX_QUESTIONNAIRE_IMPORT_BYTES,
  normalizeQuestionnaireDefinition,
  parseQuestionnaireDataCardPayload,
  resolveQuestionnaireReferences,
  type QuestionnaireDefinition,
} from '@mahoshojo/domain/questionnaire-definition';
import { MAX_DATA_CARD_BYTES } from '@mahoshojo/domain/data-card-size';
import { isAllowedExternalMediaUrl } from '@mahoshojo/domain/external-media';

const toItems = (definition: QuestionnaireDefinition) =>
  definition.questions.map((question, index) => ({
    key: buildQuestionKey(definition.id, question.id, index),
    questionnaireId: definition.id,
    question,
  }));

const define = (questions: unknown[], extra: Record<string, unknown> = {}) =>
  normalizeQuestionnaireDefinition({ kind: 'magical-girl', id: 'q-test', title: '测试', questions, ...extra })!;

describe('buildQuestionKey / collectStoredQuestionnaireAnswerItems', () => {
  test('key 带问卷前缀，切换问卷来源后旧回答自然失配', () => {
    expect(buildQuestionKey('q-a', 'q1', 0)).toBe('q-a::q1');
    expect(buildQuestionKey('', 'q1', 0)).toBe('q1');
    expect(buildQuestionKey('q-a', '', 2)).toBe('q-a::Q3');
  });

  test('只收集非空字符串回答并保留问卷/题目身份', () => {
    const items = collectStoredQuestionnaireAnswerItems(
      [
        { key: 'q::a', question: 'A?', index: 0, questionId: 'a', questionnaireId: 'q', questionnaireTitle: 'Q' },
        { key: 'q::b', question: 'B?', index: 1, questionId: 'b', questionnaireId: 'q', questionnaireTitle: 'Q' },
      ],
      { 'q::a': '  作答  ', 'q::b': '   ', 'other::a': '不归属本问卷' },
    );
    expect(items).toEqual([
      { key: 'q::a', question: 'A?', answer: '  作答  ', questionId: 'a', questionnaireId: 'q', questionnaireTitle: 'Q' },
    ]);
  });
});

describe('buildQuestionnaireFlow', () => {
  const flow = (definition: QuestionnaireDefinition, answers: Record<string, string> = {}) =>
    buildQuestionnaireFlow(resolveQuestionnaireReferences(toItems(definition)), answers);

  test('displayIf 按当前回答决定题目可见性', () => {
    const definition = define([
      { id: 'gate', question: '开关', options: ['yes', 'no'] },
      { id: 'branch', question: '分支', displayIf: { questionId: 'gate', operator: 'equals', value: 'yes' } },
      { id: 'tail', question: '收尾' },
    ]);
    const items = toItems(definition);
    const keyOf = (id: string) => items.find((item) => item.question.id === id)!.key;

    expect(flow(definition).flow.map((item) => item.question.id)).toEqual(['gate', 'tail']);
    expect(flow(definition, { [keyOf('gate')]: 'yes' }).flow.map((item) => item.question.id)).toEqual(['gate', 'branch', 'tail']);
    expect(flow(definition, { [keyOf('gate')]: 'no' }).flow.map((item) => item.question.id)).toEqual(['gate', 'tail']);
  });

  test('jump 命中时跳到目标题或结束本问卷段', () => {
    const definition = define([
      { id: 'q1', question: '一', jump: { when: { questionId: 'q1', operator: 'equals', value: 'skip' }, to: { questionId: 'q3' } } },
      { id: 'q2', question: '二' },
      { id: 'q3', question: '三' },
    ]);
    const items = toItems(definition);
    const keyOf = (id: string) => items.find((item) => item.question.id === id)!.key;

    expect(flow(definition).flow.map((item) => item.question.id)).toEqual(['q1', 'q2', 'q3']);
    expect(flow(definition, { [keyOf('q1')]: 'skip' }).flow.map((item) => item.question.id)).toEqual(['q1', 'q3']);
  });

  test('toEnd 结束本问卷段', () => {
    const definition = define([
      { id: 'q1', question: '一', jump: { when: { questionId: 'q1', operator: 'notEmpty' }, toEnd: true } },
      { id: 'q2', question: '二' },
    ]);
    const items = toItems(definition);
    expect(flow(definition, { [items[0].key]: 'done' }).flow.map((item) => item.question.id)).toEqual(['q1']);
  });

  test('隐藏题的旧回答不参与后续判定（迭代剔除不可见键）', () => {
    const definition = define([
      { id: 'gate', question: '开关', options: ['show', 'hide'] },
      { id: 'mid', question: '中', displayIf: { questionId: 'gate', operator: 'equals', value: 'show' } },
      { id: 'dep', question: '依赖中题', displayIf: { questionId: 'mid', operator: 'notEmpty' } },
    ]);
    const items = toItems(definition);
    const keyOf = (id: string) => items.find((item) => item.question.id === id)!.key;

    // gate=hide 使 mid 不可见；mid 的残留回答不能再让 dep 可见。
    const result = flow(definition, { [keyOf('gate')]: 'hide', [keyOf('mid')]: '残留' });
    expect(result.flow.map((item) => item.question.id)).toEqual(['gate']);
    expect(result.visibleKeys.has(keyOf('mid'))).toBe(false);
  });
});

describe('resolveQuestionnaireReferences', () => {
  test('optionsFrom/suggestionsFrom 按引用解析到同卷题目', () => {
    const definition = define([
      { id: 'src', question: '来源', options: ['甲', '乙'], suggestions: ['建议一'] },
      { id: 'ref', question: '引用', optionsFrom: { questionId: 'src' }, suggestionsFrom: 'src' },
    ]);
    const resolved = resolveQuestionnaireReferences(toItems(definition));
    expect(resolved[1].question.options).toEqual(['甲', '乙']);
    expect(resolved[1].question.suggestions).toEqual(['建议一']);
    // 已有自身选项时引用不覆盖。
    const own = define([
      { id: 'src', question: '来源', options: ['甲'] },
      { id: 'ref', question: '引用', options: ['自有'], optionsFrom: { questionId: 'src' } },
    ]);
    expect(resolveQuestionnaireReferences(toItems(own))[1].question.options).toEqual(['自有']);
  });
});

describe('normalizeQuestionnaireDefinition', () => {
  test('nativeAllowed 透传：布尔原样、缺省走 fallback、否则 null', () => {
    expect(define(['q'], { nativeAllowed: true }).nativeAllowed).toBe(true);
    expect(define(['q']).nativeAllowed).toBeNull();
    expect(normalizeQuestionnaireDefinition(
      { kind: 'magical-girl', questions: ['q'] },
      { nativeAllowed: false },
    )?.nativeAllowed).toBe(false);
  });

  test('字符串题目与缺省字段归一化出稳定题目形态', () => {
    const definition = define(['你的信念？', { id: 'q2' }], { defaultRequired: true });
    expect(definition.questions[0]).toMatchObject({ id: 'MG-1', question: '你的信念？', required: true, maxLength: null });
    expect(definition.questions[1]).toMatchObject({ id: 'q2', question: '问题 2' });
  });

  test('kind 非法、非对象输入返回 null', () => {
    expect(normalizeQuestionnaireDefinition(null)).toBeNull();
    expect(normalizeQuestionnaireDefinition('text')).toBeNull();
    expect(normalizeQuestionnaireDefinition({ kind: 'unknown', questions: ['q'] })).toBeNull();
    // fallbackKind 兜底
    expect(normalizeQuestionnaireDefinition({ questions: ['q'] }, { fallbackKind: 'canshou' })?.kind).toBe('canshou');
  });
});

describe('parseQuestionnaireDataCardPayload', () => {
  const inner = { kind: 'magical-girl', questions: [{ id: 'q1', question: 'Q?' }] };

  test('识别 data/dataJson 字段、嵌套 questionnaire 与直接 questions', () => {
    expect(parseQuestionnaireDataCardPayload({ data: JSON.stringify(inner) }).kind).toBe('magical-girl');
    expect(parseQuestionnaireDataCardPayload({ dataJson: inner }).questions).toHaveLength(1);
    expect(parseQuestionnaireDataCardPayload({ questionnaire: inner }).questions).toHaveLength(1);
    expect(parseQuestionnaireDataCardPayload(inner).questions).toHaveLength(1);
  });

  test('非法载荷抛出而非静默通过', () => {
    // 非法 JSON 走原生 SyntaxError（与 Web 迁移前行为一致），其余形态抛领域错误。
    expect(() => parseQuestionnaireDataCardPayload('{bad')).toThrow();
    expect(() => parseQuestionnaireDataCardPayload(null)).toThrow('问卷数据卡内容为空或格式不受支持');
    expect(() => parseQuestionnaireDataCardPayload({ unrelated: 1 })).toThrow('问卷数据卡内容为空或格式不受支持');
    expect(() => parseQuestionnaireDataCardPayload({ data: 42 })).toThrow('问卷数据卡内容为空或格式不受支持');
  });

  test('字符串 payload 在 JSON.parse 前执行导入字节预算（D5.1-P2-r2）', () => {
    // 超预算的字符串（直接 source 或 data 字段内嵌）在 parse 前抛领域错误，
    // 而不是先为超大输入分配解析缓冲；预算内合法 JSON 不受影响。
    const oversized = `{"a":"${'x'.repeat(MAX_QUESTIONNAIRE_IMPORT_BYTES)}"}`;
    expect(() => parseQuestionnaireDataCardPayload(oversized)).toThrow('问卷数据卡内容为空或格式不受支持');
    expect(() => parseQuestionnaireDataCardPayload({ data: oversized })).toThrow('问卷数据卡内容为空或格式不受支持');
    expect(parseQuestionnaireDataCardPayload(JSON.stringify(inner)).questions).toHaveLength(1);
  });

  test('字节预算针对原始输入：超预算空白包裹的合法 JSON 同样被拒（D5.1-P2-r4）', () => {
    // 「大量空白 + 小合法 JSON」裁剪后完全在预算内，但原始串已超预算——
    // trim 前的预算检查保证无界空白不先被整串扫描。
    const padded = `${' '.repeat(MAX_QUESTIONNAIRE_IMPORT_BYTES)}${JSON.stringify(inner)}`;
    expect(() => parseQuestionnaireDataCardPayload(padded)).toThrow('问卷数据卡内容为空或格式不受支持');
    expect(() => parseQuestionnaireDataCardPayload({ data: padded })).toThrow('问卷数据卡内容为空或格式不受支持');
  });
});

describe('MAX_QUESTIONNAIRE_IMPORT_BYTES', () => {
  // 全部内置预设都在预算内的断言放在宿主侧测试（domain 测试禁 node:fs）。
  test('与云端数据卡上限同口径（D5.1-P2-r2）', () => {
    expect(MAX_QUESTIONNAIRE_IMPORT_BYTES).toBe(MAX_DATA_CARD_BYTES);
  });
});

describe('external-media 准入', () => {
  test('相对路径与白名单域名放行，其他协议与未列域名拒绝', () => {
    expect(isAllowedExternalMediaUrl('/logo.svg', 'image')).toBe(true);
    expect(isAllowedExternalMediaUrl('https://i.imgur.com/x.png', 'image')).toBe(true);
    expect(isAllowedExternalMediaUrl('https://sub.zhihu.com/x.png', 'image')).toBe(true);
    expect(isAllowedExternalMediaUrl('https://evil.example.com/x.png', 'image')).toBe(false);
    expect(isAllowedExternalMediaUrl('javascript:alert(1)', 'image')).toBe(false);
    expect(isAllowedExternalMediaUrl('data:image/png;base64,xx', 'image')).toBe(false);
    expect(isAllowedExternalMediaUrl('', 'image')).toBe(false);
  });
});
