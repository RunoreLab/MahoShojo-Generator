import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildCanshouAnswers,
  buildCanshouFlowItems,
  builtinQuestionnaireSource,
  builtinSelectionId,
  CANSHOU_DEFAULT_QUESTIONNAIRE_ID,
  loadDefaultCanshouQuestionnaire,
  parseCanshouQuestionnaireSelection,
} from '../src/features/canshou/questionnaire';
import {
  buildQuestionKey,
  buildQuestionnaireFlow,
  normalizeQuestionnaireDefinition,
  resolveQuestionnaireReferences,
} from '@mahoshojo/domain/questionnaire-definition';
import { buildQuestionnaireContextItems } from '@mahoshojo/domain/questionnaire-selection';
import { toQuestionnaireSelection } from '../src/features/canshou/questionnaire';

const source = () => JSON.parse(readFileSync(new URL('../../../content/questionnaires/presets/canshou-default.json', import.meta.url), 'utf8'));
const fixture = (question: Record<string, unknown>) => ({
  id: 'canshou-default', kind: 'canshou', title: '默认残兽问卷', description: '说明',
  questions: [{ id: 'q1', question: '残兽的起源？', ...question }],
});

afterEach(() => vi.unstubAllGlobals());

const loadFixture = async (body: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
  return loadDefaultCanshouQuestionnaire(new AbortController().signal);
};

describe('Desktop default canshou questionnaire', () => {
  it('loads the bundled canshou-default preset preserving id, kind and question order', async () => {
    const canonical = source();
    const parsed = await loadFixture(canonical);
    expect(parsed.id).toBe(CANSHOU_DEFAULT_QUESTIONNAIRE_ID);
    expect(parsed.id).toBe('canshou-default');
    expect(parsed.kind).toBe('canshou');
    expect(parsed.questions.length).toBe(canonical.questions.length);
    expect(parsed.questions.map((q: { id: string }) => q.id)).toEqual(
      canonical.questions.map((q: { id: string }) => q.id),
    );
  });

  it('requests the bundled same-origin asset without credentials or redirect fallback', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => source() }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await loadDefaultCanshouQuestionnaire(signal);
    expect(fetch).toHaveBeenCalledWith('/questionnaires/presets/canshou-default.json', { signal, credentials: 'omit', redirect: 'error' });
  });

  it('rejects a missing bundled asset and a mismatched canonical id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: vi.fn() })));
    await expect(loadDefaultCanshouQuestionnaire(new AbortController().signal)).rejects.toThrow('内置问卷加载失败');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...fixture({}), id: 'other' }) })));
    await expect(loadDefaultCanshouQuestionnaire(new AbortController().signal)).rejects.toThrow('内置问卷无法读取');
  });

  it('keeps conditional/jump/reference semantics instead of rejecting them', async () => {
    const parsed = await loadFixture(fixture({
      displayIf: { questionId: 'other', operator: 'notEmpty' },
      jump: { when: { questionId: 'other', operator: 'equals', value: 'x' }, toEnd: true },
      required: true,
    }));
    const question = parsed.questions[0];
    expect(question.displayIf).toBeTruthy();
    expect(question.jump).toBeTruthy();
    expect(question.required).toBe(true);
  });

  it('内置预设未声明 nativeAllowed 时按 preset 语义归一化为 true', async () => {
    const parsed = await loadFixture(fixture({}));
    expect(parsed.nativeAllowed).toBe(true);
  });

  it('内置问卷使用 builtin:<id> 作用域；wire source 为 preset', async () => {
    const questionnaire = await loadFixture(fixture({}));
    const src = builtinQuestionnaireSource(questionnaire);
    expect(src.selectionId).toBe(builtinSelectionId(questionnaire.id));
    const flow = buildCanshouFlowItems(questionnaire, src.selectionId);
    expect(flow[0].key).toBe(`${builtinSelectionId(questionnaire.id)}::q1`);
    expect(flow[0].questionnaireScopeId).toBe(src.selectionId);
    const selection = toQuestionnaireSelection(src, questionnaire);
    expect(selection.source).toBe('preset');
    expect(selection).not.toHaveProperty('dataCardId');
    expect(selection).not.toHaveProperty('dataCardName');
  });
});

describe('buildCanshouAnswers', () => {
  it('requires at least one nonblank known answer', async () => {
    const parsed = await loadFixture(source());
    const flow = buildCanshouFlowItems(parsed);
    expect(() => buildCanshouAnswers(flow, {})).toThrow('至少填写一题');
    expect(() => buildCanshouAnswers(flow, { 'other-scope::q1': '别卷的回答' })).toThrow('至少填写一题');
  });

  it('trims answers, skips blanks and preserves canonical question ordering and identity', async () => {
    const parsed = await loadFixture(fixture({}));
    const flow = buildCanshouFlowItems(parsed);
    const key = buildQuestionKey(parsed.id, 'q1', 0);
    const answers = buildCanshouAnswers(flow, { [key]: ' 巢穴回声\n' });
    expect(answers).toEqual([
      { question: '残兽的起源？', questionId: 'q1', questionnaireId: 'canshou-default', questionnaireTitle: '默认残兽问卷', answer: '巢穴回声' },
    ]);
  });

  it('checks trimmed selection values against enabled options when allowCustom:false', async () => {
    const parsed = await loadFixture(fixture({ allowCustom: false, options: ['卵', { value: 'hatch', label: '初蜕' }] }));
    const flow = buildCanshouFlowItems(parsed);
    const key = flow[0].key;
    expect(buildCanshouAnswers(flow, { [key]: ' 卵 ' })[0].answer).toBe('卵');
    expect(() => buildCanshouAnswers(flow, { [key]: '自定义' })).toThrow('请选择一个可用选项');
  });
});

describe('parseCanshouQuestionnaireSelection', () => {
  const basePayload = {
    id: 'shared-canshou-q',
    kind: 'canshou',
    title: '卡内残兽问卷',
    nativeAllowed: true,
    questions: [{ id: 'q1', question: '形态？' }],
  };

  it('云端问卷卡保留服务器身份并映射为 database 来源', () => {
    const parsed = parseCanshouQuestionnaireSelection({
      ...basePayload,
      _cardId: 'card-7', _cardName: '云端残兽问卷', _cardType: 'questionnaire', _isPublic: 0,
      _storageLocation: 'cloud', _author: 'someone',
    } as never, { selectionId: 'cloud:card-7', storageLocation: 'cloud', cloudCardId: 'card-7' });
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.source).toMatchObject({ kind: 'cloud', title: '云端残兽问卷', cardId: 'card-7', selectionId: 'cloud:card-7' });
    const selection = toQuestionnaireSelection(parsed.source, parsed.questionnaire);
    expect(selection.source).toBe('database');
    expect(selection.dataCardId).toBe('card-7');
    expect(selection.dataCardName).toBe('云端残兽问卷');
  });

  it('本地库卡不带服务器身份且 nativeAllowed 恒 false', () => {
    const parsed = parseCanshouQuestionnaireSelection({
      ...basePayload, nativeAllowed: true,
      _cardId: '', _cardName: '本地残兽问卷', _cardType: 'questionnaire', _isPublic: false,
      _storageLocation: 'local', _author: '',
    } as never);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.source.kind).toBe('local');
    expect(parsed.source.cardId).toBeUndefined();
    expect(parsed.questionnaire.nativeAllowed).toBe(false);
    const selection = toQuestionnaireSelection(parsed.source, parsed.questionnaire);
    expect(selection.source).toBe('upload');
  });

  it('非问卷卡与空内容卡被拒绝', () => {
    expect(parseCanshouQuestionnaireSelection({ _cardType: 'character', _storageLocation: 'cloud' } as never))
      .toEqual({ error: '这张数据卡不是问卷。' });
    expect(parseCanshouQuestionnaireSelection({
      kind: 'canshou', nativeAllowed: true, questions: [],
      _cardType: 'questionnaire', _storageLocation: 'local', _cardName: '空',
    } as never)).toEqual({ error: '这张数据卡不包含可识别的问卷内容。' });
  });

  it('同一问卷的云端与本地实例产出不同答案键', () => {
    const cloud = parseCanshouQuestionnaireSelection({
      ...basePayload, _cardId: 'card-7', _cardName: '云端残兽问卷', _cardType: 'questionnaire',
      _storageLocation: 'cloud', _author: '',
    } as never);
    const local = parseCanshouQuestionnaireSelection({
      ...basePayload, _cardId: '', _cardName: '本地残兽问卷', _cardType: 'questionnaire',
      _storageLocation: 'local', _author: '',
    } as never);
    if ('error' in cloud || 'error' in local) throw new Error('unexpected parse error');
    const cloudFlow = buildCanshouFlowItems(cloud.questionnaire, cloud.source.selectionId);
    const localFlow = buildCanshouFlowItems(local.questionnaire, local.source.selectionId);
    expect(cloudFlow[0].key).toBe('cloud:card-7::q1');
    expect(localFlow[0].key).toContain('local:');
    expect(cloudFlow[0].key).not.toBe(localFlow[0].key);
    const answers = { [cloudFlow[0].key]: '云端回答', [localFlow[0].key]: '本地回答' };
    expect(buildCanshouAnswers(cloudFlow, answers)[0].answer).toBe('云端回答');
    expect(buildCanshouAnswers(localFlow, answers)[0].answer).toBe('本地回答');
  });
});

describe('多问卷流程（与 Web CanshouPage 同一共源语义）', () => {
  it('条件题按回答显隐，多问卷按 selection 作用域隔离答案键', () => {
    const conditional = {
      id: 'canshou-cond', kind: 'canshou', title: '条件卷',
      questions: [
        { id: 'gate', question: '是否见过残兽？', options: ['见过', '没见过'], allowCustom: false },
        { id: 'detail', question: '描述它', displayIf: { questionId: 'gate', operator: 'equals', value: '见过' } },
      ],
    };
    // 非内置卷不走 loadDefaultCanshouQuestionnaire 的 canonical id 校验——直接归一化。
    const parsed = normalizeQuestionnaireDefinition(conditional, {
      fallbackId: 'canshou-cond', fallbackKind: 'canshou', fallbackTitle: '条件卷', nativeAllowed: false,
    })!;
    const sel = toQuestionnaireSelection(builtinQuestionnaireSource(parsed), parsed);
    const items = resolveQuestionnaireReferences(buildQuestionnaireContextItems([sel]));
    const hidden = buildQuestionnaireFlow(items, {}).flow;
    expect(hidden).toHaveLength(1);
    const shown = buildQuestionnaireFlow(items, { [items[0].key]: '见过' }).flow;
    expect(shown).toHaveLength(2);
    expect(shown[1].key).toBe(`${sel.selectionId}::detail`);
    // 隐藏的 detail 不参与收集。
    const answers = buildCanshouAnswers(hidden, { [items[0].key]: '没见过', [`${sel.selectionId}::detail`]: '幽灵' });
    expect(answers).toHaveLength(1);
    expect(answers[0].answer).toBe('没见过');
  });
});
